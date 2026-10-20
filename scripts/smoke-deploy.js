'use strict';
// Read-only checks plus requests deliberately rejected before any mutation.
const assert = require('node:assert/strict');
const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base)) throw new Error('Usage: node scripts/smoke-deploy.js https://domain');
const checks = [
  ['/', 'GET', 200, '<html'],
  ['/ma', 'GET', 200, '<html'],
  ['/ma/', 'GET', 200, '<html'],
  ['/checkout.html', 'GET', 200, 'après 24 heures'],
  ['/api/saas-config', 'GET', 200, 'authAvailable'],
  ['/resiliation-abonnement.html', 'GET', 200, 'subscriptionsList'],
  ['/api/billing/subscriptions', 'GET', 401, null],
  ['/api/billing/cancel-subscription', 'POST', 401, null],
  ['/api/auth/me', 'GET', 401, 'authenticated'],
  ['/api/vin/history', 'GET', 401, null],
  ['/api/vin-decode/INVALID?preview=1', 'GET', 400, 'VIN invalide'],
  ['/api/auth/request-access', 'POST', 400, 'email invalide'],
  ['/api/create-payment-intent', 'POST', 410, 'remplacé'],
  ['/api/email-status', 'GET', 404, null],
  ['/api/cron/generate-articles', 'GET', 401, null],
  ['/api/stripe-webhook', 'POST', 400, null]
];
(async () => {
  for (const [path, method, status, fragment] of checks) {
    const response = await fetch(new URL(path, base), {
      method, redirect: 'follow', signal: AbortSignal.timeout(20000),
      ...(method === 'POST' ? {headers:{'Content-Type':'application/json'},body:'{}'} : {})
    });
    const body = await response.text();
    assert.equal(response.status, status, `${method} ${path}`);
    if (fragment) assert.ok(body.includes(fragment), `${path}: expected response body`);
    console.log(`OK ${method} ${path} ${status}`);
  }
})().catch(error => {console.error(error.message);process.exitCode=1;});
