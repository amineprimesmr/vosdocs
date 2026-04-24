#!/usr/bin/env node
/**
 * Vérifie que CARAPI_TOKEN atteint api.carapi.dev comme le playground.
 * Usage : CARAPI_TOKEN=carapi_xxx node scripts/verify-carapi.js [VIN]
 */
'use strict';

require('dotenv').config();
const vin = (process.argv[2] || 'VF1BR2HDH46228951').replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '').toUpperCase();
const token = String(process.env.CARAPI_TOKEN || process.env.CARAPI_API_KEY || '')
  .trim()
  .replace(/^['"]|['"]$/g, '');

if (!token) {
  console.error('Définissez CARAPI_TOKEN dans .env (même valeur que le dashboard CarAPI).');
  process.exit(1);
}
if (vin.length !== 17) {
  console.error('VIN invalide (17 caractères).');
  process.exit(1);
}

const url = `https://api.carapi.dev/v1/vin-decode/${encodeURIComponent(vin)}?token=${encodeURIComponent(token)}`;

async function main() {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Carvinguard-verify/1.0' }
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    body = { _raw: text.slice(0, 500) };
  }
  console.log('HTTP', res.status, res.statusText);
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) {
    console.error('\n→ Même erreur qu’en prod : vérifiez la clé, le quota, ou le VIN.');
    process.exit(2);
  }
  if (!body.specifications && !body.data && !body.success) {
    console.warn('\n→ Format de réponse inattendu (pas de specifications/data) : mettre à jour extractVinDecodeIdentity.');
  }
}

main().catch(function (e) {
  console.error(e);
  process.exit(3);
});
