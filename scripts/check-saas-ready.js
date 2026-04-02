#!/usr/bin/env node
/**
 * Vérifie les variables utiles au mode SaaS (comptes + crédits).
 *
 * Usage :
 *   npm run saas:check              — variables minimales (test ou prod)
 *   npm run saas:check:prod         — exige clés LIVE + liens + webhook (déploiement réel)
 */
require('dotenv').config();

const prod = process.argv.includes('--prod');

const checks = [
  ['DATABASE_URL', 'Base PostgreSQL (blog + utilisateurs)'],
  ['JWT_SECRET', 'Sessions / inscription (npm run gen:jwt-secret)'],
  ['STRIPE_SECRET_KEY', 'Paiements Stripe'],
  ['STRIPE_PUBLISHABLE_KEY', 'Stripe côté navigateur'],
  ['VEHICLEDATABASES_API_KEY', 'Décodage VIN (optionnel sans clé = mode dégradé)']
];

const linkVars = [
  'STRIPE_PAYMENT_LINK_ESSENTIEL',
  'STRIPE_PAYMENT_LINK_CONFORT',
  'STRIPE_PAYMENT_LINK_PREMIUM'
];

function looksLikeStripeLink(s) {
  return typeof s === 'string' && /^https:\/\/(buy\.stripe\.com|payment\.link)/i.test(s.trim());
}

let ok = true;
console.log('Carvinguard — vérification SaaS' + (prod ? ' (PRODUCTION)' : '') + '\n');

for (const [key, desc] of checks) {
  const v = process.env[key];
  const set = v && String(v).trim().length > 0;
  if (!set && key !== 'VEHICLEDATABASES_API_KEY') ok = false;
  console.log(set ? '✓' : '✗', key, '—', desc);
}

const sk = process.env.STRIPE_SECRET_KEY || '';
const pk = process.env.STRIPE_PUBLISHABLE_KEY || '';

if (sk && pk) {
  const skTest = sk.startsWith('sk_test');
  const pkTest = pk.startsWith('pk_test');
  const skLive = sk.startsWith('sk_live');
  const pkLive = pk.startsWith('pk_live');
  if ((skTest && pkLive) || (skLive && pkTest)) {
    console.log('✗ Incohérence : STRIPE_SECRET_KEY et STRIPE_PUBLISHABLE_KEY doivent être tous deux test ou tous deux live.');
    ok = false;
  }
}

if (prod) {
  if (!sk.startsWith('sk_live')) {
    console.log('✗ PROD : STRIPE_SECRET_KEY doit commencer par sk_live_');
    ok = false;
  }
  if (!pk.startsWith('pk_live')) {
    console.log('✗ PROD : STRIPE_PUBLISHABLE_KEY doit commencer par pk_live_');
    ok = false;
  }
  const wh = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!wh || !wh.startsWith('whsec_')) {
    console.log('✗ PROD : STRIPE_WEBHOOK_SECRET (whsec_…) — créer un endpoint Live sur https://<domaine>/api/stripe-webhook');
    ok = false;
  } else {
    console.log('✓ STRIPE_WEBHOOK_SECRET — présent');
  }
  for (const key of linkVars) {
    const v = process.env[key];
    const set = v && String(v).trim().length > 0;
    if (!set || !looksLikeStripeLink(v)) {
      console.log('✗ PROD :', key, '— URL Payment Link Stripe manquante ou invalide (npm run stripe:setup avec sk_live_ + BASE_URL prod)');
      ok = false;
    } else {
      console.log('✓', key);
    }
  }
  const base = (process.env.BASE_URL || '').trim();
  if (!base.startsWith('https://')) {
    console.log('✗ PROD : BASE_URL doit être en https:// (ex. https://www.carvinguard.fr)');
    ok = false;
  } else {
    console.log('✓ BASE_URL —', base);
  }

  // Abonnement mensuel : si activé, on exige les deux prix
  const subInitial = process.env.SUBSCRIPTION_PRICE_INITIAL_ID;
  const subMonthly = process.env.SUBSCRIPTION_PRICE_MONTHLY_ID;
  if (subInitial || subMonthly) {
    if (!subInitial || !subMonthly) {
      console.log('✗ PROD : abonnement — définis à la fois SUBSCRIPTION_PRICE_INITIAL_ID et SUBSCRIPTION_PRICE_MONTHLY_ID (sinon on désactive l’offre).');
      ok = false;
    } else {
      console.log('✓ Abonnement Stripe — prix initial + prix mensuel configurés');
    }
    const creditsPerCycle = parseInt(process.env.SUBSCRIPTION_CREDITS_PER_CYCLE || '0', 10);
    if (!creditsPerCycle || creditsPerCycle < 1) {
      console.log('✗ PROD : SUBSCRIPTION_CREDITS_PER_CYCLE doit être >= 1');
      ok = false;
    } else {
      console.log('✓ Abonnement — credits/mois :', creditsPerCycle);
    }
  }
} else {
  const wh = process.env.STRIPE_WEBHOOK_SECRET;
  console.log(wh ? '✓' : '○', 'STRIPE_WEBHOOK_SECRET', '—', wh ? 'présent' : 'optionnel tant que pas de crédits / commandes webhook');
  for (const key of linkVars) {
    const v = process.env[key];
    const set = v && String(v).trim().length > 0;
    console.log(set ? '✓' : '○', key, '—', set ? 'présent' : 'pour checkout.html (stripe:setup)');
  }
}

console.log('');
if (ok) {
  if (prod) {
    console.log('Checklist prod OK. Déploie sur Vercel avec les mêmes variables, puis vérifie le débit via Stripe Webhook.');
  } else {
    console.log('Variables minimales présentes. Pour la prod : npm run saas:check:prod');
    console.log('Pense à : npx prisma db push + webhook Stripe (événement payment_intent.succeeded).');
  }
  process.exit(0);
}
console.log('Complète ton .env (voir .env.example), puis relance ce script.');
process.exit(1);
