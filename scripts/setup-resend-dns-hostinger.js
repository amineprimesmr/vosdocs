#!/usr/bin/env node
/**
 * Ajoute les enregistrements DNS Resend pour carvinguard.fr via l’API Hostinger.
 * Prérequis : token API Hostinger (hPanel → Profil → API)
 *   export HOSTINGER_API_TOKEN=...
 *   node scripts/setup-resend-dns-hostinger.js
 */
require('dotenv').config();
require('dotenv').config({ path: '.env.local' });

const DOMAIN = process.env.RESEND_DNS_DOMAIN || 'carvinguard.fr';
const API = 'https://developers.hostinger.com/api/dns/v1/zones/' + DOMAIN;

const RESEND_RECORDS = [
  {
    name: 'resend._domainkey',
    type: 'TXT',
    ttl: 3600,
    records: [
      {
        content:
          'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC9d8UlmSCpVkYzpsMdMmxo5I+mpKTlZFmPhYC3vixv8xncZhQMovJAdRN7Oy2A7VpH1W3IepmXSy3l+bgXIyoDQ0g0d86rJxxF5E7f8kAoEQdTJVpDZUdTwNKmKkrL2iUvCcXNgpXnPiBODI+4gh9Z9ekBEZ9VAKYG3kHX4k0CKwIDAQAB'
      }
    ]
  },
  {
    name: 'send',
    type: 'MX',
    ttl: 3600,
    records: [{ content: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 }]
  },
  {
    name: 'send',
    type: 'TXT',
    ttl: 3600,
    records: [{ content: 'v=spf1 include:amazonses.com ~all' }]
  }
];

async function main() {
  const token = process.env.HOSTINGER_API_TOKEN;
  if (!token) {
    console.error(
      'HOSTINGER_API_TOKEN manquant.\n' +
        'Crée un token sur Hostinger (hPanel → API) puis :\n' +
        '  HOSTINGER_API_TOKEN=xxx node scripts/setup-resend-dns-hostinger.js'
    );
    process.exit(1);
  }

  const body = { overwrite: false, zone: RESEND_RECORDS };
  const headers = {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json'
  };

  const validateRes = await fetch(API + '/validate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!validateRes.ok) {
    const t = await validateRes.text();
    console.error('Validation DNS échouée:', validateRes.status, t);
    process.exit(1);
  }
  console.log('Validation DNS OK');

  const updateRes = await fetch(API, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!updateRes.ok) {
    const t = await updateRes.text();
    console.error('Mise à jour DNS échouée:', updateRes.status, t);
    process.exit(1);
  }
  console.log('Enregistrements Resend ajoutés pour', DOMAIN);
  console.log('Attends 5–30 min puis : curl -X POST https://api.resend.com/domains/<id>/verify -H "Authorization: Bearer $RESEND_API_KEY"');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
