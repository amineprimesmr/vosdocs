#!/usr/bin/env node
/**
 * Relance la livraison rapport VIN (PDF + email + DB) pour un PaymentIntent déjà payé.
 * Usage (clés LIVE dans .env) :
 *   node scripts/manual-fulfill-payment.js pi_3TNY9VP1WUBVi2xj0D5lrB9W
 */
require('dotenv').config();
const Stripe = require('stripe');
const { fulfillGuestVinOrder } = require('../lib/fulfill-vin-order');

const piId = process.argv[2];
if (!piId || !piId.startsWith('pi_')) {
  console.error('Usage: node scripts/manual-fulfill-payment.js <payment_intent_id>');
  process.exit(1);
}

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY manquant dans .env');
  process.exit(1);
}

async function main() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const pi = await stripe.paymentIntents.retrieve(piId);
  console.log('PaymentIntent:', pi.id, '| status:', pi.status);
  console.log('Metadata:', pi.metadata);
  if (pi.status !== 'succeeded') {
    console.error('Le paiement n’est pas en succeeded. Abandon.');
    process.exit(1);
  }
  const result = await fulfillGuestVinOrder(stripe, pi);
  console.log('Résultat fulfillGuestVinOrder:', JSON.stringify(result, null, 2));
  if (result.skipped && result.reason === 'stripe_meta') {
    console.log(
      '\nSi le client n’a rien reçu : ouvre Stripe → ce PaymentIntent → métadonnées → supprime cg_fulfilled → relance ce script.'
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
