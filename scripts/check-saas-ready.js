#!/usr/bin/env node
/**
 * Vérifie les variables utiles au mode SaaS (comptes + crédits).
 * Usage : node scripts/check-saas-ready.js
 */
require('dotenv').config();

const checks = [
  ['DATABASE_URL', 'Base PostgreSQL (blog + utilisateurs)'],
  ['JWT_SECRET', 'Sessions / inscription (npm run gen:jwt-secret)'],
  ['STRIPE_SECRET_KEY', 'Paiements Stripe'],
  ['STRIPE_PUBLISHABLE_KEY', 'Stripe côté navigateur'],
  ['VEHICLEDATABASES_API_KEY', 'Décodage VIN (optionnel sans clé = mode dégradé)']
];

let ok = true;
console.log('Carvinguard — vérification SaaS\n');
for (const [key, desc] of checks) {
  const v = process.env[key];
  const set = v && String(v).trim().length > 0;
  if (!set && key !== 'VEHICLEDATABASES_API_KEY') ok = false;
  console.log(set ? '✓' : '✗', key, '—', desc);
}
console.log('');
if (ok) {
  console.log('Variables minimales présentes. Pense à : npx prisma db push + webhook Stripe.');
  process.exit(0);
}
console.log('Complète ton .env (voir .env.example), puis relance ce script.');
process.exit(1);
