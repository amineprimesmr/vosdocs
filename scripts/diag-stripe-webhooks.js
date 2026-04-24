#!/usr/bin/env node
/**
 * Diagnostic : même compte / mode que Vercel + webhooks + activité récente.
 * Usage (avec le même .env qu’en prod, ou STRIPE_SECRET_KEY=sk_live_… en préfixe) :
 *   node scripts/diag-stripe-webhooks.js
 *   npm run stripe:diag-webhooks
 */
require('dotenv').config();
const Stripe = require('stripe');

const sk = String(process.env.STRIPE_SECRET_KEY || '').trim();
if (!sk) {
  console.error('Définis STRIPE_SECRET_KEY (même clé que sur Vercel / Production).');
  process.exit(1);
}

const isTest = sk.startsWith('sk_test_');
const isLive = sk.startsWith('sk_live_');
console.log('Clé :', isTest ? 'MODE TEST' : isLive ? 'MODE LIVE' : 'PRÉFIXE INCONNU');
console.log('');

const stripe = new Stripe(sk);

async function main() {
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const ours = (endpoints.data || []).filter(
    (e) => e.url && e.url.includes('carvinguard') && e.url.includes('stripe-webhook')
  );
  if (ours.length === 0) {
    console.log(
      "Aucun endpoint ne contient « carvinguard » + « stripe-webhook ». Liste complète (domaines) :\n"
    );
    for (const e of endpoints.data) {
      console.log('-', e.id, e.status, e.url, e.livemode ? 'LIVE' : 'TEST');
    }
  } else {
    for (const e of ours) {
      console.log('ID      :', e.id);
      console.log('URL     :', e.url);
      console.log('Statut  :', e.status);
      console.log('Mode    :', e.livemode ? 'LIVE (reçoit seulement les paiements live)' : 'TEST');
      console.log('Evts    :', (e.enabled_events || []).length ? e.enabled_events.join(', ') : '(aucun — problème !)');
      const need = ['checkout.session.completed', 'payment_intent.succeeded'];
      const miss = need.filter((n) => !(e.enabled_events || []).includes(n));
      if (miss.length) {
        console.log('\n⚠️  Manque pour Carvinguard (recommandé) : ' + need.join(', '));
      } else {
        console.log("\n✓  Types d’événements contiennent au minimum l’essentiel pour le checkout.");
      }
    }
  }

  console.log('\n— Activité récente (5 derniers Paiements / PaymentIntents) —');
  try {
    const pi = await stripe.paymentIntents.list({ limit: 5 });
    if (!pi.data.length) {
      console.log("Aucun PaymentIntent listé. Soit compte inactif, soit mauvais mode (test vs live).");
    } else {
      for (const p of pi.data) {
        console.log(
          p.id,
          p.status,
          p.amount,
          p.currency,
          p.livemode ? 'live' : 'test',
          p.description || ''
        );
      }
    }
  } catch (e) {
    console.error('Erreur list PI :', e.message);
  }

  console.log(
    '\nSi le webhook est en LIVE et ta clé Vercel est en sk_test_ (ou l’inverse), le dashboard Stripe affichera 0 envoi côté « mauvais » endpoint.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
