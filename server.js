/**
 * Carvinguard - Serveur API
 * Sert les pages, départements et paiement Stripe
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Stripe = require('stripe');
const cookieParser = require('cookie-parser');
const { getPrisma } = require('./lib/prisma');
const authLib = require('./lib/auth');
const { fulfillGuestVinOrder, paymentIntentToOrder, appBaseUrl } = require('./lib/fulfill-vin-order');
const { sendTeamOrderEmail, sendAccountInviteEmail, sendWalletCreditsEmail } = require('./lib/order-emails');
const { generateReportPdfBuffer } = require('./lib/report-pdf');
const carapiClient = require('./lib/carapi-client');

const app = express();
const PORT = process.env.PORT || 3000;
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

/** Inscription email/mot de passe directe. Par défaut désactivée : le compte est créé après paiement Stripe (webhook + invitation). */
function isOpenRegistrationAllowed() {
  return String(process.env.REGISTRATION_OPEN || '').toLowerCase() === 'true';
}

app.use(cors({ origin: true, credentials: true }));
// Webhook Stripe doit recevoir le body brut AVANT express.json()
const ORDERS_FILE = path.join(__dirname, 'data', 'commandes.json');

function orderAlreadyInFile(paymentIntentId) {
  if (!paymentIntentId || !fs.existsSync(ORDERS_FILE)) return false;
  try {
    const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    return Array.isArray(orders) && orders.some((o) => o.id === paymentIntentId);
  } catch (e) {
    return false;
  }
}

function saveOrder(order) {
  try {
    if (order.id && orderAlreadyInFile(order.id)) return;
    let orders = [];
    if (fs.existsSync(ORDERS_FILE)) {
      orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    }
    orders.push(Object.assign({}, order, { date: new Date().toISOString() }));
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
    console.log('Commande enregistrée:', order.email || order.vin);
  } catch (e) {
    console.error('Erreur sauvegarde commande:', e);
  }
}

function normalizeVinMeta(s) {
  return String(s || '')
    .replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '')
    .toUpperCase();
}

/** Cache listage prix Stripe (évite un appel à chaque clic). */
let __stripeCatalogCache = { ts: 0, ttlMs: 60 * 60 * 1000, value: null };

async function listAllActivePricesStripe(stripe) {
  const out = [];
  let starting_after;
  for (let page = 0; page < 15; page++) {
    const r = await stripe.prices.list({
      active: true,
      limit: 100,
      starting_after,
      expand: ['data.product']
    });
    out.push(...r.data);
    if (!r.has_more || !r.data.length) break;
    starting_after = r.data[r.data.length - 1].id;
  }
  return out;
}

function stripePriceProductName(price) {
  const p = price.product;
  if (p && typeof p === 'object' && p.name) return String(p.name);
  return '';
}

function pickStripePriceByAmountAndHints(candidates, hints) {
  if (!candidates || !candidates.length) return null;
  if (candidates.length === 1) return candidates[0].id;
  const hl = (hints || []).map((h) => h.toLowerCase());
  let bestId = candidates[0].id;
  let bestScore = -1;
  for (const c of candidates) {
    const n = stripePriceProductName(c).toLowerCase();
    const score = hl.reduce((s, h) => s + (h && n.includes(h) ? 2 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestId = c.id;
    }
  }
  return bestId;
}

/**
 * Résout automatiquement les price_… du catalogue Stripe (aucune variable obligatoire).
 * Priorité : env TIER_*_PRICE_ID / SUBSCRIPTION_PRICE_* > matching montant + nom produit > vide (fallback price_data côté packs).
 */
async function resolveCarvinguardStripeCatalog(stripe) {
  const now = Date.now();
  if (__stripeCatalogCache.value && now - __stripeCatalogCache.ts < __stripeCatalogCache.ttlMs) {
    return __stripeCatalogCache.value;
  }

  const essCents = parseInt(process.env.TIER_ESSENTIEL_CENTS || '1499', 10);
  const confCents = parseInt(process.env.TIER_CONFORT_CENTS || '2999', 10);
  const premCents = parseInt(process.env.TIER_PREMIUM_CENTS || '6999', 10);
  const subInitialCents = parseInt(process.env.SUBSCRIPTION_INITIAL_CENTS_FOR_DISPLAY || '100', 10);
  const subMonthlyCents = parseInt(process.env.SUBSCRIPTION_MONTHLY_CENTS_FOR_DISPLAY || '4999', 10);

  let prices = [];
  try {
    prices = await listAllActivePricesStripe(stripe);
  } catch (e) {
    console.error('resolveCarvinguardStripeCatalog list prices:', e.message);
  }

  const eurOneTime = prices.filter(
    (p) => p.currency === 'eur' && p.type === 'one_time' && typeof p.unit_amount === 'number'
  );
  const eurMonthly = prices.filter(
    (p) =>
      p.currency === 'eur' &&
      p.type === 'recurring' &&
      p.recurring &&
      p.recurring.interval === 'month' &&
      typeof p.unit_amount === 'number'
  );

  const filterAmt = (arr, cents) => arr.filter((p) => p.unit_amount === cents);

  const credit = {
    essentiel:
      pickStripePriceByAmountAndHints(filterAmt(eurOneTime, essCents), [
        'certificat',
        'unique',
        'essentiel',
        'rapport',
        'vin',
        'carvinguard'
      ]),
    confort:
      pickStripePriceByAmountAndHints(filterAmt(eurOneTime, confCents), [
        'confort',
        '3',
        'rapport',
        'vin',
        'pack',
        '29'
      ]),
    premium:
      pickStripePriceByAmountAndHints(filterAmt(eurOneTime, premCents), [
        'pro',
        'premium',
        '10',
        'pack',
        '69'
      ])
  };

  const subInitialDisc = pickStripePriceByAmountAndHints(filterAmt(eurOneTime, subInitialCents), [
    'pack',
    'rapport',
    '1',
    'initial',
    'euro',
    'abonnement',
    'découverte'
  ]);
  const subMonthlyDisc = pickStripePriceByAmountAndHints(filterAmt(eurMonthly, subMonthlyCents), [
    'pack',
    'rapport',
    '49',
    'mensuel',
    'mois',
    'abonnement'
  ]);

  const value = {
    credit: {
      essentiel: process.env.TIER_ESSENTIEL_PRICE_ID || process.env.STRIPE_PRICE_ID_ESSENTIEL || credit.essentiel,
      confort: process.env.TIER_CONFORT_PRICE_ID || process.env.STRIPE_PRICE_ID_CONFORT || credit.confort,
      premium: process.env.TIER_PREMIUM_PRICE_ID || process.env.STRIPE_PRICE_ID_PREMIUM || credit.premium
    },
    subscription: {
      initial:
        process.env.SUBSCRIPTION_PRICE_INITIAL_ID || subInitialDisc,
      monthly: process.env.SUBSCRIPTION_PRICE_MONTHLY_ID || subMonthlyDisc
    }
  };

  __stripeCatalogCache = { ts: now, ttlMs: __stripeCatalogCache.ttlMs, value };
  return value;
}

/**
 * Ligne de panier packs crédits : catalogue auto (price_) ou prix inline si introuvable.
 */
function creditPackCheckoutLineItems(planKey, plan, catalogPriceId) {
  const envFirst = {
    essentiel: process.env.TIER_ESSENTIEL_PRICE_ID || process.env.STRIPE_PRICE_ID_ESSENTIEL,
    confort: process.env.TIER_CONFORT_PRICE_ID || process.env.STRIPE_PRICE_ID_CONFORT,
    premium: process.env.TIER_PREMIUM_PRICE_ID || process.env.STRIPE_PRICE_ID_PREMIUM
  };
  const pid = String(envFirst[planKey] || catalogPriceId || '').trim();
  if (pid.startsWith('price_')) {
    return [{ price: pid, quantity: 1 }];
  }
  return [
    {
      price_data: {
        currency: 'eur',
        unit_amount: plan.cents,
        product_data: {
          name: plan.name,
          description: 'Crédits rapport VIN — compte Carvinguard'
        }
      },
      quantity: 1
    }
  ];
}

/** Achat de crédits via Stripe (idempotent par payment_intent) */
async function handleStripeCreditPurchase(pi) {
  const m = pi.metadata || {};
  const prisma = getPrisma();

  // 1) Achat ponctuel de crédits (pack 5 / pack 20)
  if (m.purpose === 'credit_purchase') {
    if (!prisma) {
      console.warn('credit_purchase: DATABASE_URL requis');
      return false;
    }
    const userId = m.userId;
    const credits = parseInt(String(m.credits || '0'), 10);
    if (!userId || credits < 1) {
      console.warn('Métadonnées credit_purchase invalides', pi.id);
      return true;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const dup = await tx.creditTransaction.findUnique({
          where: { stripePaymentIntentId: pi.id }
        });
        if (dup) return;

        await tx.user.update({
          where: { id: userId },
          data: { credits: { increment: credits } }
        });

        await tx.creditTransaction.create({
          data: {
            userId,
            delta: credits,
            reason: 'purchase',
            stripePaymentIntentId: pi.id,
            meta: JSON.stringify({
              eur: (pi.amount / 100).toFixed(2),
              packId: m.packId || ''
            })
          }
        });
      });
    } catch (e) {
      console.error('Webhook crédits:', e);
    }
    return true;
  }

  // 2) Initial d’abonnement : 1€ puis création d’un abonnement mensuel
  if (m.purpose === 'subscription_initial') {
    if (!prisma) {
      console.warn('subscription_initial: DATABASE_URL requis');
      return false;
    }
    const userId = m.userId;
    const creditsPerCycle = parseInt(String(m.creditsPerCycle || '7'), 10);
    const subscriptionMonthlyPriceId = String(m.subscriptionMonthlyPriceId || '');
    const trialDays = parseInt(String(m.trialDays || '1'), 10);

    if (!userId || creditsPerCycle < 1 || !subscriptionMonthlyPriceId || trialDays < 0) {
      console.warn('Métadonnées subscription_initial invalides', pi.id);
      return true;
    }

    // Idempotence (paiement initial)
    const dup = await prisma.creditTransaction.findUnique({
      where: { stripePaymentIntentId: pi.id }
    });
    if (dup) return true;

    // Récup email utilisateur pour créer/reprendre un customer Stripe
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true }
    });
    if (!user?.email) {
      console.warn('subscription_initial: user introuvable', userId);
      return true;
    }

    // Crée ou récupère le customer Stripe
    const existingCustomers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customer =
      existingCustomers.data && existingCustomers.data.length > 0
        ? existingCustomers.data[0]
        : await stripe.customers.create({ email: user.email });

    // Associer le moyen de paiement du PaymentIntent au customer
    if (pi.payment_method) {
      try {
        await stripe.paymentMethods.attach(pi.payment_method, { customer: customer.id });
      } catch (_) {
        /* si déjà attaché, on ignore */
      }
      await stripe.customers.update(customer.id, {
        invoice_settings: { default_payment_method: pi.payment_method }
      });
    }

    // Crée l’abonnement mensuel avec trial jusqu’au lendemain
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: subscriptionMonthlyPriceId, quantity: 1 }],
      trial_period_days: Math.max(0, trialDays),
      payment_behavior: 'default_incomplete',
      metadata: {
        purpose: 'subscription_monthly_credits',
        userId: String(userId),
        creditsPerCycle: String(creditsPerCycle)
      },
    });

    // Reset crédits = 7 au moment de l’essai (et on journalise)
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: { credits: true }
        });
        if (!current) return;

        // Double-check idempotence au cas où le webhook rejoue pendant la création abonnement
        const dup2 = await tx.creditTransaction.findUnique({
          where: { stripePaymentIntentId: pi.id }
        });
        if (dup2) return;

        const delta = creditsPerCycle - (current.credits || 0);

        await tx.user.update({
          where: { id: userId },
          data: { credits: creditsPerCycle }
        });

        await tx.creditTransaction.create({
          data: {
            userId,
            delta,
            reason: 'subscription_initial_grant',
            stripePaymentIntentId: pi.id,
            meta: JSON.stringify({
              subscriptionId: subscription.id
            })
          }
        });
      });
    } catch (e) {
      console.error('subscription_initial_grant:', e);
    }

    return true;
  }

  // 3) Ancien flux : certains Payment Links créditent un compte existant (sans rapport VIN invité).
  // Ne pas utiliser pi.amount seul : sinon tout paiement (Embedded Checkout inclus) passait ici.
  const vinForBlock = normalizeVinMeta(m.vin || '');
  const hasGuestVinReport = vinForBlock.length === 17;
  const isGuestVinProductLink =
    m.purpose === 'vin_report_guest' || m.purpose === 'vin_report';

  if (
    !hasGuestVinReport &&
    !isGuestVinProductLink &&
    m &&
    (m.carvinguard_plan || m.app === 'carvinguard')
  ) {
    if (stripe) {
      try {
        const sessions = await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 });
        if (sessions.data.length > 0) {
          return false;
        }
      } catch (e) {
        console.warn('checkout.sessions.list (credit guard):', e.message);
      }
    }
    if (!prisma) {
      return false;
    }
    try {
      const emailFromReceipt = (pi.receipt_email || '').trim().toLowerCase();
      let email = emailFromReceipt;

      // Si receipt_email est absent, on tente via customer.
      if (!email && pi.customer) {
        try {
          const customer = await stripe.customers.retrieve(pi.customer);
          email = (customer && customer.email ? String(customer.email) : '').trim().toLowerCase();
        } catch (_) {
          // ignore
        }
      }

      // On ne peut pas créditer sans email (association au compte utilisateur).
      if (!email) return false;

      let creditsToAdd = null;
      const plan = m.carvinguard_plan;
      if (plan === 'essentiel') creditsToAdd = 1;
      if (plan === 'confort') creditsToAdd = 3;
      if (plan === 'premium') creditsToAdd = 10;

      // Fallback robuste : déduire des montants (en centimes).
      if (!creditsToAdd) {
        if (pi.amount === 1499) creditsToAdd = 1;
        else if (pi.amount === 2999) creditsToAdd = 3;
        else if (pi.amount === 6999) creditsToAdd = 10;
      }

      if (!creditsToAdd) return false;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return false;

      // Idempotence par payment_intent
      const dup = await prisma.creditTransaction.findUnique({
        where: { stripePaymentIntentId: pi.id }
      });
      if (dup) return false;

      await prisma.$transaction(async (tx) => {
        const dup2 = await tx.creditTransaction.findUnique({
          where: { stripePaymentIntentId: pi.id }
        });
        if (dup2) return;

        await tx.user.update({
          where: { id: user.id },
          data: { credits: { increment: creditsToAdd } }
        });

        await tx.creditTransaction.create({
          data: {
            userId: user.id,
            delta: creditsToAdd,
            reason: 'payment_one_shot',
            stripePaymentIntentId: pi.id,
            meta: JSON.stringify({
              carvinguard_plan: plan || '',
              eur: (pi.amount / 100).toFixed(2)
            })
          }
        });
      });
    } catch (e) {
      console.error('handleStripeCreditPurchase one-shot:', e);
    }
    // On renvoie false pour continuer le flux "commande + email"
    return false;
  }

  return false;
}

async function handleSubscriptionInvoicePayment(invoice) {
  const prisma = getPrisma();
  if (!prisma) return true;
  if (!stripe) return true;

  if (!invoice) return true;
  const paymentIntentId = invoice.payment_intent && invoice.payment_intent.id ? invoice.payment_intent.id : invoice.payment_intent;
  if (!paymentIntentId) return true;

  const dup = await prisma.creditTransaction.findUnique({
    where: { stripePaymentIntentId: paymentIntentId }
  });
  if (dup) return true;

  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return true;

  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const md = sub.metadata || {};
  if (md.purpose !== 'subscription_monthly_credits') return true;

  const userId = md.userId;
  const creditsPerCycle = parseInt(String(md.creditsPerCycle || '7'), 10);
  if (!userId || creditsPerCycle < 1) return true;

  try {
    await prisma.$transaction(async (tx) => {
      // Double-check idempotence pendant les rejouements webhook
      const dup2 = await tx.creditTransaction.findUnique({
        where: { stripePaymentIntentId: paymentIntentId }
      });
      if (dup2) return;

      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { credits: true }
      });
      if (!current) return;

      const delta = creditsPerCycle - (current.credits || 0);

      await tx.user.update({
        where: { id: userId },
        data: { credits: creditsPerCycle }
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          delta,
          reason: 'subscription_cycle_reset',
          stripePaymentIntentId: paymentIntentId,
          meta: JSON.stringify({
            subscriptionId: sub.id,
            invoiceId: invoice.id
          })
        }
      });
    });
  } catch (e) {
    console.error('subscription_cycle_reset:', e);
  }

  return true;
}

async function refundVinDecodeCredit(userId, vinMasked) {
  const prisma = getPrisma();
  if (!prisma || !userId) return;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { credits: { increment: 1 } }
      });
      await tx.creditTransaction.create({
        data: {
          userId,
          delta: 1,
          reason: 'vin_decode_refund',
          meta: JSON.stringify({ vin: vinMasked })
        }
      });
    });
  } catch (e) {
    console.error('Remboursement crédit VIN:', e);
  }
}

async function debitOneCredit(userId, reason, metaObj) {
  const prisma = getPrisma();
  if (!prisma || !userId) return { ok: false, credits: 0 };
  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId, credits: { gte: 1 } },
        data: { credits: { decrement: 1 } }
      });
      if (updated.count === 0) {
        const u = await tx.user.findUnique({
          where: { id: userId },
          select: { credits: true }
        });
        return { ok: false, credits: u != null ? u.credits : 0 };
      }
      await tx.creditTransaction.create({
        data: {
          userId,
          delta: -1,
          reason,
          meta: JSON.stringify(metaObj || {})
        }
      });
      return { ok: true };
    });
  } catch (e) {
    console.error('Débit crédit:', e);
    return { ok: false, credits: 0 };
  }
}

async function refundOneCredit(userId, reason, metaObj) {
  const prisma = getPrisma();
  if (!prisma || !userId) return;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { credits: { increment: 1 } }
      });
      await tx.creditTransaction.create({
        data: {
          userId,
          delta: 1,
          reason,
          meta: JSON.stringify(metaObj || {})
        }
      });
    });
  } catch (e) {
    console.error('Remboursement crédit:', e);
  }
}

/** CarAPI.dev (prioritaire) ou Vehicle Databases — voir .env.example */
function getVinDecodeProvider() {
  const carapi = String(process.env.CARAPI_TOKEN || process.env.CARAPI_API_KEY || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (carapi) return { id: 'carapi', apiKey: carapi };
  const vd = String(process.env.VEHICLEDATABASES_API_KEY || '').trim();
  if (vd) return { id: 'vehicledatabases', apiKey: vd };
  return null;
}

const MAX_VIN_FULL_REPORT_SNAPSHOT = 150000;
/**
 * Stocke une copie du bundle CarAPI dans credit_transactions.meta (lecture « Mes rapports »).
 */
function slimCarApiBundleForMetaSnapshot(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    return null;
  }
  try {
    const b = JSON.parse(JSON.stringify(bundle));
    if (b.listings && b.listings.data) {
      const arr = b.listings.data;
      if (Array.isArray(arr) && arr.length > 4) b.listings.data = arr.slice(0, 4);
    }
    if (b.mileageHistory && b.mileageHistory.data && b.mileageHistory.data.mileageHistory) {
      const m = b.mileageHistory.data.mileageHistory;
      if (Array.isArray(m) && m.length > 6) b.mileageHistory.data = Object.assign({}, b.mileageHistory.data, { mileageHistory: m.slice(0, 6) });
    }
    if (b.photos && b.photos.data && b.photos.data.media && Array.isArray(b.photos.data.media) && b.photos.data.media.length > 5) {
      b.photos.data = Object.assign({}, b.photos.data, { media: b.photos.data.media.slice(0, 5) });
    }
    let s = JSON.stringify(b);
    if (s.length > MAX_VIN_FULL_REPORT_SNAPSHOT) {
      b.listings = b.listings && b.listings.data ? { ok: b.listings.ok, data: { _truncated: true } } : b.listings;
      s = JSON.stringify(b);
    }
    if (s.length > MAX_VIN_FULL_REPORT_SNAPSHOT) {
      return null;
    }
    return s;
  } catch (e) {
    return null;
  }
}

/**
 * Normalise la réponse CarAPI (ancien { success, data } ou actuel { vin, specifications } — OpenAPI).
 * @see https://api.carapi.dev/openapi.json
 */
function normalizeCarApiVinResponse(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, httpStatus: 502, message: 'Réponse VIN invalide' };
  }
  const id = carapiClient.extractVinDecodeIdentity(body);
  if (
    id &&
    (String(id.make || '').trim() ||
      String(id.model || '').trim() ||
      id.year ||
      id.fromVinPathOnly)
  ) {
    const year = id.year != null ? String(id.year) : '';
    const detailParts = [id.engine, id.transmission, id.fuel_type, id.drivetrain].filter(
      (x) => x != null && String(x).trim() !== ''
    );
    const summary = detailParts.length > 0 ? detailParts.join(' · ') : String(id.make || id.model || '').trim();
    return {
      ok: true,
      json: {
        status: 'success',
        data: {
          make: String(id.make || '').trim(),
          model: String(id.model || '').trim(),
          year,
          trim: String(id.trim || '').trim(),
          summary,
          engine: id.engine != null ? String(id.engine).trim() : '',
          transmission: id.transmission != null ? String(id.transmission).trim() : '',
          fuel_type: id.fuel_type != null ? String(id.fuel_type).trim() : '',
          drivetrain: id.drivetrain != null ? String(id.drivetrain).trim() : ''
        }
      }
    };
  }
  const msg = String(
    body.message || (typeof body.error === 'string' ? body.error : body.error?.message) || ''
  ).trim();
  const quota =
    /quota|limit|429/i.test(msg) ||
    /quota|limit/i.test(String(body.error || ''));
  return {
    ok: false,
    httpStatus: quota ? 429 : 400,
    message: msg || 'VIN introuvable ou invalide'
  };
}

/**
 * Repli gratuit : API publique NHTSA VPIC (sans clé). Couvre beaucoup de VIN (dont US / exemples doc).
 * @see https://vpic.nhtsa.dot.gov/api/
 */
function normalizeNhtsaVinResponse(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.Results) || !body.Results[0]) {
    return { ok: false };
  }
  const r = body.Results[0];
  const make = String(r.Make || '').trim();
  const model = String(r.Model || '').trim();
  const year = r.ModelYear != null ? String(r.ModelYear).trim() : '';
  // VPIC renvoie souvent ErrorCode ≠ 0 (clé de contrôle, données partielles) tout en remplissant Make / Model / Year
  const hasIdentity = (make && !/^not applicable$/i.test(make)) || (model && !/^not applicable$/i.test(model)) || year;
  if (!hasIdentity) {
    const errText = String(r.ErrorText || '').trim();
    return {
      ok: false,
      message: errText ? errText.split(';')[0].trim() : 'VIN introuvable ou invalide'
    };
  }
  if (/^invalid/i.test(make) || /^invalid/i.test(model)) {
    return { ok: false };
  }
  const detailParts = [r.VehicleType, r.BodyClass].filter(
    (x) => x != null && String(x).trim() !== '' && String(x).trim() !== 'Not Applicable'
  );
  const summary =
    detailParts.length > 0 ? detailParts.join(' · ') : String(r.PlantCountry || '').trim();
  const engParts = [r.DisplacementL, r.EngineCylinders, r.EngineModel]
    .filter((x) => x != null && String(x).trim() !== '');
  const engine = engParts.length ? engParts.map((x) => String(x).trim()).join(' ') : '';
  const transmission = r.TransmissionStyle != null ? String(r.TransmissionStyle).trim() : '';
  const fuelType = r.FuelTypePrimary != null ? String(r.FuelTypePrimary).trim() : '';
  const driveType = r.DriveType != null ? String(r.DriveType).trim() : '';
  return {
    ok: true,
    json: {
      status: 'success',
      data: {
        make,
        model,
        year,
        trim: String(r.Trim || '').trim(),
        summary,
        engine,
        transmission,
        fuel_type: fuelType,
        drivetrain: driveType
      },
      source: 'nhtsa'
    }
  };
}

/** Timeout fetch (Node 18+ / Vercel) — évite « Recherche… » infinie si API bloque */
function fetchTimeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

/**
 * Dernier recours page d'accueil (?preview=1) : VIN au format ISO valide mais APIs indispo ou VIN EU peu couvert.
 */
function previewPartialVinJson() {
  return {
    status: 'success',
    data: {
      make: '',
      model: '',
      year: '',
      trim: '',
      summary:
        'VIN enregistré. Les informations détaillées (marque, modèle, millésime) seront complétées dans votre rapport après commande.'
    },
    access: 'preview',
    partialDecode: true
  };
}

async function decodeVinViaNhtsa(vin) {
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Carvinguard/1.0' },
      signal: fetchTimeoutSignal(10000)
    });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('json')) {
      return null;
    }
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) {
      return null;
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch (_) {
      return null;
    }
    const norm = normalizeNhtsaVinResponse(body);
    if (!norm.ok) return null;
    return norm.json;
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('NHTSA VIN decode:', e.message);
    }
    return null;
  }
}

/**
 * GET — diagnostic uniquement (navigateur, monitoring). Stripe envoie uniquement des POST signés.
 * Évite le message brut « Cannot GET » et rappelle la règle anti-307 (voir DEPLOI-CARVINGUARD.md).
 */
app.get('/api/stripe-webhook', (req, res) => {
  res.status(200).json({
    ok: true,
    message:
      'Endpoint webhook Stripe : les notifications arrivent en POST avec signature. Ouvrir cette URL en GET ne déclenche pas un paiement.',
    stripeDoc: 'https://stripe.com/docs/webhooks',
    siStripeAffiche307:
      'Utilise l’URL finale sans redirection (souvent https://www.carvinguard.fr/api/stripe-webhook), pas un domaine qui renvoie en 301/307 vers un autre.'
  });
});

/** GET diagnostic — même message que /api/stripe-webhook (alias chemin). */
app.get('/api/webhook', (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'Alias /api/webhook — préférez /api/stripe-webhook dans Stripe. POST signé identique.',
    canonical: '/api/stripe-webhook'
  });
});

/** Idempotence : checkout 100 % promo sans PaymentIntent (total 0). */
function syntheticIdForFreeCheckoutSession(sessionId) {
  return 'zfree_' + crypto.createHash('sha256').update(String(sessionId)).digest('hex');
}

/**
 * Avec 100 % de réduction, amount_total vaut 0 mais amount_subtotal reflète le forfait (ex. 1499).
 */
function inferCarvinguardPackFromAmountCents(cents) {
  const a = Number(cents);
  if (!Number.isFinite(a) || a < 1) {
    return null;
  }
  if (a === 1499) {
    return { credits: 1, packId: 'tier_essentiel', plan: 'essentiel' };
  }
  if (a === 2999) {
    return { credits: 3, packId: 'tier_confort', plan: 'confort' };
  }
  if (a === 6999) {
    return { credits: 10, packId: 'tier_premium', plan: 'premium' };
  }
  const e = parseInt(process.env.TIER_ESSENTIEL_CENTS || '1499', 10) || 1499;
  const c = parseInt(process.env.TIER_CONFORT_CENTS || '2999', 10) || 2999;
  const p = parseInt(process.env.TIER_PREMIUM_CENTS || '6999', 10) || 6999;
  if (a === e) {
    return { credits: 1, packId: 'tier_essentiel', plan: 'essentiel' };
  }
  if (a === c) {
    return { credits: 3, packId: 'tier_confort', plan: 'confort' };
  }
  if (a === p) {
    return { credits: 10, packId: 'tier_premium', plan: 'premium' };
  }
  return null;
}

/**
 * Crédite une fois le pack (meta session) quand le montant payé est 0 € (code promo) — pas de pi_ côté Stripe.
 */
async function deliverCarvinguardPackCreditsOnce(prisma, { userId, credits, packId, plan, sessionId, metaExtra }) {
  const sid = syntheticIdForFreeCheckoutSession(sessionId);
  const existing = await prisma.creditTransaction.findUnique({ where: { stripePaymentIntentId: sid } });
  if (existing) {
    return { already: true };
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { credits: { increment: credits } }
    });
    await tx.creditTransaction.create({
      data: {
        userId,
        delta: credits,
        reason: 'purchase',
        stripePaymentIntentId: sid,
        meta: JSON.stringify(
          Object.assign(
            { plan, packId, zeroAmount: true, checkoutSessionId: sessionId },
            metaExtra || {}
          )
        )
      }
    });
  });
  return { already: false };
}

/**
 * Guest / pas de PaymentIntent : total 0 €, métadonnées pack Carvinguard (prix entièrement couvert par promo).
 */
async function handleZeroAmountCarvinguardCreditSession(session) {
  const prisma = getPrisma();
  if (!prisma) return { handled: false };
  const sm = session.metadata || {};
  if (String(sm.app || '') !== 'carvinguard' && !sm.carvinguard_plan) {
    return { handled: false };
  }
  if (String(sm.purpose || '') === 'subscription_initial') {
    return { handled: false };
  }
  const at = session.amount_total;
  if (at != null && at !== 0) {
    return { handled: false };
  }
  const ps = session.payment_status;
  if (ps !== 'paid' && ps !== 'no_payment_required') {
    return { handled: false };
  }
  if (session.mode !== 'payment') {
    return { handled: false };
  }

  const refRaw = String(session.client_reference_id || '');
  if (refRaw.startsWith('cguser:')) {
    return { handled: false };
  }
  if (normalizeVinMeta(refRaw).length === 17) {
    return { handled: false };
  }

  let plan = String(sm.carvinguard_plan || '')
    .toLowerCase()
    .trim();
  let credits = 0;
  let packId = '';
  if (plan === 'essentiel') {
    credits = 1;
    packId = 'tier_essentiel';
  } else if (plan === 'confort') {
    credits = 3;
    packId = 'tier_confort';
  } else if (plan === 'premium') {
    credits = 10;
    packId = 'tier_premium';
  }
  if (credits < 1) {
    const t0 = inferCarvinguardPackFromAmountCents(session.amount_subtotal);
    if (t0) {
      credits = t0.credits;
      packId = t0.packId;
      plan = t0.plan;
    }
  }
  if (credits < 1) {
    return { handled: false };
  }

  const emailRaw =
    (session.customer_details && session.customer_details.email) || session.customer_email || '';
  const email = authLib.normalizeEmail(emailRaw);
  if (!email || email.indexOf('@') === -1) {
    return { handled: false };
  }

  let user = await prisma.user.findUnique({ where: { email } });
  const created = !user;
  if (!user) {
    const provisional = crypto.randomBytes(32).toString('hex');
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: await authLib.hashPassword(provisional)
      }
    });
  }

  const d = await deliverCarvinguardPackCreditsOnce(prisma, {
    userId: user.id,
    credits,
    packId,
    plan,
    sessionId: session.id
  });
  if (d && d.already) {
    return { handled: true };
  }

  const base = appBaseUrl();
  void (async () => {
    try {
      if (created) {
        const inviteTok = authLib.signAccountInviteToken(user.id);
        await sendAccountInviteEmail({
          to: email,
          inviteToken: inviteTok,
          baseUrl: base,
          credits
        });
      } else {
        await sendWalletCreditsEmail({ to: email, baseUrl: base, credits });
      }
    } catch (e) {
      console.error('Email zero-amount pack:', e.message);
    }
  })();

  console.log('Pack crédit 0 € (promo) crédité', session.id, user.id, plan, credits);
  return { handled: true };
}

/**
 * Client connecté : session Checkout avec client_reference_id=cguser:<id> et/ou metadata.user_id (même logique que MyFidpass / Fidelity).
 */
async function handleCheckoutSessionAccountCredit(session) {
  if (!stripe || !session || session.mode !== 'payment') return false;
  const raw = String(session.client_reference_id || '');
  const sm0 = session.metadata || {};
  let userId = '';
  if (raw.startsWith('cguser:')) {
    userId = raw.slice(7).trim();
  } else if (sm0.user_id) {
    userId = String(sm0.user_id).trim();
  }
  if (!userId) return false;

  const prisma = getPrisma();
  if (!prisma) {
    console.warn('checkout cguser: DATABASE_URL manquant');
    return true;
  }
  let user;
  try {
    user = await prisma.user.findUnique({ where: { id: userId } });
  } catch (e) {
    console.warn('checkout cguser:', e.message);
    return true;
  }
  if (!user) {
    console.warn('checkout cguser: utilisateur introuvable', userId);
    return true;
  }

  const sm = sm0;
  let plan = sm.carvinguard_plan || '';
  let credits = 0;
  let packId = '';
  if (plan === 'essentiel') {
    credits = 1;
    packId = 'tier_essentiel';
  } else if (plan === 'confort') {
    credits = 3;
    packId = 'tier_confort';
  } else if (plan === 'premium') {
    credits = 10;
    packId = 'tier_premium';
  }

  if (!credits) {
    const t1 = inferCarvinguardPackFromAmountCents(session.amount_total);
    if (t1) {
      credits = t1.credits;
      packId = t1.packId;
      if (!plan) plan = t1.plan;
    }
  }
  if (!credits) {
    const t2 = inferCarvinguardPackFromAmountCents(session.amount_subtotal);
    if (t2) {
      credits = t2.credits;
      packId = t2.packId;
      if (!plan) plan = t2.plan;
    }
  }

  if (!credits) {
    console.warn('checkout cguser: plan ou montant non reconnu', session.id, {
      amount_total: session.amount_total,
      amount_subtotal: session.amount_subtotal
    });
    return true;
  }

  const piRef = session.payment_intent;
  const piId = typeof piRef === 'string' ? piRef : piRef && piRef.id;
  if (!piId) {
    const at = session.amount_total;
    const ps = session.payment_status;
    if (
      (at === 0 || at == null) &&
      (ps === 'paid' || ps === 'no_payment_required') &&
      credits >= 1
    ) {
      const prisma0 = getPrisma();
      if (prisma0) {
        await deliverCarvinguardPackCreditsOnce(prisma0, {
          userId: user.id,
          credits,
          packId,
          plan,
          sessionId: session.id
        });
        const base = appBaseUrl();
        void (async () => {
          try {
            await sendWalletCreditsEmail({ to: user.email, baseUrl: base, credits });
          } catch (e) {
            console.error('Email cguser zero-amount:', e.message);
          }
        })();
        console.log('Compte connecté : pack 0 € (promo) crédité', session.id, user.id, credits);
      }
    } else {
      console.warn('checkout cguser: pas de payment_intent', session.id, { at, ps, credits });
    }
    return true;
  }

  let pi = await stripe.paymentIntents.retrieve(piId);
  const md = Object.assign({}, pi.metadata || {});
  md.purpose = 'credit_purchase';
  md.userId = user.id;
  md.credits = String(credits);
  md.packId = packId;
  if (plan) md.carvinguard_plan = plan;

  await stripe.paymentIntents.update(piId, {
    metadata: Object.fromEntries(
      Object.entries(md).map(([k, v]) => [
        k,
        String(v !== undefined && v !== null ? v : '').slice(0, 500)
      ])
    )
  });
  pi = await stripe.paymentIntents.retrieve(piId);
  await handleStripeCreditPurchase(pi);
  return true;
}

/**
 * Paiement sans compte ni VIN (ex. Payment Link tarifs) : crée ou retrouve l’utilisateur par e-mail Stripe et crédite le wallet.
 */
async function handleCheckoutAutoAccountCredit(session, pi, sm) {
  const prisma = getPrisma();
  if (!prisma || !stripe || session.mode !== 'payment') {
    return { handled: false };
  }

  const emailRaw =
    (session.customer_details && session.customer_details.email) ||
    session.customer_email ||
    '';
  const email = authLib.normalizeEmail(emailRaw);
  if (!email || email.indexOf('@') === -1) {
    return { handled: false };
  }

  const refRaw = String(session.client_reference_id || '');
  if (refRaw.startsWith('cguser:')) {
    return { handled: false };
  }

  const refVin = normalizeVinMeta(refRaw);
  const pm = pi.metadata || {};
  const piVin = normalizeVinMeta(pm.vin || '');
  if (refVin.length === 17 || piVin.length === 17) {
    return { handled: false };
  }

  let plan = sm.carvinguard_plan || pm.carvinguard_plan || '';
  let credits = 0;
  let packId = '';

  /** Déjà posé sur le PI par /api/billing/credit-checkout — indispensable si promo / montant ≠ grilles fixes. */
  const metaCredits = parseInt(String(pm.credits || ''), 10);
  if (!Number.isNaN(metaCredits) && metaCredits >= 1) {
    credits = metaCredits;
    packId = String(pm.packId || '').trim();
  }

  if (credits < 1 && plan === 'essentiel') {
    credits = 1;
    packId = 'tier_essentiel';
  } else if (credits < 1 && plan === 'confort') {
    credits = 3;
    packId = 'tier_confort';
  } else if (credits < 1 && plan === 'premium') {
    credits = 10;
    packId = 'tier_premium';
  }

  const piAmount = typeof pi.amount === 'number' && !Number.isNaN(pi.amount) ? pi.amount : null;
  const sessionTotal =
    typeof session.amount_total === 'number' && !Number.isNaN(session.amount_total)
      ? session.amount_total
      : null;
  const amountForTierGuess = piAmount != null ? piAmount : sessionTotal;
  if (credits < 1 && typeof amountForTierGuess === 'number') {
    if (amountForTierGuess === 1499) {
      credits = 1;
      packId = 'tier_essentiel';
    } else if (amountForTierGuess === 2999) {
      credits = 3;
      packId = 'tier_confort';
    } else if (amountForTierGuess === 6999) {
      credits = 10;
      packId = 'tier_premium';
    }
  }

  if (credits >= 1 && !packId) {
    if (credits === 1) packId = 'tier_essentiel';
    else if (credits === 3) packId = 'tier_confort';
    else if (credits === 10) packId = 'tier_premium';
    else packId = 'tier_credit_pack';
  }

  if (credits < 1) {
    console.warn(
      'handleCheckoutAutoAccountCredit: crédits introuvables (metadata/session)',
      session.id,
      { plan, pmCredits: pm.credits, amount_pi: piAmount, amount_session: sessionTotal }
    );
    return { handled: false };
  }

  let user = await prisma.user.findUnique({ where: { email } });
  let created = false;
  if (!user) {
    const provisional = crypto.randomBytes(32).toString('hex');
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: await authLib.hashPassword(provisional)
      }
    });
    created = true;
  }

  const piId = pi.id;
  const md = Object.assign({}, pm, {
    purpose: 'credit_purchase',
    userId: user.id,
    credits: String(credits),
    packId,
    email
  });
  if (plan) md.carvinguard_plan = plan;

  await stripe.paymentIntents.update(piId, {
    metadata: Object.fromEntries(
      Object.entries(md).map(([k, v]) => [
        k,
        String(v !== undefined && v !== null ? v : '').slice(0, 500)
      ])
    )
  });
  const piFresh = await stripe.paymentIntents.retrieve(piId);
  await handleStripeCreditPurchase(piFresh);

  /* Ne pas bloquer la réponse HTTP / la réconciliation get-invite : Resend peut prendre plusieurs secondes. */
  void (async () => {
    const base = appBaseUrl();
    try {
      if (created) {
        const inviteTok = authLib.signAccountInviteToken(user.id);
        await sendAccountInviteEmail({
          to: email,
          inviteToken: inviteTok,
          baseUrl: base,
          credits
        });
      } else {
        await sendWalletCreditsEmail({ to: email, baseUrl: base, credits });
      }
    } catch (e) {
      console.error('Emails wallet auto-compte:', e.message);
    }
  })();

  return { handled: true };
}

/**
 * Abonnement (1 € + mensuel) sans compte au moment du Checkout : après paiement, création du compte puis finalisation (subscription_initial).
 * Même principe que handleCheckoutAutoAccountCredit pour les packs crédits invités.
 */
async function handleCheckoutAutoSubscriptionInitial(session, pi, sm) {
  const prisma = getPrisma();
  if (!prisma || !stripe || session.mode !== 'payment') {
    return { handled: false };
  }

  const pm = pi.metadata || {};
  if (pm.purpose !== 'subscription_initial' || pm.userId) {
    return { handled: false };
  }

  const emailRaw =
    (session.customer_details && session.customer_details.email) ||
    session.customer_email ||
    '';
  const email = authLib.normalizeEmail(emailRaw);
  if (!email || email.indexOf('@') === -1) {
    return { handled: false };
  }

  const refRaw = String(session.client_reference_id || '');
  if (refRaw.startsWith('cguser:')) {
    return { handled: false };
  }

  const refVin = normalizeVinMeta(refRaw);
  const piVin = normalizeVinMeta(pm.vin || '');
  if (refVin.length === 17 || piVin.length === 17) {
    return { handled: false };
  }

  const creditsPerCycle = parseInt(String(pm.creditsPerCycle || '7'), 10);
  const subscriptionMonthlyPriceId = String(pm.subscriptionMonthlyPriceId || '');
  const trialDays = parseInt(String(pm.trialDays || '1'), 10);

  if (creditsPerCycle < 1 || !subscriptionMonthlyPriceId || trialDays < 0) {
    return { handled: false };
  }

  let user = await prisma.user.findUnique({ where: { email } });
  let created = false;
  if (!user) {
    const provisional = crypto.randomBytes(32).toString('hex');
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: await authLib.hashPassword(provisional)
      }
    });
    created = true;
  }

  const piId = pi.id;
  const md = Object.assign({}, pm, {
    purpose: 'subscription_initial',
    userId: String(user.id),
    creditsPerCycle: String(creditsPerCycle),
    subscriptionMonthlyPriceId,
    trialDays: String(trialDays),
    email
  });

  await stripe.paymentIntents.update(piId, {
    metadata: Object.fromEntries(
      Object.entries(md).map(([k, v]) => [
        k,
        String(v !== undefined && v !== null ? v : '').slice(0, 500)
      ])
    )
  });
  const piFresh = await stripe.paymentIntents.retrieve(piId);
  await handleStripeCreditPurchase(piFresh);

  void (async () => {
    const base = appBaseUrl();
    try {
      if (created) {
        const inviteTok = authLib.signAccountInviteToken(user.id);
        await sendAccountInviteEmail({
          to: email,
          inviteToken: inviteTok,
          baseUrl: base,
          credits: creditsPerCycle
        });
      } else {
        await sendWalletCreditsEmail({ to: email, baseUrl: base, credits: creditsPerCycle });
      }
    } catch (e) {
      console.error('Emails abonnement auto-compte:', e.message);
    }
  })();

  return { handled: true };
}

/**
 * Stripe Payment Links : le VIN est dans client_reference_id (session), pas toujours sur le PaymentIntent.
 * On fusionne email + VIN + métadonnées du lien puis on exécute la même finalisation que l’Embedded Checkout.
 */
async function handleCheckoutSessionCompleted(session) {
  if (!stripe || !session) return;
  const accountDone = await handleCheckoutSessionAccountCredit(session);
  if (accountDone) return;
  if (session.mode !== 'payment') return;
  const piRef = session.payment_intent;
  const piId = typeof piRef === 'string' ? piRef : piRef && piRef.id;
  if (!piId) {
    const z = await handleZeroAmountCarvinguardCreditSession(session);
    if (z.handled) return;
    return;
  }

  let pi =
    typeof piRef === 'object' && piRef && piRef.id
      ? piRef
      : await stripe.paymentIntents.retrieve(piId);
  const sm = session.metadata || {};
  const pm = pi.metadata || {};

  // Invité : le PI est déjà typé (crédits / abo) mais sans userId — créer le compte puis enchaîner (ne pas court-circuiter avant).
  if (pm.purpose === 'credit_purchase' && !pm.userId) {
    const autoWallet = await handleCheckoutAutoAccountCredit(session, pi, sm);
    if (autoWallet.handled) return;
  }
  if (pm.purpose === 'subscription_initial' && !pm.userId) {
    const autoSub = await handleCheckoutAutoSubscriptionInitial(session, pi, sm);
    if (autoSub.handled) return;
  }

  if (pm.purpose === 'credit_purchase' || pm.purpose === 'subscription_initial') {
    try {
      await handleStripeCreditPurchase(pi);
    } catch (e) {
      console.error('handleCheckoutSessionCompleted (credit/sub):', e);
    }
    return;
  }

  const autoWallet = await handleCheckoutAutoAccountCredit(session, pi, sm);
  if (autoWallet.handled) {
    return;
  }

  const refVin = normalizeVinMeta(session.client_reference_id || '');
  const emailFromSession =
    (session.customer_details && session.customer_details.email) ||
    session.customer_email ||
    '';
  const mergedEmail = ((pm.email || '').trim() || String(emailFromSession || '').trim()).slice(0, 500);

  const vinFinal = refVin.length === 17 ? refVin : normalizeVinMeta(pm.vin || '');

  const nextMeta = Object.assign({}, pm, {
    email: mergedEmail,
    vin: vinFinal
  });

  if (sm.carvinguard_plan && !pm.planId) {
    nextMeta.planId = sm.carvinguard_plan;
    nextMeta.planLabel = pm.planLabel || sm.carvinguard_plan;
  }
  if (sm.carvinguard_plan && !pm.carvinguard_plan) {
    nextMeta.carvinguard_plan = sm.carvinguard_plan;
  }
  if (!nextMeta.purpose && (sm.carvinguard_plan || sm.app === 'carvinguard')) {
    nextMeta.purpose = 'vin_report_guest';
  } else if (sm.purpose && !pm.purpose) {
    nextMeta.purpose = sm.purpose;
  }

  await stripe.paymentIntents.update(piId, {
    metadata: Object.fromEntries(
      Object.entries(nextMeta).map(([k, v]) => [
        k,
        String(v !== undefined && v !== null ? v : '').slice(0, 500)
      ])
    )
  });
  pi = await stripe.paymentIntents.retrieve(piId);

  const isCreditPurchase = await handleStripeCreditPurchase(pi);
  if (!isCreditPurchase) {
    const order = paymentIntentToOrder(pi);
    saveOrder(order);
    try {
      await fulfillGuestVinOrder(stripe, pi);
    } catch (e) {
      console.error('fulfillGuestVinOrder (checkout.session):', e);
    }
  }
}

async function handleStripeWebhookPost(req, res) {
  if (!stripe) {
    return res.status(500).send('Stripe non configuré');
  }
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!endpointSecret) {
    console.error(
      'STRIPE_WEBHOOK_SECRET manquant : les paiements ne peuvent pas être validés côté serveur. Ajoute whsec_… sur Vercel (Production).'
    );
    return res.status(503).send('webhook non configuré');
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (e) {
    console.error('Webhook signature invalide:', e.message);
    return res.status(400).send('Signature invalide');
  }
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    let skipGuestForAccountLink = false;
    let skipGuestPendingCheckoutSession = false;
    if (stripe && pi.id) {
      try {
        const sessions = await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 });
        const sess = sessions.data[0];
        if (sess && String(sess.client_reference_id || '').startsWith('cguser:')) {
          skipGuestForAccountLink = true;
        }
        /* Payment Link sans VIN : le crédit wallet / fusion VIN est fait dans checkout.session.completed */
        if (
          sess &&
          sess.mode === 'payment' &&
          !String(sess.client_reference_id || '').startsWith('cguser:') &&
          normalizeVinMeta(sess.client_reference_id || '').length !== 17
        ) {
          skipGuestPendingCheckoutSession = true;
        }
      } catch (e) {
        /* ignore */
      }
    }
    const isCreditPurchase = await handleStripeCreditPurchase(pi);
    if (!isCreditPurchase && !skipGuestForAccountLink && !skipGuestPendingCheckoutSession) {
      const order = paymentIntentToOrder(pi);
      saveOrder(order);
      try {
        await fulfillGuestVinOrder(stripe, pi);
      } catch (e) {
        console.error('fulfillGuestVinOrder:', e);
      }
    }
  } else if (event.type === 'checkout.session.completed') {
    try {
      await handleCheckoutSessionCompleted(event.data.object);
    } catch (e) {
      console.error('checkout.session.completed:', e);
    }
  } else if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid') {
    const invoice = event.data.object;
    await handleSubscriptionInvoicePayment(invoice);
  }
  res.status(200).send('ok');
}

const stripeWebhookRaw = express.raw({ type: 'application/json' });
app.post('/api/stripe-webhook', stripeWebhookRaw, handleStripeWebhookPost);
app.post('/api/webhook', stripeWebhookRaw, handleStripeWebhookPost);

app.use(cookieParser());
app.use(express.json());

// Diagnostics de test : désactivés en prod (Vercel ou NODE_ENV)
const cgProdRuntime =
  process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
if (!cgProdRuntime) {
  app.get('/api/email-status', (req, res) => {
    res.json({
      resendConfigured: !!process.env.RESEND_API_KEY,
      mailTo: process.env.MAIL_TO || 'infos.carvinguard@gmail.com'
    });
  });

  app.post('/api/test-order-email', async (req, res) => {
    const fakeOrder = {
      id: 'pi_test_' + Date.now(),
      montant: '19,90 €',
      nom: (req.body && req.body.nom) || 'Dupont',
      prenom: (req.body && req.body.prenom) || 'Jean',
      email: (req.body && req.body.email) || 'test@example.com',
      phone: (req.body && req.body.phone) || '06 12 34 56 78',
      vin: (req.body && req.body.vin) || 'WBADT43452G123456',
      titulaire: (req.body && req.body.titulaire) || 'DUPONT Jean',
      typePersonne: (req.body && req.body.typePersonne) || 'particulier',
      miseCirculation: (req.body && req.body.miseCirculation) || '01/01/2020',
      dateCertificat: (req.body && req.body.dateCertificat) || new Date().toLocaleDateString('fr-FR'),
      cp: (req.body && req.body.cp) || '',
      ville: (req.body && req.body.ville) || ''
    };
    const result = await sendTeamOrderEmail(fakeOrder);
    res.json({
      ok: result.sent,
      emailSent: result.sent,
      error: result.error || null
    });
  });
}

// ——— Commandes rapport VIN (statut + consultation sécurisée) ———
app.get('/api/order-status', async (req, res) => {
  try {
    let piId = req.query.payment_intent;
    const sessionId = req.query.session_id;
    if (sessionId && typeof sessionId === 'string' && stripe) {
      try {
        const sess = await stripe.checkout.sessions.retrieve(sessionId);
        const ref = sess.payment_intent;
        piId = typeof ref === 'string' ? ref : ref && ref.id;
      } catch (e) {
        return res.status(400).json({ error: 'session_id invalide' });
      }
    }
    if (!piId || typeof piId !== 'string') {
      return res.status(400).json({ error: 'payment_intent ou session_id requis' });
    }
    const prisma = getPrisma();
    if (!prisma) {
      return res.json({
        status: 'pending',
        message: 'Finalisation en cours — vous recevrez un email avec le PDF.'
      });
    }
    const row = await prisma.vinOrder.findUnique({
      where: { stripePaymentIntentId: piId }
    });
    if (!row) {
      return res.json({ status: 'pending' });
    }
    const base = appBaseUrl();
    const ready = !!(row.pdfGeneratedAt && row.accessToken);
    return res.json({
      status: ready ? 'ready' : 'pending',
      token: row.accessToken,
      reportUrl: row.accessToken
        ? `${base}/mon-rapport.html?token=${encodeURIComponent(row.accessToken)}`
        : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Erreur' });
  }
});

/** Après un Payment Link : distinguer achat de crédits compte (cguser:) du rapport invité. */
app.get('/api/checkout-session-kind', async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId || typeof sessionId !== 'string' || !stripe) {
      return res.json({ kind: 'unknown' });
    }
    const sess = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent']
    });
    const piObj = sess.payment_intent;
    const pm =
      typeof piObj === 'object' && piObj && piObj.metadata
        ? piObj.metadata
        : {};
    if (pm.purpose === 'subscription_initial') {
      return res.json({ kind: 'subscription_initial' });
    }
    const ref = String(sess.client_reference_id || '');
    if (ref.startsWith('cguser:')) {
      return res.json({ kind: 'account_credit' });
    }
    if (normalizeVinMeta(ref).length === 17) {
      return res.json({ kind: 'guest_vin' });
    }
    return res.json({ kind: 'guest_checkout' });
  } catch (e) {
    return res.json({ kind: 'unknown' });
  }
});

/**
 * Montant réel Stripe + type d’achat (pour la page confirmation — évite 19,90 € fantôme du sessionStorage).
 */
app.get('/api/checkout-session-summary', async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId || typeof sessionId !== 'string' || !stripe) {
      return res.status(400).json({ error: 'session_id requis' });
    }
    const sess = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent']
    });
    const cents = sess.amount_total;
    const eurNum = typeof cents === 'number' ? cents / 100 : 0;
    const amountLabel =
      typeof cents === 'number' ? eurNum.toFixed(2).replace('.', ',') + ' €' : '—';
    const piObj = sess.payment_intent;
    const pm =
      typeof piObj === 'object' && piObj && piObj.metadata ? piObj.metadata : {};
    if (pm.purpose === 'subscription_initial') {
      return res.json({
        amountTotalCents: cents,
        amountLabel,
        currency: sess.currency || 'eur',
        purchaseType: 'subscription_initial',
        customerEmail:
          (sess.customer_details && sess.customer_details.email) ||
          sess.customer_email ||
          ''
      });
    }
    const ref = String(sess.client_reference_id || '');
    const refVin = normalizeVinMeta(ref);
    let purchaseType = 'wallet_credits';
    if (ref.startsWith('cguser:')) {
      purchaseType = 'account_topup';
    } else if (refVin.length === 17) {
      purchaseType = 'vin_report';
    }
    return res.json({
      amountTotalCents: cents,
      amountLabel,
      currency: sess.currency || 'eur',
      purchaseType,
      customerEmail:
        (sess.customer_details && sess.customer_details.email) ||
        sess.customer_email ||
      '',
      vinFromReference: refVin.length === 17 ? refVin : null
    });
  } catch (e) {
    return res.status(400).json({ error: 'Session invalide ou expirée' });
  }
});

/** Raccourci URL vers l’espace client (crédits VIN, paiements Stripe). */
app.get(['/espace-client', '/espace'], (req, res) => {
  res.redirect(302, '/compte.html');
});

app.get('/api/rapport/session/:token', async (req, res) => {
  try {
    const prisma = getPrisma();
    if (!prisma) {
      return res.status(503).json({ error: 'Service indisponible' });
    }
    const token = (req.params.token || '').trim();
    if (token.length < 16) {
      return res.status(400).json({ error: 'Jeton invalide' });
    }
    const row = await prisma.vinOrder.findUnique({ where: { accessToken: token } });
    if (!row) {
      return res.status(404).json({ error: 'Lien invalide ou expiré' });
    }
    let vehicleData = {};
    try {
      const parsed = JSON.parse(row.vehicleDataJson || '{}');
      vehicleData = parsed.vehicleData || {};
    } catch (_) {}
    const prix = row.amountCents / 100;
    const commande = {
      demarche: 'Rapport historique véhicule (VIN)',
      vin: row.vin,
      vehicleData,
      prix,
      reportUnlocked: true,
      accessToken: token,
      planId: row.planId,
      planLabel: row.planLabel,
      email: row.email,
      nom: row.nom,
      prenom: row.prenom
    };
    res.json({ ok: true, commande });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Erreur' });
  }
});

app.get('/api/rapport/session/:token/pdf', async (req, res) => {
  try {
    const prisma = getPrisma();
    if (!prisma) {
      return res.status(503).send('Service indisponible');
    }
    const token = (req.params.token || '').trim();
    const row = await prisma.vinOrder.findUnique({ where: { accessToken: token } });
    if (!row) {
      return res.status(404).send('Not found');
    }
    let vehicleData = {};
    let guestSnapshot = null;
    try {
      const parsed = JSON.parse(row.vehicleDataJson || '{}');
      vehicleData = parsed.vehicleData || {};
      if (parsed.vehicleData) {
        guestSnapshot = { vehicleData: parsed.vehicleData, decode: parsed.decode || null };
      }
    } catch (_) {}
    const montantEur = (row.amountCents / 100).toFixed(2).replace('.', ',') + ' €';
    const pdfBuffer = await generateReportPdfBuffer(vehicleData, row.vin, {
      prenom: row.prenom,
      nom: row.nom,
      email: row.email,
      planLabel: row.planLabel || row.planId,
      montantEur
    }, { guestSnapshot });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="rapport-vin-carvinguard.pdf"');
    res.send(pdfBuffer);
  } catch (e) {
    res.status(500).send('Erreur');
  }
});

// ---------- SaaS : comptes, crédits, achat Stripe ----------
function saaSAuthReady() {
  return !!(getPrisma() && process.env.JWT_SECRET);
}

app.get('/api/saas-config', async (req, res) => {
  const prisma = getPrisma();
  const vinApi = !!getVinDecodeProvider();
  /** Mêmes paliers que checkout.html / Payment Links (rapports VIN, pas anciens packs 5/20). */
  const creditsPacks = [
    {
      id: 'tier_essentiel',
      credits: 1,
      priceCents: parseInt(process.env.TIER_ESSENTIEL_CENTS || '1499', 10),
      label: 'Rapport VIN unique',
      sub: 'Un rapport complet pour un véhicule.',
      unit: '1 rapport',
      type: 'credit_purchase',
      popular: false
    },
    {
      id: 'tier_confort',
      credits: 3,
      priceCents: parseInt(process.env.TIER_CONFORT_CENTS || '2999', 10),
      label: 'Meilleur rapport qualité-prix',
      sub: 'Pour comparer plusieurs véhicules ou anticiper vos démarches.',
      unit: '3 rapports · 9,99 €/rapport',
      type: 'credit_purchase',
      popular: true
    },
    {
      id: 'tier_premium',
      credits: 10,
      priceCents: parseInt(process.env.TIER_PREMIUM_CENTS || '6999', 10),
      label: 'Pack Pro',
      sub: 'Pour professionnels et volumes réguliers.',
      unit: '10 rapports · 6,99 €/rapport',
      type: 'credit_purchase',
      popular: false
    }
  ];

  // Abonnement : prix détectés dans le catalogue Stripe si les variables ne sont pas posées.
  if (stripe) {
    try {
      const cat = await resolveCarvinguardStripeCatalog(stripe);
      const subIni = String(cat.subscription.initial || '').trim();
      const subMo = String(cat.subscription.monthly || '').trim();
      if (subIni.startsWith('price_') && subMo.startsWith('price_')) {
        const creditsPerCycle = parseInt(process.env.SUBSCRIPTION_CREDITS_PER_CYCLE || '7', 10);
        const trialDays = parseInt(process.env.SUBSCRIPTION_TRIAL_DAYS || '1', 10);
        const monthlyCentsForDisplay = parseInt(process.env.SUBSCRIPTION_MONTHLY_CENTS_FOR_DISPLAY || '4999', 10);
        const initialCentsForDisplay = parseInt(process.env.SUBSCRIPTION_INITIAL_CENTS_FOR_DISPLAY || '100', 10);

        creditsPacks.push({
          id: 'sub_monthly_7',
          type: 'subscription_initial',
          credits: creditsPerCycle,
          priceCents: initialCentsForDisplay,
          monthlyPriceCents: monthlyCentsForDisplay,
          label: 'Pack mensuel',
          sub: '7 rapports VIN par mois, renouvelés chaque cycle (1 recherche = 1 rapport).',
          displayPrice:
            '1 € puis ' + (monthlyCentsForDisplay / 100).toFixed(2).replace('.', ',') + ' €/mois',
          subscriptionMonthlyPriceId: subMo,
          trialDays,
          popular: false,
          subscription: true
        });
      }
    } catch (e) {
      console.warn('saas-config subscription detection:', e.message);
    }
  }

  const p = getVinDecodeProvider();
  res.json({
    vinRequiresAccount: false,
    authAvailable: saaSAuthReady(),
    registrationOpen: saaSAuthReady() && isOpenRegistrationAllowed(),
    creditPacks: creditsPacks,
    /** true si CARAPI_TOKEN est posé : le dashboard peut lancer le rapport complet (tous les endpoints). */
    carApiEnabled: !!(p && p.id === 'carapi'),
    /** true si VEHICLEDATABASES_API_KEY est posé : le dashboard peut lancer le rapport complet VehicleDatabases. */
    vdEnabled: !!(p && p.id === 'vehicledatabases')
  });
});

app.post('/api/auth/register', async (req, res) => {
  if (!isOpenRegistrationAllowed()) {
    return res.status(403).json({
      error:
        'Création de compte réservée après un paiement Stripe. Choisissez un forfait sur la page Tarifs, puis définissez votre mot de passe via le lien reçu par email.'
    });
  }
  if (!saaSAuthReady()) {
    return res.status(503).json({ error: 'Inscription indisponible (configuration manquante).' });
  }
  const prisma = getPrisma();
  const email = authLib.normalizeEmail(req.body && req.body.email);
  const password = String((req.body && req.body.password) || '');

  if (!email || email.indexOf('@') === -1) {
    return res.status(400).json({ error: 'Adresse email invalide.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Mot de passe trop court (8 caractères minimum).' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse email.' });
    }
    const hash = await authLib.hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash: hash, credits: 0 }
    });
    const token = authLib.signAuthToken(user.id);
    authLib.setAuthCookie(res, token);
    return res.json({
      user: { id: user.id, email: user.email, credits: user.credits, createdAt: user.createdAt }
    });
  } catch (e) {
    console.error('register:', e);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!saaSAuthReady()) {
    return res.status(503).json({ error: 'Connexion indisponible.' });
  }
  const prisma = getPrisma();
  const email = authLib.normalizeEmail(req.body && req.body.email);
  const password = (req.body && req.body.password) || '';
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await authLib.verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    }
    const token = authLib.signAuthToken(user.id);
    authLib.setAuthCookie(res, token);
    return res.json({
      user: { id: user.id, email: user.email, credits: user.credits }
    });
  } catch (e) {
    console.error('login:', e);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/** Premier mot de passe après paiement sans compte (lien e-mail `?invite=`). */
app.post('/api/auth/accept-invite', async (req, res) => {
  if (!saaSAuthReady()) {
    return res.status(503).json({ error: 'Service indisponible.' });
  }
  const prisma = getPrisma();
  const token = (req.body && req.body.token) || '';
  const password = (req.body && req.body.password) || '';
  const userId = authLib.verifyAccountInviteToken(token);
  if (!userId || String(password).length < 8) {
    return res.status(400).json({
      error: 'Lien invalide ou expiré, ou mot de passe trop court (8 caractères minimum).'
    });
  }
  try {
    const hash = await authLib.hashPassword(password);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash }
    });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, credits: true }
    });
    if (!user) {
      return res.status(404).json({ error: 'Compte introuvable.' });
    }
    authLib.setAuthCookie(res, authLib.signAuthToken(user.id));
    return res.json({ ok: true, user });
  } catch (e) {
    console.error('accept-invite:', e);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  authLib.clearAuthCookie(res);
  res.json({ ok: true });
});

/** Modification du mot de passe (utilisateur connecté). */
app.post('/api/auth/change-password', async (req, res) => {
  if (!saaSAuthReady()) return res.status(503).json({ error: 'Service indisponible.' });
  const prisma = getPrisma();
  const userId = authLib.getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: 'Connexion requise.' });
  const currentPassword = String((req.body && req.body.currentPassword) || '');
  const newPassword = String((req.body && req.body.newPassword) || '');
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Nouveau mot de passe trop court (8 caractères minimum).' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ error: 'Session invalide.' });
    if (user.passwordHash && !(await authLib.verifyPassword(currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
    }
    const hash = await authLib.hashPassword(newPassword);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
    return res.json({ ok: true });
  } catch (e) {
    console.error('change-password:', e);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/** Historique des recherches VIN de l'utilisateur connecté. */
app.get('/api/vin/history', async (req, res) => {
  const prisma = getPrisma();
  const userId = authLib.getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: 'Connexion requise.' });
  if (!prisma) return res.status(503).json({ error: 'Base de données non disponible.' });
  const limit = Math.min(parseInt(String(req.query.limit || '100'), 10) || 100, 200);
  try {
    const transactions = await prisma.creditTransaction.findMany({
      where: { userId, reason: { in: ['vin_decode', 'vin_full_report'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, reason: true, meta: true, createdAt: true }
    });
    const history = transactions.map(function (t) {
      let meta = {};
      try { meta = JSON.parse(t.meta || '{}'); } catch (e) {}
      return {
        id: t.id,
        reportKind: t.reason === 'vin_full_report' ? 'full' : 'standard',
        vin: meta.vin || '—',
        make: meta.make || '',
        model: meta.model || '',
        year: meta.year || '',
        fuel_type: meta.fuel_type || '',
        engine: meta.engine || '',
        hasSnapshot: !!(t.reason === 'vin_full_report' && meta.fullReportJson && String(meta.fullReportJson).length > 2),
        createdAt: t.createdAt
      };
    });
    return res.json(history);
  } catch (e) {
    console.error('vin/history:', e);
    return res.status(500).json({ error: 'Erreur base de données.' });
  }
});

/**
 * Récupère l’instantané du rapport complet CarAPI (même contenu qu’au moment de l’analyse), sans crédit.
 */
app.get('/api/vin/report/:transactionId', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const prisma = getPrisma();
  const userId = authLib.getUserIdFromCookies(req);
  if (!userId) {
    return res.status(401).json({ status: 'error', message: 'Connexion requise.' });
  }
  if (!prisma) {
    return res.status(503).json({ status: 'error', message: 'Base de données requise.' });
  }
  const tid = String(req.params.transactionId || '').trim();
  if (!tid) {
    return res.status(400).json({ status: 'error', message: 'Identifiant invalide.' });
  }
  try {
    const t = await prisma.creditTransaction.findFirst({
      where: { id: tid, userId, reason: 'vin_full_report' }
    });
    if (!t) {
      return res.status(404).json({ status: 'error', message: 'Rapport introuvable.' });
    }
    let meta = {};
    try { meta = JSON.parse(t.meta || '{}'); } catch (e) {}
    if (!meta.fullReportJson) {
      return res.status(404).json({
        status: 'error',
        code: 'NO_SNAPSHOT',
        message:
          'Aucun détail enregistré pour cette entrée. Relancez une analyse depuis « Nouvelle recherche » (1 crédit) pour ce VIN — les analyses avant mise à jour n’incluaient pas l’enregistrement complet.'
      });
    }
    let bundle;
    try {
      bundle = JSON.parse(String(meta.fullReportJson));
    } catch (e) {
      return res.status(502).json({ status: 'error', message: 'Donnée rapport corrompue.' });
    }
    return res.json({ status: 'success', data: bundle });
  } catch (e) {
    console.error('vin/report:', e);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  }
});

/**
 * PDF synthèse rapport VIN (espace connecté) — même fidélité documentaire qu’en invité, données issues du relevé d’analyse.
 */
function vehicleDataForSaaSPdfFromTransactionMeta(meta) {
  const out = {
    make: meta.make != null ? String(meta.make) : '',
    model: meta.model != null ? String(meta.model) : '',
    year: meta.year != null ? String(meta.year) : '',
    trim: '',
    engine: meta.engine != null ? String(meta.engine) : '',
    transmission: '',
    fuel_type: meta.fuel_type != null ? String(meta.fuel_type) : '',
    drivetrain: '',
    summary: ''
  };
  if (meta.fullReportJson) {
    try {
      const bundle = JSON.parse(String(meta.fullReportJson));
      const id = bundle.decode && bundle.decode.identity;
      if (id && typeof id === 'object') {
        if (id.trim) out.trim = String(id.trim);
        if (id.transmission) out.transmission = String(id.transmission);
        if (id.drivetrain) out.drivetrain = String(id.drivetrain);
        if (!out.drivetrain && (id.drive_type || id.drivetrain)) {
          out.drivetrain = String(id.drive_type || id.drivetrain);
        }
      }
    } catch (_) {}
  }
  const sumParts = [out.engine, out.fuel_type].filter((x) => x && String(x).trim());
  out.summary = sumParts.length
    ? sumParts.join(' · ')
    : [out.make, out.model, out.year].filter((x) => x && String(x).trim()).join(' ').trim();
  return out;
}

app.get('/api/vin/report/:transactionId/pdf', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const prisma = getPrisma();
  const userId = authLib.getUserIdFromCookies(req);
  if (!userId) {
    return res.status(401).send('Connexion requise.');
  }
  if (!prisma) {
    return res.status(503).send('Service indisponible');
  }
  const tid = String(req.params.transactionId || '').trim();
  if (!tid) {
    return res.status(400).send('Identifiant invalide.');
  }
  try {
    const t = await prisma.creditTransaction.findFirst({
      where: { id: tid, userId, reason: 'vin_full_report' }
    });
    if (!t) {
      return res.status(404).send('Rapport introuvable.');
    }
    let meta = {};
    try {
      meta = JSON.parse(t.meta || '{}');
    } catch (e) {}
    if (!meta.fullReportJson) {
      return res.status(404).send(
        "Aucun relevé d'analyse enregistré pour ce rapport. Relancez une recherche (1 crédit)."
      );
    }
    const vin = (meta.vin && String(meta.vin).length === 17 ? String(meta.vin) : '').trim() || '—';
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true }
    });
    const vehicleData = vehicleDataForSaaSPdfFromTransactionMeta(meta);
    let fullBundle = null;
    try {
      if (meta.fullReportJson) fullBundle = JSON.parse(String(meta.fullReportJson));
    } catch (e) {
      fullBundle = null;
    }
    const pdfBuffer = await generateReportPdfBuffer(vehicleData, vin, {
      prenom: '',
      nom: '',
      email: (user && user.email) || '',
      planLabel: 'Espace client — analyse VIN (crédit)',
      montantEur: '1 crédit'
    }, { fullBundle });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="rapport-vin-carvinguard.pdf"');
    res.send(pdfBuffer);
  } catch (e) {
    console.error('vin/report/pdf:', e);
    return res.status(500).send('Erreur');
  }
});

app.get('/api/auth/me', async (req, res) => {
  if (!getPrisma()) {
    return res.status(503).json({ error: 'Comptes non disponibles.' });
  }
  const prisma = getPrisma();
  const userId = authLib.getUserIdFromCookies(req);
  if (!userId) {
    return res.status(401).json({ authenticated: false });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, credits: true, createdAt: true }
    });
    if (!user) {
      authLib.clearAuthCookie(res);
      return res.status(401).json({ authenticated: false });
    }
    return res.json({ authenticated: true, user });
  } catch (e) {
    console.error('me:', e);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * Abonnement (1 € puis mensuel) : Stripe Checkout hébergé.
 * — Client connecté : email + userId sur le PaymentIntent.
 * — Invité : paiement d’abord, création de compte dans le webhook (pas de compte avant Stripe).
 */
app.get('/api/billing/subscribe-checkout', async (req, res) => {
  if (!stripe) {
    return res.status(500).send('Stripe non configuré.');
  }
  const userId = authLib.getUserIdFromCookies(req);
  const base = appBaseUrl();
  const prisma = getPrisma();

  let user = null;
  if (userId) {
    if (!prisma) {
      return res.status(503).send('Base de données requise.');
    }
    try {
      user = await prisma.user.findUnique({ where: { id: userId } });
    } catch (e) {
      return res.status(500).send('Erreur base.');
    }
    if (!user || !user.email) {
      return res.redirect(302, base + '/compte.html');
    }
  }

  const trialDays = parseInt(process.env.SUBSCRIPTION_TRIAL_DAYS || '1', 10);
  const creditsPerCycle = parseInt(process.env.SUBSCRIPTION_CREDITS_PER_CYCLE || '7', 10);
  const subInitialCentsHint = parseInt(process.env.SUBSCRIPTION_INITIAL_CENTS_FOR_DISPLAY || '100', 10);
  const subMonthlyCentsHint = parseInt(process.env.SUBSCRIPTION_MONTHLY_CENTS_FOR_DISPLAY || '4999', 10);

  const cat = await resolveCarvinguardStripeCatalog(stripe);
  let initialPriceId = String(cat.subscription.initial || '').trim();
  let subscriptionMonthlyPriceId = String(cat.subscription.monthly || '').trim();
  if (!initialPriceId.startsWith('price_') || !subscriptionMonthlyPriceId.startsWith('price_')) {
    return res.status(503).send(
      'Abonnement : prix Stripe introuvables (attendu : ~' +
        (subInitialCentsHint / 100).toFixed(2).replace('.', ',') +
        ' € une fois + ~' +
        (subMonthlyCentsHint / 100).toFixed(2).replace('.', ',') +
        ' €/mois dans le catalogue). Vérifie tes produits Stripe.'
    );
  }

  try {
    const initialPrice = await stripe.prices.retrieve(initialPriceId);
    if (initialPrice && initialPrice.type === 'recurring') {
      return res
        .status(500)
        .send(
          'SUBSCRIPTION_PRICE_INITIAL_ID doit être un prix ponctuel (pas un prix « récurrent » seul).'
        );
    }
  } catch (e) {
    return res.status(500).send('Impossible de lire le prix initial Stripe.');
  }

  const piMeta = {
    purpose: 'subscription_initial',
    creditsPerCycle: String(creditsPerCycle),
    subscriptionMonthlyPriceId,
    trialDays: String(trialDays)
  };
  if (user) {
    piMeta.userId = String(user.id);
  }

  const sessionPayload = {
    mode: 'payment',
    /** Comme sur un Payment Link : champ code promo sur la page Stripe. */
    allow_promotion_codes: true,
    line_items: [{ price: initialPriceId, quantity: 1 }],
    payment_intent_data: {
      metadata: piMeta
    },
    success_url:
      base + '/compte.html?paid=1&credits=ok&sub=1&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: base + '/checkout.html',
    metadata: {
      app: 'carvinguard',
      carvinguard_plan: 'abonnement'
    }
  };
  if (user && user.email) {
    sessionPayload.customer_email = user.email;
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionPayload);
    if (!session.url) {
      return res.status(500).send('Session Stripe sans URL.');
    }
    return res.redirect(303, session.url);
  } catch (e) {
    console.error('subscribe-checkout:', e);
    return res.status(500).send(e.message || 'Erreur Stripe Checkout.');
  }
});

/**
 * Packs crédits (1 / 3 / 10 rapports) : session Checkout par l’API.
 * Utilisateur connecté : cguser / userId sur le PaymentIntent.
 * Invité : paiement d’abord — le webhook rattache l’email Stripe au compte créé après paiement.
 */
app.get('/api/billing/credit-checkout', async (req, res) => {
  if (!stripe) {
    return res.status(500).send('Stripe non configuré.');
  }
  const planKey = String(req.query.plan || '').toLowerCase();
  const plans = {
    essentiel: {
      credits: 1,
      packId: 'tier_essentiel',
      cents: parseInt(process.env.TIER_ESSENTIEL_CENTS || '1499', 10),
      name: 'Carvinguard — Rapport VIN unique'
    },
    confort: {
      credits: 3,
      packId: 'tier_confort',
      cents: parseInt(process.env.TIER_CONFORT_CENTS || '2999', 10),
      name: 'Carvinguard — Pack 3 rapports'
    },
    premium: {
      credits: 10,
      packId: 'tier_premium',
      cents: parseInt(process.env.TIER_PREMIUM_CENTS || '6999', 10),
      name: 'Carvinguard — Pack 10 rapports'
    }
  };
  const plan = plans[planKey];
  if (!plan || !plan.cents || plan.cents < 50) {
    return res.status(400).send('Formule inconnue ou montant invalide.');
  }

  const userId = authLib.getUserIdFromCookies(req);
  const base = appBaseUrl();

  const cat = await resolveCarvinguardStripeCatalog(stripe);

  // Build session — invités autorisés (pas besoin de compte avant paiement)
  const sessionData = {
    mode: 'payment',
    /** Même possibilité de réduction que sur buy.stripe.com (Payment Link). */
    allow_promotion_codes: true,
    line_items: creditPackCheckoutLineItems(planKey, plan, cat.credit[planKey]),
    metadata: {
      app: 'carvinguard',
      carvinguard_plan: planKey
    },
    payment_intent_data: {
      metadata: {
        purpose: 'credit_purchase',
        credits: String(plan.credits),
        packId: plan.packId,
        carvinguard_plan: planKey
      }
    },
    success_url:
      base + '/compte.html?paid=1&credits=ok&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: base + '/checkout.html'
  };

  // Utilisateur connecté : lier directement au compte existant
  if (userId) {
    const prisma = getPrisma();
    if (prisma) {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user && user.email) {
          sessionData.customer_email = user.email;
          sessionData.client_reference_id = ('cguser:' + user.id).slice(0, 80);
          sessionData.metadata.user_id = String(user.id);
          sessionData.payment_intent_data.metadata.userId = String(user.id);
          sessionData.payment_intent_data.metadata.email = user.email;
        }
      } catch (_e) { /* ignore, crée session sans lien compte */ }
    }
  }
  // Invité : Stripe collecte l'email → webhook crée le compte et envoie le lien d'invitation

  try {
    const session = await stripe.checkout.sessions.create(sessionData);
    if (!session.url) {
      return res.status(500).send('Session Stripe sans URL.');
    }
    return res.redirect(303, session.url);
  } catch (e) {
    console.error('credit-checkout:', e);
    return res.status(500).send(e.message || 'Erreur Stripe Checkout.');
  }
});

/**
 * Vrai si une ligne credit_transactions existe déjà pour ce PaymentIntent (idempotence crédit).
 */
async function isCheckoutSessionPaymentCredited(prisma, session) {
  if (!prisma || !session) return true;
  const piRef = session.payment_intent;
  const piId = typeof piRef === 'string' ? piRef : piRef && piRef.id;
  if (piId) {
    const row = await prisma.creditTransaction.findFirst({
      where: { stripePaymentIntentId: String(piId) }
    });
    return !!row;
  }
  const zfree = syntheticIdForFreeCheckoutSession(session.id);
  const rowZ = await prisma.creditTransaction.findFirst({
    where: { stripePaymentIntentId: zfree }
  });
  return !!rowZ;
}

/**
 * Résout l’e-mail d’une session Checkout (même logique que get-invite).
 * @param {import('stripe').Stripe.Checkout.Session} session
 * @param {import('stripe').Stripe.PaymentIntent | null} piObj
 */
function checkoutSessionPayerEmail(session, piObj) {
  const pm = (piObj && piObj.metadata) || {};
  let emailRaw =
    (session.customer_details && session.customer_details.email) ||
    session.customer_email ||
    (piObj && piObj.receipt_email) ||
    (pm.email ? String(pm.email) : '') ||
    '';
  if (!emailRaw && session.customer) {
    const cid = typeof session.customer === 'string' ? session.customer : session.customer && session.customer.id;
    if (cid && String(cid).startsWith('cus_')) {
      /* rempli côté appelant si besoin d’appel customers.retrieve */
    }
  }
  return emailRaw;
}

/**
 * Forcer la même finalisation que le webhook (checkout.session.completed) quand
 * l’utilisateur est connecté et a encore ?session_id= sur /compte (webhook manquant, etc.).
 */
app.post('/api/billing/reconcile-checkout', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (!stripe) {
    return res.status(500).json({ ok: false, error: 'Stripe non configuré.' });
  }
  const prisma = getPrisma();
  if (!prisma) {
    return res.status(503).json({ ok: false, error: 'Base de données requise.' });
  }
  const userId = authLib.getUserIdFromCookies(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Connexion requise.' });
  }
  const sessionId = String((req.body && req.body.session_id) || '');
  if (!sessionId.startsWith('cs_')) {
    return res.status(400).json({ ok: false, error: 'session_id invalide.' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Session invalide.' });
    }
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent']
    });
    const piObj =
      session.payment_intent && typeof session.payment_intent === 'object'
        ? session.payment_intent
        : null;
    let emailRaw = checkoutSessionPayerEmail(session, piObj);
    if (!emailRaw && session.customer) {
      const cid = typeof session.customer === 'string' ? session.customer : session.customer && session.customer.id;
      if (cid && String(cid).startsWith('cus_')) {
        try {
          const cust = await stripe.customers.retrieve(String(cid));
          if (cust && cust.email) emailRaw = String(cust.email);
        } catch (_) {
          /* ignore */
        }
      }
    }
    const email = authLib.normalizeEmail(emailRaw);
    const sm = session.metadata || {};
    const sameAccount =
      (sm.user_id && String(sm.user_id) === String(userId)) || (email && user.email === email);
    if (!sameAccount) {
      return res.status(403).json({
        ok: false,
        error:
          "L'adresse e-mail de ce paiement Stripe ne correspond pas à votre compte. Utilisez le compte lié à l’e-mail saisi sur Stripe, ou contactez le support."
      });
    }
    const ps0 = session.payment_status;
    if ((ps0 !== 'paid' && ps0 !== 'no_payment_required') || session.mode !== 'payment') {
      return res.json({
        ok: true,
        skipped: true,
        credits: user.credits,
        message: 'Session déjà traitée ou type de paiement non géré ici.'
      });
    }
    if (await isCheckoutSessionPaymentCredited(prisma, session)) {
      const u2 = await prisma.user.findUnique({ where: { id: userId }, select: { credits: true } });
      return res.json({ ok: true, already: true, credits: u2 != null ? u2.credits : 0 });
    }
    await handleCheckoutSessionCompleted(session);
    const u2 = await prisma.user.findUnique({ where: { id: userId }, select: { credits: true } });
    return res.json({ ok: true, reconciled: true, credits: u2 != null ? u2.credits : 0 });
  } catch (e) {
    console.error('reconcile-checkout:', e);
    return res.status(500).json({ ok: false, error: e.message || 'Erreur serveur' });
  }
});

/**
 * Après paiement invité : récupère l'email Stripe + génère un token d'invitation
 * pour afficher directement l'overlay "Activez votre compte" côté frontend.
 */
app.get('/api/billing/get-invite', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (!stripe) return res.status(500).json({ error: 'Stripe non configuré.' });
  const sessionId = String(req.query.session_id || '');
  if (!sessionId.startsWith('cs_')) {
    return res.status(400).json({ error: 'session_id invalide.' });
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent']
    });

    const piObj =
      session.payment_intent && typeof session.payment_intent === 'object'
        ? session.payment_intent
        : null;
    const pm = (piObj && piObj.metadata) || {};

    let emailRaw =
      (session.customer_details && session.customer_details.email) ||
      session.customer_email ||
      (piObj && piObj.receipt_email) ||
      (pm.email ? String(pm.email) : '') ||
      '';

    if (!emailRaw && session.customer) {
      const cid = typeof session.customer === 'string' ? session.customer : session.customer && session.customer.id;
      if (cid && String(cid).startsWith('cus_')) {
        try {
          const cust = await stripe.customers.retrieve(cid);
          if (cust && cust.email) emailRaw = String(cust.email);
        } catch (_) {
          /* ignore */
        }
      }
    }

    const email = authLib.normalizeEmail(emailRaw);
    if (!email || email.indexOf('@') === -1) {
      return res.json({ ready: false, reason: 'no_email' });
    }

    const prisma = getPrisma();
    if (!prisma) return res.json({ email, ready: false, reason: 'no_db' });

    let user = await prisma.user.findUnique({ where: { email } });

    /**
     * Webhook en retard / absent : rejoue checkout.session.completed.
     * Important : on ne l’exigeait pas seulement si `!user` : si l’utilisateur existait
     * déjà (ex. 0 crédit) le webhook n’avait jamais été rejoué → solde restait à 0.
     * Idempotence : si le PI a déjà une écriture, on ne rappelle pas inutilement.
     */
    const psInv = session.payment_status;
    if ((psInv === 'paid' || psInv === 'no_payment_required') && session.mode === 'payment') {
      const credited = await isCheckoutSessionPaymentCredited(prisma, session);
      if (!credited) {
        try {
          await handleCheckoutSessionCompleted(session);
        } catch (e) {
          console.error('get-invite reconcile:', e.message || e);
        }
      }
      user = await prisma.user.findUnique({ where: { email } });
    }

    if (!user) {
      console.warn(
        'get-invite: toujours sans utilisateur après réconciliation',
        sessionId.substring(0, 24),
        'payment_status=',
        session.payment_status,
        'mode=',
        session.mode
      );
      return res.json({ email, ready: false, reason: 'pending' });
    }

    const invToken = authLib.signAccountInviteToken(user.id);
    return res.json({ email, ready: true, inviteToken: invToken });
  } catch (e) {
    console.error('get-invite:', e);
    const msg = e && e.message ? String(e.message) : '';
    const code = e && e.code ? String(e.code) : '';
    const prismaConnCodes = new Set([
      'P1000',
      'P1001',
      'P1002',
      'P1003',
      'P1008',
      'P1009',
      'P1010',
      'P1011',
      'P1012',
      'P1013',
      'P1014',
      'P1015',
      'P1016',
      'P1017'
    ]);
    const isDbUnreachable =
      prismaConnCodes.has(code) ||
      /Can't reach database|ECONNREFUSED|ETIMEDOUT|connection.*(refused|timeout)|ENOTFOUND/i.test(
        msg
      );
    if (isDbUnreachable) {
      return res.json({ ready: false, reason: 'temporary' });
    }
    return res.status(500).json({
      error:
        'Impossible de finaliser pour le moment. Réessayez sous peu ou utilisez le lien reçu par email.'
    });
  }
});

app.post('/api/create-credit-purchase-intent', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe non configuré.' });
  }
  const userId = authLib.getUserIdFromCookies(req);
  if (!userId) {
    return res.status(401).json({ error: 'Connexion requise.' });
  }
  const prisma = getPrisma();
  if (!prisma) {
    return res.status(503).json({ error: 'Base de données requise.' });
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return res.status(401).json({ error: 'Session invalide.' });
  }
  const cat = await resolveCarvinguardStripeCatalog(stripe);
  const packId = req.body && req.body.packId;
  const packs = {
    tier_essentiel: {
      type: 'credit_purchase',
      credits: 1,
      cents: parseInt(process.env.TIER_ESSENTIEL_CENTS || '1499', 10)
    },
    tier_confort: {
      type: 'credit_purchase',
      credits: 3,
      cents: parseInt(process.env.TIER_CONFORT_CENTS || '2999', 10)
    },
    tier_premium: {
      type: 'credit_purchase',
      credits: 10,
      cents: parseInt(process.env.TIER_PREMIUM_CENTS || '6999', 10)
    },
    sub_monthly_7: {
      type: 'subscription_initial',
      creditsPerCycle: parseInt(process.env.SUBSCRIPTION_CREDITS_PER_CYCLE || '7', 10),
      initialPriceId: cat.subscription.initial || '',
      subscriptionMonthlyPriceId: cat.subscription.monthly || '',
      trialDays: parseInt(process.env.SUBSCRIPTION_TRIAL_DAYS || '1', 10)
    }
  };
  const p = packs[packId];
  if (!p || (p.type === 'credit_purchase' && p.cents < 50)) {
    return res.status(400).json({ error: 'Forfait inconnu.' });
  }
  try {
    let amountCents = p.cents;
    if (p.type === 'subscription_initial') {
      if (!p.initialPriceId || !p.subscriptionMonthlyPriceId) {
        return res.status(400).json({ error: 'Abonnement : prix initiaux / mensuels introuvables sur Stripe.' });
      }
      const initialPrice = await stripe.prices.retrieve(p.initialPriceId);
      amountCents = initialPrice.unit_amount;
      if (!amountCents || amountCents < 50 || initialPrice.currency !== 'eur') {
        return res.status(400).json({ error: 'Initial price invalide sur Stripe (attendu EUR).' });
      }
    }

    const metadata = {
      purpose: p.type,
      userId: String(userId),
    };
    if (p.type === 'credit_purchase') {
      metadata.credits = String(p.credits);
      metadata.packId = String(packId);
    }
    if (p.type === 'subscription_initial') {
      metadata.creditsPerCycle = String(p.creditsPerCycle);
      metadata.subscriptionMonthlyPriceId = String(p.subscriptionMonthlyPriceId);
      metadata.trialDays = String(p.trialDays);
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata
    });
    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (e) {
    console.error('create-credit-purchase-intent:', e);
    return res.status(500).json({ error: e.message || 'Erreur paiement' });
  }
});

// ---------- Auto-Blog SEO : API et pages (si DATABASE_URL configurée) ----------
const blogLib = (function () {
  try {
    return require('./lib/blog');
  } catch (e) {
    return null;
  }
})();
const blogRender = (function () {
  try {
    return require('./lib/blog-render');
  } catch (e) {
    return null;
  }
})();

function getBlogConfig() {
  const configPath = path.join(__dirname, 'content', 'blog-config.json');
  if (!fs.existsSync(configPath)) {
    return { baseUrl: process.env.BASE_URL || 'https://www.carvinguard.fr', blogPath: '/blog', categories: {} };
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// CRON : génération de 2 articles (protégé par CRON_SECRET)
app.get('/api/cron/generate-articles', async (req, res) => {
  const secret = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  if (!blogLib) {
    return res.status(503).json({ error: 'Module blog non disponible' });
  }
  try {
    const result = await blogLib.runCronGenerateArticles();
    return res.json({ ok: true, proposals: result.proposals?.length, emailId: result.emailId });
  } catch (e) {
    console.error('Cron generate-articles:', e);
    return res.status(500).json({ error: e.message || 'Erreur génération' });
  }
});

// Approbation d'un article (clic depuis l'email)
app.get('/api/blog/approve', async (req, res) => {
  const token = req.query.token;
  if (!token || !blogLib) {
    return res.redirect(302, '/blog?error=invalid');
  }
  try {
    const authToken = await blogLib.getProposalByToken(token);
    if (!authToken) {
      return res.redirect(302, '/blog?error=expired');
    }
    const published = await blogLib.approveArticle(authToken.proposal.id);
    if (published?.slug) {
      return res.redirect(302, '/blog/' + encodeURIComponent(published.slug));
    }
    return res.redirect(302, '/blog/published');
  } catch (e) {
    console.error('Approve blog:', e);
    return res.redirect(302, '/blog?error=error');
  }
});

// API liste des articles publiés (pour sitemap / usage externe)
app.get('/api/blog/posts', async (req, res) => {
  if (!blogLib) return res.json([]);
  try {
    const posts = await blogLib.getBlogPosts();
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.json(posts.map(p => ({
      slug: p.slug,
      title: p.title,
      description: p.description,
      publishedAt: p.publishedAt,
      category: p.category
    })));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Pages blog dynamiques
{
  app.get('/blog/published', (req, res) => {
    if (!blogRender) return res.redirect(302, '/blog');
    const config = getBlogConfig();
    const html = blogRender ? blogRender.renderBlogPublished(config) : '';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html || '<p>Module de rendu indisponible.</p>');
  });

  const serveBlogIndex = async (req, res) => {
    if (!blogLib || !blogRender) return res.redirect(302, '/blog/index.html');
    try {
      const posts = await blogLib.getBlogPosts();
      const config = getBlogConfig();
      const html = blogRender ? blogRender.renderBlogIndex(config, posts) : '';
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html || '<p>Aucun article.</p>');
    } catch (e) {
      console.error('Blog index:', e);
      res.status(500).send('Erreur chargement du blog.');
    }
  };
  app.get('/blog', serveBlogIndex);
  app.get('/blog/', serveBlogIndex);

  app.get('/blog/:slug', async (req, res, next) => {
    if (req.params.slug === 'index.html' || req.params.slug === 'published') return next();
    if (!blogLib || !blogRender) return next();
    try {
      const post = await blogLib.getBlogPostBySlug(req.params.slug);
      if (!post) return next();
      const posts = await blogLib.getBlogPosts();
      const config = getBlogConfig();
      const html = blogRender ? blogRender.renderBlogArticle(config, post, posts) : '';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e) {
      console.error('Blog article:', e);
      res.status(500).send('Erreur.');
    }
  });

  // Compatibilité ancienne URL /blog/mon-article.html
  app.get('/blog/:slug.html', async (req, res, next) => {
    if (!blogLib) return next();
    try {
      const post = await blogLib.getBlogPostBySlug(req.params.slug);
      if (!post) return next();
      return res.redirect(301, '/blog/' + encodeURIComponent(req.params.slug));
    } catch (e) {
      return next();
    }
  });

  // Compatibilité URL legacy à la racine: /mon-article.html
  app.get('/:slug.html', async (req, res, next) => {
    // Laisse les pages statiques existantes (contact.html, etc.) passer
    const staticPages = new Set([
      'index',
      'contact',
      'compte',
      'guides',
      'aide',
      'demarches',
      'carte-grise',
      'papiers',
      'mentions-legales',
      'conditions-generales-vente',
      'conditions-generales-utilisation',
      'politique-confidentialite',
      'prix-carte-grise',
      'prix-cheval-fiscal',
      'checkout',
      'recapitulatif'
    ]);
    if (staticPages.has(req.params.slug)) return next();
    if (!blogLib) return next();
    try {
      const post = await blogLib.getBlogPostBySlug(req.params.slug);
      if (!post) return next();
      return res.redirect(301, '/blog/' + encodeURIComponent(req.params.slug));
    } catch (e) {
      return next();
    }
  });

  // Sitemap dynamique (inclut les articles du blog)
  app.get('/sitemap.xml', async (req, res) => {
    const baseUrl = (process.env.BASE_URL || getBlogConfig().baseUrl || 'https://www.carvinguard.fr').replace(/\/$/, '');
    const staticUrls = [
      { loc: baseUrl + '/', changefreq: 'weekly', priority: '1.0' },
      { loc: baseUrl + '/conditions-generales-vente.html', changefreq: 'yearly', priority: '0.5' },
      { loc: baseUrl + '/conditions-generales-utilisation.html', changefreq: 'yearly', priority: '0.5' },
      { loc: baseUrl + '/politique-confidentialite.html', changefreq: 'yearly', priority: '0.5' },
      { loc: baseUrl + '/contact.html', changefreq: 'monthly', priority: '0.8' },
      { loc: baseUrl + '/resiliation-abonnement.html', changefreq: 'yearly', priority: '0.5' },
      { loc: baseUrl + '/aide.html', changefreq: 'monthly', priority: '0.8' },
      { loc: baseUrl + '/carte-grise.html', changefreq: 'monthly', priority: '0.8' },
      { loc: baseUrl + '/demarches.html', changefreq: 'monthly', priority: '0.9' },
      { loc: baseUrl + '/prix-carte-grise.html', changefreq: 'monthly', priority: '0.8' },
      { loc: baseUrl + '/prix-cheval-fiscal.html', changefreq: 'monthly', priority: '0.8' },
      { loc: baseUrl + '/papiers.html', changefreq: 'monthly', priority: '0.8' },
      { loc: baseUrl + '/mentions-legales.html', changefreq: 'monthly', priority: '0.5' },
      { loc: baseUrl + '/blog', changefreq: 'weekly', priority: '0.8' }
    ];
    let posts = [];
    try {
      posts = blogLib ? await blogLib.getBlogPosts() : [];
    } catch (_) {}
    const lastmod = new Date().toISOString().slice(0, 10);
    const urlEntries = [
      ...staticUrls.map(u => `<url><loc>${escapeXml(u.loc)}</loc><lastmod>${lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`),
      ...posts.map(p => `<url><loc>${escapeXml(baseUrl + '/blog/' + encodeURIComponent(p.slug))}</loc><lastmod>${p.publishedAt ? new Date(p.publishedAt).toISOString().slice(0, 10) : lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`)
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${urlEntries.join('\n')}
</urlset>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  });
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Fichiers statiques : public/ (obligatoire pour Vercel, qui sert public/ via CDN)
app.use(express.static(path.join(__dirname, 'public')));

// API VIN Decode — proxy CarAPI.dev (prioritaire) ou Vehicle Databases
// ?preview=1 : décodage public (page d'accueil) — pas de compte ni de crédit ; le rapport détaillé reste derrière le paiement côté UI
app.get('/api/vin-decode/:vin', async (req, res) => {
  const prisma = getPrisma();
  const provider = getVinDecodeProvider();
  const vin = (req.params.vin || '').replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '').toUpperCase();
  const vinMasked = vin.slice(0, 11) + '…';
  const q = req.query || {};
  const isPreview = q.preview === '1' || q.preview === 'true';

  if (vin.length !== 17) {
    return res.status(400).json({ status: 'error', message: 'VIN invalide (17 caractères requis)' });
  }

  const requireAccountForVin = !!(prisma && provider) && !isPreview;
  let userId = null;

  if (requireAccountForVin) {
    const tokenUserId = authLib.getUserIdFromCookies(req);
    if (!tokenUserId) {
      return res.status(401).json({
        status: 'error',
        code: 'AUTH_REQUIRED',
        message: 'Connectez-vous pour lancer une recherche VIN (1 crédit par recherche).'
      });
    }
    userId = tokenUserId;
    let vinCtxId = null;
    try {
      const charged = await prisma.$transaction(async (tx) => {
        const updated = await tx.user.updateMany({
          where: { id: userId, credits: { gte: 1 } },
          data: { credits: { decrement: 1 } }
        });
        if (updated.count === 0) {
          const u = await tx.user.findUnique({
            where: { id: userId },
            select: { credits: true }
          });
          return { ok: false, credits: u ? u.credits : 0 };
        }
        const ct = await tx.creditTransaction.create({
          data: {
            userId,
            delta: -1,
            reason: 'vin_decode',
            meta: JSON.stringify({ vin })
          }
        });
        return { ok: true, ctxId: ct.id };
      });
      if (!charged.ok) {
        return res.status(402).json({
          status: 'error',
          code: 'INSUFFICIENT_CREDITS',
          message: 'Crédits insuffisants. Rechargez votre compte.',
          credits: charged.credits
        });
      }
      if (charged.ctxId) vinCtxId = charged.ctxId;
    } catch (e) {
      console.error('Débit crédit VIN:', e);
      return res.status(500).json({ status: 'error', message: 'Erreur compte' });
    }
  }

  if (!provider) {
    const nhtsaOnly = await decodeVinViaNhtsa(vin);
    if (nhtsaOnly && nhtsaOnly.status === 'success') {
      const out = Object.assign({}, nhtsaOnly);
      if (isPreview) out.access = 'preview';
      return res.json(out);
    }
    if (isPreview) {
      return res.json(previewPartialVinJson());
    }
    return res.status(503).json({
      status: 'error',
      error: 'Service VIN non configuré',
      degraded: true
    });
  }

  try {
    if (provider.id === 'carapi') {
      const url = `https://api.carapi.dev/v1/vin-decode/${encodeURIComponent(vin)}?token=${encodeURIComponent(provider.apiKey)}`;
      const extRes = await fetch(url, { signal: fetchTimeoutSignal(12000) });
      let data = {};
      try {
        data = await extRes.json();
      } catch (_) {
        data = {};
      }

      if (extRes.ok) {
        const norm = normalizeCarApiVinResponse(data);
        if (norm.ok) {
          const outCar = Object.assign({}, norm.json);
          if (isPreview) outCar.access = 'preview';
          // Enrich creditTransaction with vehicle data for history
          if (vinCtxId && prisma && norm.json && norm.json.data) {
            const d = norm.json.data;
            prisma.creditTransaction.update({
              where: { id: vinCtxId },
              data: { meta: JSON.stringify({ vin, make: d.make || '', model: d.model || '', year: d.year || '', fuel_type: d.fuel_type || '', engine: d.engine || '' }) }
            }).catch(function () {});
          }
          return res.json(outCar);
        }
      }

      if (requireAccountForVin) {
        await refundVinDecodeCredit(userId, vinMasked);
      }

      const nhtsaCar = await decodeVinViaNhtsa(vin);
      if (nhtsaCar && nhtsaCar.status === 'success') {
        const out = Object.assign({}, nhtsaCar);
        if (isPreview) out.access = 'preview';
        if (vinCtxId && prisma && nhtsaCar.data) {
          const d = nhtsaCar.data;
          prisma.creditTransaction.update({
            where: { id: vinCtxId },
            data: { meta: JSON.stringify({ vin, make: d.make || '', model: d.model || '', year: d.year || '' }) }
          }).catch(function () {});
        }
        return res.json(out);
      }

      if (!extRes.ok) {
        if (isPreview && extRes.status !== 429) {
          return res.json(previewPartialVinJson());
        }
        const msg =
          (data && (data.message || data.error)) ||
          (extRes.status === 429 ? 'Quota API VIN dépassé. Réessayez plus tard.' : null) ||
          'VIN introuvable';
        const statusOut = extRes.status >= 400 && extRes.status < 600 ? extRes.status : 502;
        return res.status(statusOut).json({ status: 'error', message: String(msg) });
      }
      const normFail = normalizeCarApiVinResponse(data);
      if (isPreview) {
        return res.json(previewPartialVinJson());
      }
      return res.status(normFail.httpStatus).json({ status: 'error', message: normFail.message });
    }

    const extRes = await fetch(
      `https://api.vehicledatabases.com/advanced-vin-decode/v2/${vin}`,
      { headers: { 'x-authkey': provider.apiKey }, signal: fetchTimeoutSignal(12000) }
    );
    let data = {};
    try {
      data = await extRes.json();
    } catch (_) {
      data = {};
    }
    if (!extRes.ok) {
      if (requireAccountForVin) {
        await refundVinDecodeCredit(userId, vinMasked);
      }
      const nhtsaVd = await decodeVinViaNhtsa(vin);
      if (nhtsaVd && nhtsaVd.status === 'success') {
        const out = Object.assign({}, nhtsaVd);
        if (isPreview) out.access = 'preview';
        return res.json(out);
      }
      if (isPreview) {
        return res.json(previewPartialVinJson());
      }
      return res.status(extRes.status).json({
        status: 'error',
        message: data.message || data.error || 'VIN introuvable'
      });
    }
    if (data.status === 'error') {
      if (requireAccountForVin) {
        await refundVinDecodeCredit(userId, vinMasked);
      }
      const nhtsaErr = await decodeVinViaNhtsa(vin);
      if (nhtsaErr && nhtsaErr.status === 'success') {
        const out = Object.assign({}, nhtsaErr);
        if (isPreview) out.access = 'preview';
        return res.json(out);
      }
      if (isPreview) {
        return res.json(previewPartialVinJson());
      }
      return res.status(400).json({
        status: 'error',
        message: data.message || 'VIN introuvable ou invalide'
      });
    }
    const outVd = typeof data === 'object' && data !== null ? Object.assign({}, data) : data;
    if (isPreview && outVd && typeof outVd === 'object') outVd.access = 'preview';
    // Enrich creditTransaction with vehicle data for history (Vehicle Databases path)
    if (vinCtxId && prisma && outVd && outVd.data) {
      const d = outVd.data;
      prisma.creditTransaction.update({
        where: { id: vinCtxId },
        data: { meta: JSON.stringify({ vin, make: d.make || '', model: d.model || '', year: d.year || '', fuel_type: d.fuel_type || d.fuelType || '', engine: d.engine || '' }) }
      }).catch(function () {});
    }
    res.json(outVd);
  } catch (e) {
    console.error('VIN decode:', e.message);
    if (requireAccountForVin) {
      await refundVinDecodeCredit(userId, vinMasked);
    }
    if (isPreview) {
      return res.json(previewPartialVinJson());
    }
    res.status(500).json({ status: 'error', message: 'Erreur service VIN' });
  }
});

/**
 * Rapport VIN « complet » CarAPI (1 crédit) : décode + inspection, vol, km, photos, financement, cote, annonces
 * (fetchCarApiFullEnrichment). Réservé quand CARAPI_TOKEN est configuré.
 */
app.get('/api/vin-full-report/:vin', async (req, res) => {
  const prisma = getPrisma();
  const provider = getVinDecodeProvider();
  const vin = (req.params.vin || '').replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '').toUpperCase();
  const vinMasked = vin.slice(0, 11) + '…';
  if (vin.length !== 17) {
    return res.status(400).json({ status: 'error', message: 'VIN invalide (17 caractères requis)' });
  }
  if (!prisma) {
    return res.status(503).json({ status: 'error', message: 'Base de données requise.' });
  }
  if (!provider || provider.id !== 'carapi') {
    return res.status(503).json({
      status: 'error',
      code: 'CARAPI_REQUIRED',
      message:
        'Rapport complet indisponible : configurez CARAPI_TOKEN (CarAPI.dev) côté serveur. Le décodage de base reste disponible via l’autre mode.'
    });
  }
  const userId = authLib.getUserIdFromCookies(req);
  if (!userId) {
    return res.status(401).json({
      status: 'error',
      code: 'AUTH_REQUIRED',
      message: 'Connectez-vous pour lancer un rapport (1 crédit).'
    });
  }
  let vinCtxId = null;
  try {
    const charged = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId, credits: { gte: 1 } },
        data: { credits: { decrement: 1 } }
      });
      if (updated.count === 0) {
        const u = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
        return { ok: false, credits: u ? u.credits : 0 };
      }
      const ct = await tx.creditTransaction.create({
        data: {
          userId,
          delta: -1,
          reason: 'vin_full_report',
          meta: JSON.stringify({ vin })
        }
      });
      return { ok: true, ctxId: ct.id };
    });
    if (!charged.ok) {
      return res.status(402).json({
        status: 'error',
        code: 'INSUFFICIENT_CREDITS',
        message: 'Crédits insuffisants. Rechargez votre compte.',
        credits: charged.credits
      });
    }
    if (charged.ctxId) vinCtxId = charged.ctxId;
  } catch (e) {
    console.error('Débit rapport VIN complet:', e);
    return res.status(500).json({ status: 'error', message: 'Erreur compte' });
  }

  try {
    const q = req.query || {};
    const bundle = await carapiClient.fetchCarApiFullEnrichment(provider.apiKey, {
      vin,
      country: q.country,
      listingLimit: q.listingLimit,
      listingOffset: q.listingOffset,
      payment: {
        price: q.price,
        downPayment: q.downPayment,
        loanTerm: q.loanTerm,
        interestRate: q.interestRate
      }
    });
    const dec = bundle.decode;
    const decodeBody = dec && dec.data;
    let identity = (dec && dec.identity) || carapiClient.extractVinDecodeIdentity(decodeBody);
    const decodeFailed = !dec || !dec.ok || !identity;
    if (decodeFailed) {
      const st = dec && dec.status;
      const b0 = decodeBody;
      const apiMsg =
        b0 && typeof b0 === 'object'
          ? (typeof b0.error === 'string'
              ? b0.error
              : typeof b0.message === 'string'
                ? b0.message
                : '')
          : '';
      // Auth/quota errors -> hard fail + refund
      const isHardFail = !dec || st === 401 || st === 403 || st === 429;
      if (!isHardFail) {
        // VIN unknown to CarAPI (often EU VINs) -> try NHTSA
        const nhtsaJson = await decodeVinViaNhtsa(vin);
        if (nhtsaJson && nhtsaJson.status === 'success' && nhtsaJson.data) {
          const nd = nhtsaJson.data;
          const yr = nd.year ? parseInt(String(nd.year), 10) : null;
          identity = {
            make: nd.make || '',
            model: nd.model || '',
            year: Number.isFinite(yr) ? yr : null,
            trim: nd.trim || '',
            engine: nd.engine || '',
            transmission: nd.transmission || '',
            fuel_type: nd.fuel_type || '',
            drivetrain: nd.drivetrain || '',
            fromNhtsa: true
          };
          if (bundle.decode) {
            bundle.decode.identity = identity;
            bundle.decode.ok = true;
          }
          console.log('CarAPI NHTSA fallback for', vinMasked, 'year:', identity.year);
        } else {
          await refundVinDecodeCredit(userId, vinMasked);
          return res.status(502).json({
            status: 'error',
            code: 'VIN_DECODE_FAILED',
            message: 'VIN non reconnu (CarAPI + NHTSA). Credit reattribue. Pour les vehicules europeens, activez VEHICLEDATABASES_API_KEY.'
          });
        }
      } else {
        await refundVinDecodeCredit(userId, vinMasked);
        let message = 'Decodage VIN indisponible. Votre credit a ete reattribue.';
        if (st === 401 || st === 403) {
          message = 'Cle CarAPI refusee (HTTP ' + st + '). Verifiez CARAPI_TOKEN sur Vercel.';
        } else if (st === 429) {
          message = 'Quota CarAPI depasse. Reessayez plus tard. Credit reattribue.';
        } else if (apiMsg) {
          message = 'CarAPI: ' + apiMsg + ' (HTTP ' + (st != null ? st : '?') + '). Credit reattribue.';
        }
        return res.status(502).json({
          status: 'error',
          code: 'VIN_DECODE_FAILED',
          message,
          carapiHttpStatus: st != null ? st : null,
          carapiError: apiMsg || null
        });
      }
    }
    if (vinCtxId && identity) {
      const d = identity;
      const meta = {
        vin,
        make: d.make != null ? String(d.make) : '',
        model: d.model != null ? String(d.model) : '',
        year: d.year != null ? String(d.year) : '',
        fuel_type: d.fuel_type != null ? String(d.fuel_type) : '',
        engine: d.engine != null ? String(d.engine) : '',
        reportType: 'carapi_full'
      };
      const snap = slimCarApiBundleForMetaSnapshot(bundle);
      if (snap) {
        meta.fullReportJson = snap;
      }
      prisma.creditTransaction
        .update({
          where: { id: vinCtxId },
          data: { meta: JSON.stringify(meta) }
        })
        .catch(function () {});
    }
    return res.json({ status: 'success', data: bundle, transactionId: vinCtxId || null });
  } catch (e) {
    console.error('Rapport VIN complet CarAPI:', e.message);
    await refundVinDecodeCredit(userId, vinMasked);
    return res.status(500).json({ status: 'error', message: 'Erreur service CarAPI' });
  }
});

/**
 * CarAPI « plan max » : proxy serveur pour inspection, vol, kilométrage, cotation, annonces, photos, financement.
 * Doc officielle : https://api.carapi.dev/openapi.json — le jeton reste uniquement côté serveur (CARAPI_TOKEN).
 */
app.get('/api/carapi/status', (req, res) => {
  const p = getVinDecodeProvider();
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.json({
    status: 'ok',
    carApiConfigured: !!(p && p.id === 'carapi'),
    endpoints: carapiClient.CARAPI_ENDPOINT_IDS
  });
});

app.get('/api/carapi/enrichment/:vin', async (req, res) => {
  const prisma = getPrisma();
  const vin = (req.params.vin || '').replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '').toUpperCase();
  const vinMasked = vin.slice(0, 11) + '…';
  if (vin.length !== 17) {
    return res.status(400).json({ status: 'error', message: 'VIN invalide (17 caractères requis)' });
  }
  const provider = getVinDecodeProvider();
  if (!provider || provider.id !== 'carapi') {
    return res.status(503).json({
      status: 'error',
      message:
        'Enrichissement CarAPI indisponible : définissez CARAPI_TOKEN (compte CarAPI.dev). Les autres fournisseurs ne couvrent pas ces endpoints.'
    });
  }
  if (!prisma) {
    return res.status(503).json({
      status: 'error',
      message: 'Compte crédité requis (base de données / DATABASE_URL).'
    });
  }
  const userId = authLib.getUserIdFromCookies(req);
  if (!userId) {
    return res.status(401).json({
      status: 'error',
      code: 'AUTH_REQUIRED',
      message: 'Connectez-vous pour lancer l’analyse complète (1 crédit).'
    });
  }

  const charged = await debitOneCredit(userId, 'carapi_enrichment', { vin: vinMasked });
  if (!charged.ok) {
    return res.status(402).json({
      status: 'error',
      code: 'INSUFFICIENT_CREDITS',
      message: 'Crédits insuffisants. Rechargez votre compte.',
      credits: charged.credits
    });
  }

  try {
    const q = req.query || {};
    const bundle = await carapiClient.fetchCarApiFullEnrichment(provider.apiKey, {
      vin,
      country: q.country,
      listingLimit: q.listingLimit,
      listingOffset: q.listingOffset,
      payment: {
        price: q.price,
        downPayment: q.downPayment,
        loanTerm: q.loanTerm,
        interestRate: q.interestRate
      }
    });
    const dec = bundle.decode;
    const identity = (dec && dec.identity) || carapiClient.extractVinDecodeIdentity(dec && dec.data);
    const decodeFailed = !dec || !dec.ok || !identity;
    if (decodeFailed) {
      await refundOneCredit(userId, 'carapi_enrichment_refund', { vin: vinMasked });
      return res.status(502).json({
        status: 'error',
        message: 'Décodage VIN CarAPI indisponible. Votre crédit a été réattribué.',
        detail: dec.data != null ? dec.data : null
      });
    }
    res.json({ status: 'success', data: bundle });
  } catch (e) {
    console.error('CarAPI enrichment:', e.message);
    await refundOneCredit(userId, 'carapi_enrichment_refund', { vin: vinMasked });
    res.status(500).json({ status: 'error', message: 'Erreur service CarAPI' });
  }
});

app.get('/api/carapi/plate-to-vin/:plate', async (req, res) => {
  const prisma = getPrisma();
  const provider = getVinDecodeProvider();
  if (!provider || provider.id !== 'carapi') {
    return res.status(503).json({
      status: 'error',
      message: 'Plaque → VIN indisponible sans CARAPI_TOKEN (CarAPI.dev).'
    });
  }
  if (!prisma) {
    return res.status(503).json({
      status: 'error',
      message: 'Compte crédité requis (DATABASE_URL).'
    });
  }
  const userId = authLib.getUserIdFromCookies(req);
  if (!userId) {
    return res.status(401).json({
      status: 'error',
      code: 'AUTH_REQUIRED',
      message: 'Connectez-vous pour convertir une plaque (1 crédit).'
    });
  }
  const country = String(req.query.country || '')
    .toUpperCase()
    .slice(0, 2);
  if (country.length !== 2) {
    return res.status(400).json({
      status: 'error',
      message: 'Indiquez country (code ISO à 2 lettres, ex. FR, DE).'
    });
  }
  let plate = req.params.plate || '';
  try {
    plate = decodeURIComponent(plate);
  } catch (_) {
    plate = req.params.plate || '';
  }
  plate = String(plate).trim();
  if (!plate || plate.length > 40) {
    return res.status(400).json({ status: 'error', message: 'Plaque invalide.' });
  }
  const plateHint = plate.slice(0, 12);

  const charged = await debitOneCredit(userId, 'carapi_plate_to_vin', { plate: plateHint });
  if (!charged.ok) {
    return res.status(402).json({
      status: 'error',
      code: 'INSUFFICIENT_CREDITS',
      message: 'Crédits insuffisants. Rechargez votre compte.',
      credits: charged.credits
    });
  }

  try {
    const r = await carapiClient.carApiGet(provider.apiKey, `/plate-to-vin/${encodeURIComponent(plate)}`, {
      country
    });
    if (!r.ok) {
      await refundOneCredit(userId, 'carapi_plate_refund', { plate: plateHint });
      const msg =
        (r.body && (r.body.message || (typeof r.body.error === 'string' ? r.body.error : r.body.error?.message))) ||
        'Plaque introuvable ou service indisponible';
      const statusOut = r.status >= 400 && r.status < 600 ? r.status : 502;
      return res.status(statusOut).json({
        status: 'error',
        message: String(msg),
        data: r.body
      });
    }
    res.json({ status: 'success', data: r.body });
  } catch (e) {
    console.error('CarAPI plate:', e.message);
    await refundOneCredit(userId, 'carapi_plate_refund', { plate: plateHint });
    res.status(500).json({ status: 'error', message: 'Erreur service CarAPI' });
  }
});

// API Départements
app.get('/api/departements', (req, res) => {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'data', 'departements.json'), 'utf8');
    res.json(JSON.parse(data));
  } catch (e) {
    res.status(500).json({ error: 'Erreur chargement départements' });
  }
});


// API Config (clé publique Stripe pour le frontend)
app.get('/api/config', (req, res) => {
  const pk = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!pk) {
    return res.status(500).json({ error: 'Stripe non configuré' });
  }
  res.json({ stripePublishableKey: pk });
});

/** Liens Stripe Checkout / Payment Links (page tarifs — redirection directe) */
app.get('/api/payment-links', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.json({
    essentiel: process.env.STRIPE_PAYMENT_LINK_ESSENTIEL || '',
    confort: process.env.STRIPE_PAYMENT_LINK_CONFORT || '',
    premium: process.env.STRIPE_PAYMENT_LINK_PREMIUM || ''
  });
});

// API Création PaymentIntent Stripe
app.post('/api/create-payment-intent', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe non configuré. Vérifiez STRIPE_SECRET_KEY dans .env' });
  }
  try {
    const { amount } = req.body;
    const amountCents = Math.round((amount || 19.90) * 100);
    if (amountCents < 50) {
      return res.status(400).json({ error: 'Montant invalide' });
    }
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true }
    });
    res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
  } catch (e) {
    console.error('Stripe create-payment-intent:', e);
    res.status(500).json({ error: e.message || 'Erreur paiement' });
  }
});

// API Mise à jour métadonnées PaymentIntent (avant confirmation)
app.post('/api/update-payment-metadata', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe non configuré' });
  }
  try {
    const { paymentIntentId, metadata } = req.body;
    if (!paymentIntentId || !metadata) {
      return res.status(400).json({ error: 'Données manquantes' });
    }
    await stripe.paymentIntents.update(paymentIntentId, {
      metadata: Object.fromEntries(
        Object.entries(metadata).map(([k, v]) => [k, String(v).slice(0, 500)])
      )
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('update-payment-metadata:', e);
    res.status(500).json({ error: e.message || 'Erreur' });
  }
});

// Page d'accueil
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export pour Vercel (serverless) ; listen uniquement en local
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Carvinguard démarré sur http://localhost:${PORT}`);
    if (!process.env.STRIPE_SECRET_KEY) {
      console.warn('⚠️  STRIPE_SECRET_KEY manquant dans .env - les paiements ne fonctionneront pas');
    }
    if (process.env.RESEND_API_KEY) {
      console.log('✓ Email (Resend) configuré →', process.env.MAIL_TO || 'infos.carvinguard@gmail.com');
    } else {
      console.warn('⚠️  RESEND_API_KEY manquant - les emails commande ne seront pas envoyés');
    }
  });
}
module.exports = app;
