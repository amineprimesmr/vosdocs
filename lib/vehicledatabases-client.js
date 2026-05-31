'use strict';

/**
 * Client complet Vehicle Databases API — appelle tous les endpoints disponibles en parallèle.
 * Endpoints couverts :
 *  - advanced-vin-decode/v2     → fiche technique complète, specs, couleurs, options, prix
 *  - europe-vin-decode/v2       → données EU spécifiques
 *  - stolen-check               → signalement vol
 *  - title-check                → titre épave / salvage (perte totale)
 *  - market-value/v2            → cote (4 états × 3 types)
 *  - vehicle-recalls            → rappels sécurité NHTSA
 *  - saleshistory               → historique ventes / annonces
 *  - auction                    → enchères
 *  - vehicle-media/v2           → photos (ext / int / couleurs)
 *  - vehicle-maintenance/v4     → carnet entretien planifié
 *  - vehicle-warranty/{y}/{m}/{m} → garantie constructeur
 */

const BASE = 'https://api.vehicledatabases.com';
const TIMEOUT_MS = 20000;

function fetchTimeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

async function vdGet(apiKey, urlPath, query) {
  const u = new URL(BASE + urlPath);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  const res = await fetch(u.toString(), {
    headers: {
      'x-authkey': apiKey,
      Accept: 'application/json',
      'User-Agent': 'Carvinguard/1.0'
    },
    signal: fetchTimeoutSignal(TIMEOUT_MS)
  });
  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

/** Ignore les « années » aberrantes renvoyées par certains payloads (texte parasite). */
function saneVinModelYear(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (/^\d{4}$/.test(s)) return s;
  const n = parseInt(s, 10);
  if (Number.isFinite(n) && n >= 1980 && n <= 2039) return String(n);
  return '';
}

/**
 * Extrait make/model/year depuis la réponse VD (advanced, ou Europe avec bloc `General Information` / PascalCase).
 * @returns {{ make: string, model: string, year: string } | null}
 */
function extractIdentityFromVdDecode(vdDecodeResult) {
  if (!vdDecodeResult || !vdDecodeResult.ok) return null;
  const d = vdDecodeResult.data;
  if (!d || d.status === 'error') return null;
  const inner = (d.data && typeof d.data === 'object') ? d.data : d;
  let make = String(inner.make || '').trim();
  let model = String(inner.model || '').trim();
  let year = saneVinModelYear(inner.year);

  const gi =
    inner.general_information ||
    inner['General Information'] ||
    inner.GeneralInformation;
  if (gi && typeof gi === 'object') {
    const mkGi = String(gi.make || gi.Make || '').trim();
    const mdGi = String(gi.model || gi.Model || '').trim();
    const yrGi = saneVinModelYear(gi.year || gi.Year || gi.ModelYear || gi.model_year || '');
    if (!make) make = mkGi;
    if (!model) model = mdGi;
    if (!year) year = yrGi;
  }

  year = saneVinModelYear(year) || '';

  if (!make && !model && !year) return null;
  return { make, model, year };
}

/**
 * Construit un bloc `vinDecode` synthétique compatible advanced-decode depuis la réponse `europe-vin-decode/v2`.
 */
function vinDecodeSyntheticFromEuropeSection(section) {
  if (!section || !section.ok || !section.data) return null;
  const body = section.data;
  if (!body || typeof body !== 'object' || body.status === 'error') return null;
  const inner = body.data && typeof body.data === 'object' ? body.data : body;
  if (!inner || typeof inner !== 'object') return null;
  const identity = extractIdentityFromVdDecode({
    ok: true,
    data: { status: 'success', data: inner }
  });
  if (!identity || !String(identity.make || '').trim()) return null;
  return {
    ok: true,
    status: 200,
    data: {
      status: 'success',
      data: Object.assign({}, inner, {
        make: identity.make,
        model: identity.model,
        year: identity.year || ''
      })
    }
  };
}

/**
 * Lance tous les appels VehicleDatabases en parallèle puis appelle /vehicle-warranty
 * une fois make/model/year connus (depuis le décodage).
 *
 * @param {string} apiKey
 * @param {{ vin: string, mileage?: string|number, state?: string }} opts
 * @returns {Promise<object>} bundle complet avec chaque section
 */
async function fetchVehicleDatabasesFullEnrichment(apiKey, opts) {
  const vin = String(opts.vin || '')
    .replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '')
    .toUpperCase();

  const mileage = opts.mileage;
  const state = opts.state;

  const parallelTasks = [
    ['vinDecode',    () => vdGet(apiKey, `/advanced-vin-decode/v2/${encodeURIComponent(vin)}`, {})],
    ['europeVin',    () => vdGet(apiKey, `/europe-vin-decode/v2/${encodeURIComponent(vin)}`, {})],
    ['stolenCheck',  () => vdGet(apiKey, `/stolen-check/${encodeURIComponent(vin)}`, {})],
    ['titleCheck',   () => vdGet(apiKey, `/title-check/${encodeURIComponent(vin)}`, {})],
    ['marketValue',  () => vdGet(apiKey, `/market-value/v2/${encodeURIComponent(vin)}`, { ...(mileage ? { mileage } : {}), ...(state ? { state } : {}) })],
    ['recalls',      () => vdGet(apiKey, `/vehicle-recalls/${encodeURIComponent(vin)}`, {})],
    ['salesHistory', () => vdGet(apiKey, `/saleshistory/${encodeURIComponent(vin)}`, {})],
    ['auction',      () => vdGet(apiKey, `/auction/${encodeURIComponent(vin)}`, {})],
    ['media',        () => vdGet(apiKey, `/vehicle-media/v2/${encodeURIComponent(vin)}`, {})],
    ['maintenance',  () => vdGet(apiKey, `/vehicle-maintenance/v4/${encodeURIComponent(vin)}`, {})]
  ];

  const settled = await Promise.all(
    parallelTasks.map(async ([name, fn]) => {
      try {
        const r = await fn();
        return [name, { ok: r.ok, status: r.status, data: r.body }];
      } catch (e) {
        return [name, { ok: false, status: 0, error: e && e.message ? e.message : String(e) }];
      }
    })
  );

  const out = { vin };
  for (const [name, payload] of settled) {
    out[name] = payload;
  }

  let vdDecEarly = extractIdentityFromVdDecode(out.vinDecode);
  if ((!vdDecEarly || !String(vdDecEarly.make || '').trim()) && out.europeVin) {
    const synth = vinDecodeSyntheticFromEuropeSection(out.europeVin);
    if (synth) {
      out.vinDecode = synth;
      out.identificationSource = 'europe_vin_fallback';
    }
  }

  // Warranty requiert year/make/model — appel séquentiel après décodage
  const identity = extractIdentityFromVdDecode(out.vinDecode);
  if (identity && identity.make && identity.model && identity.year) {
    try {
      const r = await vdGet(
        apiKey,
        `/vehicle-warranty/${encodeURIComponent(identity.year)}/${encodeURIComponent(identity.make)}/${encodeURIComponent(identity.model)}`,
        {}
      );
      out.warranty = { ok: r.ok, status: r.status, data: r.body };
    } catch (e) {
      out.warranty = { ok: false, status: 0, error: e && e.message ? e.message : String(e) };
    }
    out.identity = identity;
  } else {
    out.warranty = { skipped: true, reason: 'make_model_year_unavailable' };
  }

  return out;
}

module.exports = {
  fetchVehicleDatabasesFullEnrichment,
  vdGet,
  extractIdentityFromVdDecode,
  vinDecodeSyntheticFromEuropeSection
};
