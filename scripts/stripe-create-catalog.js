#!/usr/bin/env node
/**
 * Crée sur Stripe (une fois) les 3 produits Carvinguard + prix EUR + Payment Links.
 *
 * Production : STRIPE_SECRET_KEY=sk_live_… + BASE_URL=https://ton-domaine.fr puis npm run stripe:setup
 * (même script ; Stripe applique le mode selon la clé.)
 *
 * Développement : sk_test_… pour ne pas encaisser d’argent réel.
 *
 * Copier la sortie dans Vercel → Environment Variables (Production).
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');

const PLANS = [
  {
    id: 'essentiel',
    name: 'Carvinguard — Rapport VIN unique',
    description: '1 rapport historique véhicule (VIN)',
    amountCents: 1499,
    envVar: 'STRIPE_PAYMENT_LINK_ESSENTIEL'
  },
  {
    id: 'confort',
    name: 'Carvinguard — Pack 3 rapports VIN',
    description: '3 rapports VIN — meilleur rapport qualité-prix',
    amountCents: 2999,
    envVar: 'STRIPE_PAYMENT_LINK_CONFORT'
  },
  {
    id: 'premium',
    name: 'Carvinguard — Pack Pro (10 rapports VIN)',
    description: '10 rapports VIN pour professionnels / volume',
    amountCents: 6999,
    envVar: 'STRIPE_PAYMENT_LINK_PREMIUM'
  }
];

async function main() {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk || !sk.startsWith('sk_')) {
    console.error(
      'Erreur : définissez STRIPE_SECRET_KEY dans .env (clé secrète sk_test_… ou sk_live_…).'
    );
    process.exit(1);
  }

  const baseUrl = (process.env.BASE_URL || 'https://www.carvinguard.fr').replace(/\/$/, '');
  const stripe = new Stripe(sk);

  console.log('\n=== Carvinguard × Stripe — création catalogue ===\n');
  if (sk.startsWith('sk_test')) {
    console.log('Mode : TEST (sk_test_)\n');
  } else {
    console.log('Mode : LIVE (sk_live_) — vérifiez bien avant de valider.\n');
  }

  const results = [];

  for (const plan of PLANS) {
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: { carvinguard_plan: plan.id, app: 'carvinguard' }
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.amountCents,
      currency: 'eur',
      metadata: { carvinguard_plan: plan.id }
    });

    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        carvinguard_plan: plan.id,
        app: 'carvinguard',
        purpose: 'vin_report_guest'
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          url: baseUrl + '/confirmation.html?session_id={CHECKOUT_SESSION_ID}'
        }
      }
    });

    const eur = (plan.amountCents / 100).toFixed(2).replace('.', ',');
    console.log('— ' + plan.name + ' — ' + eur + ' € TTC');
    console.log('  Product ID :', product.id);
    console.log('  Price ID   :', price.id);
    console.log('  Link       :', paymentLink.url);
    console.log('');

    results.push({ envVar: plan.envVar, url: paymentLink.url });
  }

  console.log('=== Variables à copier (Vercel → Environment Variables) ===\n');
  results.forEach(function (r) {
    console.log(r.envVar + '=' + r.url);
  });
  console.log('\n=== Local (.env) ===\n');
  results.forEach(function (r) {
    console.log(r.envVar + '=' + r.url);
  });
  console.log('\nTerminé. Redéployez Vercel après avoir enregistré les variables.\n');

  const out = { baseUrl };
  results.forEach(function (r) {
    out[r.envVar] = r.url;
  });
  try {
    fs.writeFileSync(
      path.join(__dirname, '..', '.stripe-setup-result.json'),
      JSON.stringify(out, null, 2),
      'utf8'
    );
  } catch (e) {
    /* ignore */
  }
}

main().catch(function (err) {
  console.error(err.message || err);
  if (err.raw) console.error(JSON.stringify(err.raw, null, 2));
  process.exit(1);
});
