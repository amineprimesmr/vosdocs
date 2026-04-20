/**
 * Client CarAPI.dev — aligné sur https://api.carapi.dev/openapi.json
 * (inspection, vol, kilométrage, cotation, annonces, photos, financement, plaque → VIN).
 * Le jeton ne doit jamais être exposé au navigateur : uniquement appels serveur.
 */

'use strict';

const BASE = 'https://api.carapi.dev/v1';
const REQUEST_MS = 22000;

/** Marques attendues par /vehicle-valuation et /listing (schéma OpenAPI). */
const CARAPI_MAKE_ENUM = new Set([
  'acura',
  'alfa-romeo',
  'audi',
  'bmw',
  'cadillac',
  'chevrolet',
  'citroen',
  'cupra',
  'dacia',
  'dodge',
  'ferrari',
  'fiat',
  'ford',
  'gmc',
  'honda',
  'hyundai',
  'jaguar',
  'jeep',
  'kia',
  'land-rover',
  'lexus',
  'mazda',
  'mercedes-benz',
  'mg',
  'mini',
  'mitsubishi',
  'nissan',
  'opel',
  'peugeot',
  'porsche',
  'ram',
  'renault',
  'seat',
  'skoda',
  'subaru',
  'suzuki',
  'tesla',
  'toyota',
  'volvo',
  'vw'
]);

const CARAPI_ENDPOINT_IDS = [
  'vin-decode',
  'plate-to-vin',
  'stolen-check',
  'inspection',
  'mileage-history',
  'vehicle-valuation',
  'listing',
  'photos',
  'payments'
];

function fetchTimeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

/**
 * Normalise la marque décodée vers une valeur de l’enum CarAPI (ex. « Mercedes-Benz » → mercedes-benz).
 * @returns {string|null}
 */
function normalizeMakeForCarApi(makeRaw) {
  if (makeRaw == null || String(makeRaw).trim() === '') return null;
  const s = String(makeRaw)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-');
  const aliases = {
    volkswagen: 'vw',
    vw: 'vw',
    mercedes: 'mercedes-benz',
    'mercedes-benz': 'mercedes-benz',
    'citroën': 'citroen',
    citroen: 'citroen',
    skoda: 'skoda'
  };
  const key = aliases[s] || s;
  if (CARAPI_MAKE_ENUM.has(key)) return key;
  if (s === 'land-rover') return 'land-rover';
  if (s === 'alfa-romeo') return 'alfa-romeo';
  if (CARAPI_MAKE_ENUM.has(s)) return s;
  return null;
}

function slugModel(modelRaw) {
  return String(modelRaw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-');
}

/**
 * GET CarAPI avec token en query (convention CarAPI).
 * @param {string} token
 * @param {string} pathname - ex. /inspection/WVWZZZ...
 * @param {Record<string, string|number|boolean|undefined>} query
 */
async function carApiGet(token, pathname, query) {
  const u = new URL(BASE + pathname);
  u.searchParams.set('token', token);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, String(v));
  }
  const res = await fetch(u.toString(), {
    signal: fetchTimeoutSignal(REQUEST_MS),
    headers: { Accept: 'application/json', 'User-Agent': 'Carvinguard/1.0' }
  });
  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * Agrège les appels « max » CarAPI pour un VIN (hors plaque).
 * @param {string} token
 * @param {{ vin: string, country?: string, listingLimit?: number, listingOffset?: number, payment?: { price?: number, downPayment?: number, loanTerm?: number, interestRate?: number } }} opts
 */
async function fetchCarApiFullEnrichment(token, opts) {
  const vin = String(opts.vin || '')
    .replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '')
    .toUpperCase();
  const country = String(opts.country || 'FR')
    .toUpperCase()
    .slice(0, 2);
  const listingLimit = Math.min(50, Math.max(1, parseInt(String(opts.listingLimit ?? '10'), 10) || 10));
  const listingOffset = Math.max(0, parseInt(String(opts.listingOffset ?? '0'), 10) || 0);
  const pay = opts.payment || {};
  const price = Number(pay.price != null ? pay.price : 25000);
  const downPayment = Number(pay.downPayment != null ? pay.downPayment : 5000);
  const loanTerm = parseInt(String(pay.loanTerm != null ? pay.loanTerm : 60), 10) || 60;
  const interestRate = Number(pay.interestRate != null ? pay.interestRate : 5.5);

  const dec = await carApiGet(token, `/vin-decode/${encodeURIComponent(vin)}`, {});

  const out = {
    vin,
    country,
    decode: { ok: dec.ok, status: dec.status, data: dec.body }
  };

  let makeEnum = null;
  let modelSlug = '';
  let yearNum = null;
  if (dec.ok && dec.body && dec.body.success && dec.body.data && typeof dec.body.data === 'object') {
    const d = dec.body.data;
    makeEnum = normalizeMakeForCarApi(d.make);
    modelSlug = slugModel(d.model);
    const y = d.year;
    yearNum = typeof y === 'number' ? y : parseInt(String(y || ''), 10);
    if (!Number.isFinite(yearNum)) yearNum = null;
  }

  const tasks = [
    ['inspection', () => carApiGet(token, `/inspection/${encodeURIComponent(vin)}`, { country })],
    ['stolenCheck', () => carApiGet(token, `/stolen-check/${encodeURIComponent(vin)}`, {})],
    ['mileageHistory', () => carApiGet(token, `/mileage-history/${encodeURIComponent(vin)}`, {})],
    ['photos', () => carApiGet(token, `/photos/${encodeURIComponent(vin)}`, {})],
    [
      'payments',
      () =>
        carApiGet(token, `/payments/${encodeURIComponent(vin)}`, {
          price,
          downPayment,
          loanTerm,
          interestRate
        })
    ]
  ];

  const canValuationAndListings = !!(makeEnum && modelSlug && yearNum);
  if (canValuationAndListings) {
    tasks.push([
      'vehicleValuation',
      () =>
        carApiGet(token, '/vehicle-valuation', {
          make: makeEnum,
          model: modelSlug,
          year: yearNum,
          country
        })
    ]);
    tasks.push([
      'listings',
      () =>
        carApiGet(token, '/listing', {
          make: makeEnum,
          model: modelSlug,
          year: yearNum,
          limit: listingLimit,
          offset: listingOffset
        })
    ]);
  }

  const settled = await Promise.all(
    tasks.map(async ([name, fn]) => {
      try {
        const r = await fn();
        return [name, { ok: r.ok, status: r.status, data: r.body }];
      } catch (e) {
        return [name, { ok: false, status: 0, error: e && e.message ? e.message : String(e) }];
      }
    })
  );

  for (const [name, payload] of settled) {
    out[name] = payload;
  }

  if (!canValuationAndListings) {
    out.vehicleValuation = { skipped: true, reason: 'make_model_year_unavailable' };
    out.listings = { skipped: true, reason: 'make_model_year_unavailable' };
  }

  return out;
}

module.exports = {
  BASE,
  CARAPI_ENDPOINT_IDS,
  CARAPI_MAKE_ENUM,
  carApiGet,
  fetchCarApiFullEnrichment,
  normalizeMakeForCarApi
};
