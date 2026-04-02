#!/usr/bin/env node
/**
 * Guide Stripe + création automatique des Payment Links (si .env est prêt).
 * Usage : npm run stripe:tout
 */
require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const snippetPath = path.join(root, 'STRIPE-COLLER-VERCEL.txt');

function line() {
  console.log('\n' + '─'.repeat(56) + '\n');
}

function title(t) {
  console.log('\n  ▶ ' + t + '\n');
}

console.log(`
╔══════════════════════════════════════════════════════════╗
║  Carvinguard — Stripe : on fait simple                   ║
╚══════════════════════════════════════════════════════════╝
`);

title('ÉTAPE 1 — Remplir le fichier .env sur ton ordinateur');
console.log(`Ouvre le dossier du projet. Crée ou édite le fichier  .env  (à la racine).

Colle ces 3 lignes (remplace par TES vraies clés depuis dashboard.stripe.com) :

  STRIPE_SECRET_KEY=sk_live_.........................
  STRIPE_PUBLISHABLE_KEY=pk_live_.....................
  BASE_URL=https://www.carvinguard.fr

Où trouver les clés Stripe ?
  1. Va sur https://dashboard.stripe.com
  2. En haut : vérifie que c’est bien « Mode réel » / Live (pas Test).
  3. Menu gauche : Développeurs → Clés API.
  4. « Clé publique » → copier → STRIPE_PUBLISHABLE_KEY
  5. « Clé secrète » → Afficher → copier → STRIPE_SECRET_KEY

⚠️  Ne envoie JAMAIS la clé secrète (sk_live…) dans un chat ou un mail.`);

const sk = (process.env.STRIPE_SECRET_KEY || '').trim();
const pk = (process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
const baseUrl = (process.env.BASE_URL || '').trim();

if (!sk || !sk.startsWith('sk_')) {
  line();
  console.log('⏸  Je m’arrête ici : STRIPE_SECRET_KEY manque dans .env.');
  console.log('    Quand c’est fait, relance :  npm run stripe:tout\n');
  process.exit(1);
}

if (!pk || !pk.startsWith('pk_')) {
  line();
  console.log('⏸  STRIPE_PUBLISHABLE_KEY manque dans .env. Ajoute-la puis relance.\n');
  process.exit(1);
}

if (!baseUrl.startsWith('https://')) {
  line();
  console.log('⏸  BASE_URL doit être comme : https://www.carvinguard.fr');
  console.log('    Ajoute-la dans .env puis relance.\n');
  process.exit(1);
}

if (sk.startsWith('sk_test') !== pk.startsWith('pk_test')) {
  line();
  console.log('⏸  Les deux clés doivent être toutes en Test OU toutes en Live.');
  process.exit(1);
}

title('ÉTAPE 2 — Création automatique des 3 liens de paiement sur Stripe');
console.log('J’exécute le script catalogue (produits + prix + Payment Links)…\n');

try {
  execSync('node "' + path.join(__dirname, 'stripe-create-catalog.js') + '"', {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
} catch (e) {
  line();
  console.log('Erreur pendant stripe:setup. Vérifie ta clé et ta connexion internet.\n');
  process.exit(1);
}

const resultPath = path.join(root, '.stripe-setup-result.json');
let links = null;
try {
  links = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
} catch (e) {
  links = null;
}

title('ÉTAPE 3 — Webhook (obligatoire pour les commandes / crédits)');
const webhookUrl = baseUrl.replace(/\/$/, '') + '/api/stripe-webhook';
console.log(`Dans Stripe (toujours en même mode Test ou Live que tes clés) :

  1. Développeurs → Webhooks → « Ajouter un point de terminaison »
  2. URL :  ${webhookUrl}
  3. Événements : choisis  payment_intent.succeeded
  4. Créer → clique le webhook → « Secret de signature » → révéler → copier (whsec_…)

Dans .env ajoute :
  STRIPE_WEBHOOK_SECRET=whsec_........................

Puis sur Vercel : même variable STRIPE_WEBHOOK_SECRET (Production).`);

title('ÉTAPE 4 — Coller sur Vercel');
console.log(`Vercel → ton projet → Settings → Environment Variables → Production.

Ouvre le fichier  STRIPE-COLLER-VERCEL.txt  à la racine du projet : tout y est prêt à copier-coller.
⚠️  Ce fichier contient tes clés : ne le commite pas, ne l’envoie pas par mail.`);

const bu = links && links.baseUrl ? links.baseUrl : baseUrl.replace(/\/$/, '');
const linesOut = [
  '# Copie chaque ligne dans Vercel → Environment Variables → Production',
  '# Fichier généré par npm run stripe:tout — NE PAS COMMITER (déjà dans .gitignore)',
  '',
  'BASE_URL=' + bu,
  'STRIPE_SECRET_KEY=' + sk,
  'STRIPE_PUBLISHABLE_KEY=' + pk,
  'STRIPE_WEBHOOK_SECRET=COLLE_whsec_APRES_CREATION_DU_WEBHOOK',
  links
    ? 'STRIPE_PAYMENT_LINK_ESSENTIEL=' + links.STRIPE_PAYMENT_LINK_ESSENTIEL
    : 'STRIPE_PAYMENT_LINK_ESSENTIEL=(relance npm run stripe:setup si vide)',
  links
    ? 'STRIPE_PAYMENT_LINK_CONFORT=' + links.STRIPE_PAYMENT_LINK_CONFORT
    : 'STRIPE_PAYMENT_LINK_CONFORT=',
  links
    ? 'STRIPE_PAYMENT_LINK_PREMIUM=' + links.STRIPE_PAYMENT_LINK_PREMIUM
    : 'STRIPE_PAYMENT_LINK_PREMIUM=',
  ''
].join('\n');

try {
  fs.writeFileSync(snippetPath, linesOut, 'utf8');
} catch (e) {
  /* ignore */
}

line();
console.log('✓  Script terminé.');
console.log('   1. Ouvre STRIPE-COLLER-VERCEL.txt → copie les variables sur Vercel (Production).');
console.log('   2. Crée le webhook Stripe, remplace COLLE_whsec… par le vrai whsec_ sur Vercel + .env.');
console.log('   3. Redéploie Vercel. Puis : npm run saas:check:prod\n');
