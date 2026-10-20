'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../lib/auth');
const provider = require('../lib/vin-provider');
const { requestOrigin, trustedOrigin } = require('../lib/public-origin');

process.env.JWT_SECRET = 'test-only-not-a-production-secret';

test('invitation is not an auth session, and is bound to the previous password', () => {
  const invite = auth.signAccountInviteToken('fixture-user', 'old-hash');
  assert.equal(auth.verifyAuthToken(invite), null);
  assert.equal(auth.verifyAccountInviteToken(invite, 'old-hash'), 'fixture-user');
  assert.equal(auth.verifyAccountInviteToken(invite, 'new-hash'), null);
  const session = auth.signAuthToken('fixture-user');
  assert.equal(auth.verifyAuthToken(session).sub, 'fixture-user');
  assert.equal(auth.verifyAccountInviteToken(session, 'old-hash'), null);
});

test('VIN provider honours explicit selection; never substitutes a shared key', () => {
  const vars = ['CARAPI_TOKEN','CARAPI_API_KEY','VEHICLEDATABASES_API_KEY','VIN_DECODE_PROVIDER','SKIP_VEHICLE_DATABASES'];
  const saved = Object.fromEntries(vars.map(k => [k, process.env[k]]));
  try {
    vars.forEach(k => delete process.env[k]);
    assert.equal(provider.getVinDecodeProvider(), null);
    process.env.CARAPI_TOKEN = 'test-carapi';
    process.env.VEHICLEDATABASES_API_KEY = 'test-vd';
    assert.equal(provider.getVinDecodeProvider().id, 'vehicledatabases');
    process.env.VIN_DECODE_PROVIDER = 'carapi';
    assert.equal(provider.getVinDecodeProvider().id, 'carapi');
    process.env.VIN_DECODE_PROVIDER = 'vehicledatabases';
    process.env.SKIP_VEHICLE_DATABASES = '1';
    assert.equal(provider.getVinDecodeProvider(), null);
    delete process.env.VIN_DECODE_PROVIDER;
    assert.equal(provider.getVinDecodeProvider().id, 'carapi');
    delete process.env.CARAPI_TOKEN;
    assert.equal(provider.getVinDecodeProvider(), null);
  } finally { for (const k of vars) saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k]; }
});

test('checkout origin preserves .ma and rejects forged host/origin values', () => {
  assert.equal(requestOrigin({headers:{host:'www.carvinguard.ma'}}), 'https://www.carvinguard.ma');
  assert.equal(requestOrigin({headers:{host:'www.carvinguard.fr'}}), 'https://www.carvinguard.fr');
  assert.equal(requestOrigin({headers:{host:'attacker.example','x-forwarded-host':'www.carvinguard.ma'}}), null);
  assert.equal(trustedOrigin('https://www.carvinguard.ma/compte.html'), 'https://www.carvinguard.ma');
  assert.equal(trustedOrigin('https://www.carvinguard.ma.attacker.example'), null);
  assert.equal(trustedOrigin('https://user:password@www.carvinguard.ma'), null);
  assert.equal(trustedOrigin('http://www.carvinguard.ma'), null);
});
