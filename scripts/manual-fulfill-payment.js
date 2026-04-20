#!/usr/bin/env node
/**
 * Relance la livraison rapport VIN (PDF + email + DB) pour un PaymentIntent déjà payé.
 * Usage (clés LIVE dans .env) :
 *   node scripts/manual-fulfill-payment.js pi_3TNY9VP1WUBVi2xj0D5lrB9W
 */
require('dotenv').config();
console.log('Script fulfill: .env chargé — appel Stripe…');

const Stripe = require('stripe');

const piId = process.argv[2];
if (!piId || !piId.startsWith('pi_')) {
  console.error('Usage: node scripts/manual-fulfill-payment.js <payment_intent_id>');
  process.exit(1);
}

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY manquant dans .env');
  process.exit(1);
}

async function disconnectDb() {
  try {
    const { getPrisma } = require('../lib/prisma');
    const prisma = getPrisma();
    if (prisma) await prisma.$disconnect();
  } catch (_) {
    /* ignore */
  }
}

async function main() {
  console.log('Récupération du PaymentIntent', piId, '…');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    timeout: 25_000,
    maxNetworkRetries: 2
  });
  const pi = await stripe.paymentIntents.retrieve(piId);
  console.log('PaymentIntent:', pi.id, '| status:', pi.status);
  console.log('Metadata:', pi.metadata);
  if (pi.status !== 'succeeded') {
    console.error('Le paiement n’est pas en succeeded. Abandon.');
    await disconnectDb();
    process.exit(1);
  }

  console.log('Chargement fulfillment (PDF, emails, DB)…');
  const { fulfillGuestVinOrder } = require('../lib/fulfill-vin-order');
  const result = await fulfillGuestVinOrder(stripe, pi);
  console.log('Résultat fulfillGuestVinOrder:', JSON.stringify(result, null, 2));
  if (result.skipped && result.reason === 'stripe_meta') {
    console.log(
      '\nSi le client n’a rien reçu : ouvre Stripe → ce PaymentIntent → métadonnées → supprime cg_fulfilled → relance ce script.'
    );
  }

  await disconnectDb();
  process.exit(result.ok === false ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDb();
  process.exit(1);
});
