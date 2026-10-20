'use strict';

async function ensureSubscription(stripe, pi, options) {
  const {customerId, paymentMethodId, priceId, userId, creditsPerCycle, trialDays} = options;
  if (!paymentMethodId) throw new Error('Moyen de paiement manquant pour l’abonnement');
  let cursor;
  do {
    const page = await stripe.subscriptions.list({customer:customerId,status:'all',limit:100,...(cursor?{starting_after:cursor}:{})});
    const existing = page.data.find(s => s.metadata?.initialPaymentIntent === pi.id);
    if (existing) return existing;
    cursor = page.has_more && page.data.length ? page.data[page.data.length-1].id : null;
  } while (cursor);
  // Stable payload and key across concurrent deliveries and network retries.
  // The metadata lookup above also protects retries after Stripe's key retention.
  return stripe.subscriptions.create({
    customer:customerId,
    items:[{price:priceId,quantity:1}],
    default_payment_method:paymentMethodId,
    payment_behavior:'error_if_incomplete',
    payment_settings:{save_default_payment_method:'on_subscription',payment_method_types:['card']},
    ...(trialDays>0?{trial_period_days:trialDays}:{}),
    metadata:{purpose:'subscription_monthly_credits',userId:String(userId),creditsPerCycle:String(creditsPerCycle),initialPaymentIntent:pi.id}
  },{idempotencyKey:'carvinguard-subscription-'+pi.id});
}

module.exports = {ensureSubscription};
