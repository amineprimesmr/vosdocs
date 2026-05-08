/**
 * Décodage VIN (même logique que GET /api/vin-decode?preview=1) pour PDF / post-paiement.
 * Sans débit crédit ni req/res Express.
 */

const carapiClient = require('./carapi-client');
const { getVinDecodeProvider } = require('./vin-provider');

function normalizeCarApiVinResponse(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, httpStatus: 502, message: 'Réponse VIN invalide' };
  }
  const id = carapiClient.extractVinDecodeIdentity(body);
  if (
    id &&
    (String(id.make || '').trim() ||
      String(id.model || '').trim() ||
      id.year ||
      id.fromVinPathOnly)
  ) {
    const year = id.year != null ? String(id.year) : '';
    const detailParts = [id.engine, id.transmission, id.fuel_type, id.drivetrain].filter(
      (x) => x != null && String(x).trim() !== ''
    );
    const summary = detailParts.length > 0 ? detailParts.join(' · ') : String(id.make || id.model || '').trim();
    return {
      ok: true,
      json: {
        status: 'success',
        data: {
          make: String(id.make || '').trim(),
          model: String(id.model || '').trim(),
          year,
          trim: String(id.trim || '').trim(),
          summary,
          engine: id.engine != null ? String(id.engine).trim() : '',
          transmission: id.transmission != null ? String(id.transmission).trim() : '',
          fuel_type: id.fuel_type != null ? String(id.fuel_type).trim() : '',
          drivetrain: id.drivetrain != null ? String(id.drivetrain).trim() : ''
        }
      }
    };
  }
  const msg = String(
    body.message || (typeof body.error === 'string' ? body.error : body.error?.message) || ''
  ).trim();
  const quota =
    /quota|limit|429/i.test(msg) || /quota|limit/i.test(String(body.error || ''));
  return {
    ok: false,
    httpStatus: quota ? 429 : 400,
    message: msg || 'VIN introuvable ou invalide'
  };
}

function normalizeNhtsaVinResponse(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.Results) || !body.Results[0]) {
    return { ok: false };
  }
  const r = body.Results[0];
  const make = String(r.Make || '').trim();
  const model = String(r.Model || '').trim();
  const year = r.ModelYear != null ? String(r.ModelYear).trim() : '';
  const hasIdentity =
    (make && !/^not applicable$/i.test(make)) ||
    (model && !/^not applicable$/i.test(model)) ||
    year;
  if (!hasIdentity) {
    const errText = String(r.ErrorText || '').trim();
    return {
      ok: false,
      message: errText ? errText.split(';')[0].trim() : 'VIN introuvable ou invalide'
    };
  }
  if (/^invalid/i.test(make) || /^invalid/i.test(model)) {
    return { ok: false };
  }
  const detailParts = [r.VehicleType, r.BodyClass].filter(
    (x) => x != null && String(x).trim() !== '' && String(x).trim() !== 'Not Applicable'
  );
  const summary =
    detailParts.length > 0 ? detailParts.join(' · ') : String(r.PlantCountry || '').trim();
  const engParts = [r.DisplacementL, r.EngineCylinders, r.EngineModel].filter(
    (x) => x != null && String(x).trim() !== ''
  );
  const engine = engParts.length ? engParts.map((x) => String(x).trim()).join(' ') : '';
  const transmission = r.TransmissionStyle != null ? String(r.TransmissionStyle).trim() : '';
  const fuelType = r.FuelTypePrimary != null ? String(r.FuelTypePrimary).trim() : '';
  const driveType = r.DriveType != null ? String(r.DriveType).trim() : '';
  return {
    ok: true,
    json: {
      status: 'success',
      data: {
        make,
        model,
        year,
        trim: String(r.Trim || '').trim(),
        summary,
        engine,
        transmission,
        fuel_type: fuelType,
        drivetrain: driveType
      },
      source: 'nhtsa'
    }
  };
}

function fetchTimeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

function previewPartialVinJson() {
  return {
    status: 'success',
    data: {
      make: '',
      model: '',
      year: '',
      trim: '',
      summary:
        'VIN enregistré. Les informations détaillées (marque, modèle, millésime) seront complétées dans votre rapport après commande.'
    },
    access: 'preview',
    partialDecode: true
  };
}

async function decodeVinViaNhtsa(vin) {
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Carvinguard/1.0' },
      signal: fetchTimeoutSignal(10000)
    });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('json')) {
      return null;
    }
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) {
      return null;
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch (_) {
      return null;
    }
    const norm = normalizeNhtsaVinResponse(body);
    if (!norm.ok) return null;
    return norm.json;
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('NHTSA VIN decode:', e.message);
    }
    return null;
  }
}

/**
 * @returns {Promise<object>} même forme qu’une réponse JSON réussie du endpoint /api/vin-decode (preview)
 */
async function decodeVinForReport(vinRaw) {
  const vin = String(vinRaw || '')
    .replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '')
    .toUpperCase();
  if (vin.length !== 17) {
    return { status: 'error', message: 'VIN invalide (17 caractères requis)' };
  }

  const provider = getVinDecodeProvider();

  if (!provider) {
    const nhtsaOnly = await decodeVinViaNhtsa(vin);
    if (nhtsaOnly && nhtsaOnly.status === 'success') {
      return Object.assign({}, nhtsaOnly, { access: 'preview' });
    }
    return previewPartialVinJson();
  }

  try {
    if (provider.id === 'carapi') {
      const url = `https://api.carapi.dev/v1/vin-decode/${encodeURIComponent(vin)}?token=${encodeURIComponent(provider.apiKey)}`;
      const extRes = await fetch(url, { signal: fetchTimeoutSignal(12000) });
      let data = {};
      try {
        data = await extRes.json();
      } catch (_) {
        data = {};
      }

      if (extRes.ok) {
        const norm = normalizeCarApiVinResponse(data);
        if (norm.ok) {
          return Object.assign({}, norm.json, { access: 'preview' });
        }
      }

      const nhtsaCar = await decodeVinViaNhtsa(vin);
      if (nhtsaCar && nhtsaCar.status === 'success') {
        return Object.assign({}, nhtsaCar, { access: 'preview' });
      }

      if (!extRes.ok) {
        if (extRes.status !== 429) {
          return previewPartialVinJson();
        }
        return {
          status: 'error',
          message:
            (data && (data.message || data.error)) || 'Quota API VIN dépassé. Réessayez plus tard.'
        };
      }
      return previewPartialVinJson();
    }

    const extRes = await fetch(
      `https://api.vehicledatabases.com/advanced-vin-decode/v2/${vin}`,
      { headers: { 'x-authkey': provider.apiKey }, signal: fetchTimeoutSignal(12000) }
    );
    let data = {};
    try {
      data = await extRes.json();
    } catch (_) {
      data = {};
    }
    if (!extRes.ok) {
      const nhtsaVd = await decodeVinViaNhtsa(vin);
      if (nhtsaVd && nhtsaVd.status === 'success') {
        return Object.assign({}, nhtsaVd, { access: 'preview' });
      }
      return previewPartialVinJson();
    }
    if (data.status === 'error') {
      const nhtsaErr = await decodeVinViaNhtsa(vin);
      if (nhtsaErr && nhtsaErr.status === 'success') {
        return Object.assign({}, nhtsaErr, { access: 'preview' });
      }
      return previewPartialVinJson();
    }
    const outVd = typeof data === 'object' && data !== null ? Object.assign({}, data) : data;
    if (outVd && typeof outVd === 'object') outVd.access = 'preview';
    return outVd;
  } catch (e) {
    console.error('decodeVinForReport:', e.message);
    return previewPartialVinJson();
  }
}

/**
 * Normalise la réponse decode en objet vehicleData utilisé par le front / PDF.
 */
function apiResponseToVehicleData(decodeJson) {
  if (!decodeJson || decodeJson.status !== 'success' || !decodeJson.data) {
    return {
      make: '',
      model: '',
      year: '',
      trim: '',
      summary: '',
      engine: '',
      transmission: '',
      fuel_type: '',
      drivetrain: '',
      vehicleDesc: ''
    };
  }
  const d = decodeJson.data;

  // VehicleDatabases a les specs imbriquées (specifications.engine, specifications.fuel, transmission.type)
  const specs = (d.specifications && typeof d.specifications === 'object') ? d.specifications : {};
  const engSpec = (specs.engine && typeof specs.engine === 'object') ? specs.engine : {};
  const fuelSpec = (specs.fuel && typeof specs.fuel === 'object') ? specs.fuel : {};
  const transSpec = (d.transmission && typeof d.transmission === 'object') ? d.transmission : {};

  // Moteur : priorité champ plat, puis spec imbriqué
  let engine = d.engine || '';
  if (!engine) {
    const engParts = [engSpec.type, engSpec.cylinders ? engSpec.cylinders + ' cyl.' : null, engSpec.displacement_l ? engSpec.displacement_l + 'L' : null].filter(Boolean);
    engine = engParts.join(' ').trim();
  }

  // Transmission
  let transmission = '';
  if (typeof d.transmission === 'string') {
    transmission = d.transmission;
  } else {
    transmission = transSpec.type || transSpec.description || '';
  }

  // Carburant
  const fuel_type = d.fuel_type || fuelSpec.type || '';

  // Traction
  const drivetrain = d.drivetrain || d.drive_type || specs.driveline || '';

  // Résumé (VehicleDatabases a trim_and_style, style, summary)
  const summary = d.summary || d.trim_and_style || d.style || '';

  const vehicleData = {
    make: d.make || '',
    model: d.model || '',
    year: d.year || '',
    trim: d.trim || '',
    summary,
    engine,
    transmission,
    fuel_type,
    drivetrain,
    estimatedValue: d.estimatedValue || d.base_msrp
  };
  vehicleData.vehicleDesc = [vehicleData.year, vehicleData.make, vehicleData.model]
    .filter(Boolean)
    .join(' · ');
  return vehicleData;
}

module.exports = {
  decodeVinForReport,
  apiResponseToVehicleData,
  getVinDecodeProvider,
  decodeVinViaNhtsa
};
