#!/usr/bin/env node
/**
 * Vérifie l’accès à api.vehicledatabases.com (clé env ou valeur par défaut dans lib/vin-provider.js).
 * Usage : node scripts/verify-vehicledatabases.js [VIN]
 * Réf. portail : https://vehicledatabases.com/portal
 */
require('dotenv').config();
const { getVehicleDatabasesApiKey } = require('../lib/vin-provider');

const DEFAULT_VIN = '1HGBH41JXMN109186';

const apiKey = getVehicleDatabasesApiKey();
const vin = String(process.argv[2] || DEFAULT_VIN)
  .replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '')
  .toUpperCase();

if (vin.length !== 17) {
  console.error('VIN invalide (17 caractères requis)');
  process.exit(1);
}

async function main() {
  const url = `https://api.vehicledatabases.com/advanced-vin-decode/v2/${encodeURIComponent(vin)}`;
  const res = await fetch(url, {
    headers: {
      'x-authkey': apiKey,
      Accept: 'application/json',
      'User-Agent': 'Carvinguard/verify-vehicledatabases'
    }
  });
  const body = await res.json().catch(() => ({}));
  console.log('HTTP', res.status, url);
  if (res.status === 401 || res.status === 403) {
    console.error('Authentification refusée — vérifiez VEHICLEDATABASES_API_KEY');
    process.exit(2);
  }
  if (res.ok) {
    const inner = body && body.data != null ? body.data : body;
    const make = inner && (inner.make || (inner.data && inner.data.make));
    const model = inner && (inner.model || (inner.data && inner.data.model));
    console.log('OK — aperçu :', make || '?', model || '?');
    process.exit(0);
  }
  console.error('Réponse API (VIN peut être absent du catalogue — la clé semble acceptée) :', body.message || body);
  process.exit(body.status === 'error' && /not found/i.test(String(body.message || '')) ? 4 : 3);
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
