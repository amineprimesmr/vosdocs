#!/usr/bin/env node
/**
 * Vérifie qu’une URL de webhook ne renvoie pas de redirection (301/307).
 * Stripe ne suit pas les redirections → échec silencieux des livraisons.
 *
 * Usage :
 *   npm run verify:webhook
 *   npm run verify:webhook -- https://carvinguard.com/api/stripe-webhook
 */
require('dotenv').config();

const defaultUrl = () => {
  const base = String(process.env.APP_ORIGIN || process.env.BASE_URL || '').trim().replace(/\/$/, '');
  return base ? `${base}/api/stripe-webhook` : '';
};

async function main() {
  const target = process.argv[2] || defaultUrl();
  if (!target || !target.startsWith('http')) {
    console.error('Définis APP_ORIGIN ou BASE_URL dans .env, ou passe l’URL complète :\n');
    console.error('  npm run verify:webhook -- https://www.carvinguard.fr/api/stripe-webhook\n');
    process.exit(1);
  }

  console.log('Test (GET, sans suivre les redirections) :', target, '\n');

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  let res;
  try {
    res = await fetch(target, { method: 'GET', redirect: 'manual', signal: ac.signal });
  } catch (e) {
    console.error('Erreur réseau :', e.message || e);
    process.exit(1);
  } finally {
    clearTimeout(t);
  }

  const loc = res.headers.get('location');
  console.log('Code HTTP :', res.status);
  if (loc) console.log('Header Location :', loc);

  if (res.status >= 300 && res.status < 400) {
    console.error(
      '\n❌ REDIRECTION détectée. Stripe enverra le webhook en POST et recevra ce code → livraison (PDF/email) ne part pas.\n'
    );
    console.error('→ Dans Stripe : Développeurs → Webhooks → modifie l’URL vers la destination FINALE (souvent avec www), sans redirection.\n');
    console.error('→ Exemple attendu : https://www.carvinguard.fr/api/stripe-webhook\n');
    process.exit(1);
  }

  if (res.status === 200) {
    console.log('\n✅ Pas de redirection (GET retourne 200 — endpoint joignable).');
    console.log('   Utilise cette même URL dans Stripe → Webhooks (mode Live).\n');
    process.exit(0);
  }

  if (res.status === 404 || res.status === 405) {
    console.log(
      '\n○ GET renvoie',
      res.status,
      '— souvent normal si l’ancien déploiement n’expose pas encore GET sur ce path. Stripe envoie en **POST** : l’essentiel est d’éviter les **3xx**.'
    );
    console.log('   Après déploiement du dernier code, un GET peut répondre 200 JSON (diagnostic).\n');
    process.exit(0);
  }

  console.log('\n○ Code HTTP', res.status, '— vérifie les tentatives webhook dans Stripe (POST).\n');
  process.exit(0);
}

main();
