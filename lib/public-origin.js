'use strict';

const PUBLIC_HOSTS = new Set([
  'carvinguard.ma', 'www.carvinguard.ma',
  'carvinguard.fr', 'www.carvinguard.fr'
]);

// Les retours de paiement restent sur le domaine visité. Ne pas utiliser un
// Host arbitraire ou X-Forwarded-Host pour construire une redirection Stripe.
function requestOrigin(req) {
  const host = String(req && req.headers && req.headers.host || '').toLowerCase();
  return PUBLIC_HOSTS.has(host) ? 'https://' + host + (req.market === 'MA' ? '/ma' : '') : null;
}

function trustedOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && PUBLIC_HOSTS.has(url.host) && !url.username && !url.password
      ? url.origin + (/^\/ma(?:\/|$)/.test(url.pathname) ? '/ma' : '') : null;
  } catch (_) { return null; }
}

module.exports = { requestOrigin, trustedOrigin };
