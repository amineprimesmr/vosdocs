/**
 * Carvinguard - Serveur API
 * Sert les pages, départements et paiement Stripe
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const cookieParser = require('cookie-parser');
const { getPrisma } = require('./lib/prisma');
const authLib = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

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

/** Achat de crédits via Stripe (idempotent par payment_intent) */
async function handleStripeCreditPurchase(pi) {
  const m = pi.metadata || {};
  const prisma = getPrisma();
  if (!prisma) {
    console.warn('handleStripeCreditPurchase ignoré: pas de DATABASE_URL');
    return true;
  }

  // 1) Achat ponctuel de crédits (pack 5 / pack 20)
  if (m.purpose === 'credit_purchase') {
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

  // 3) Paiement one-shot via Payment Links (checkout.html) :
  // - carvinguard_plan/amount -> crédits
  // - crédit sur le compte correspondant via receipt_email (ou customer email)
  if ((m && (m.carvinguard_plan || m.app === 'carvinguard')) || pi.amount) {
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

async function notifyTeam(order) {
  const url = process.env.ORDERS_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    });
  } catch (e) {
    console.error('Erreur webhook équipe:', e);
  }
}

/** Envoi email à l'équipe (infos.carvinguard@gmail.com) avec le détail de la commande */
function getOrderEmailContent(order) {
  const lines = [
    'Nouvelle commande Carvinguard – Paiement validé',
    '-------------------------------------------',
    'Référence Stripe: ' + (order.id || '—'),
    'Montant: ' + (order.montant || '—'),
    '',
    '— Client —',
    'Nom: ' + (order.nom || '—'),
    'Prénom: ' + (order.prenom || '—'),
    'Email: ' + (order.email || '—'),
    'Téléphone: ' + (order.phone || '—'),
    '',
    '— Véhicule / démarche —',
    'VIN: ' + (order.vin || '—'),
    'Véhicule: ' + (order.vehicleDesc || '—'),
    'Type: ' + (order.typePersonne === 'professionnel' ? 'Professionnel' : 'Particulier'),
    'Titulaire (C.1): ' + (order.titulaire || '—'),
    'Date 1ère immat. (B): ' + (order.miseCirculation || '—'),
    'Date case (I) carte grise: ' + (order.dateCertificat || '—'),
    'Formule: ' + (order.planLabel || order.planId || '—'),
    'Volume rapports: ' + (order.packLabel || order.packSize || '—'),
    '',
    '— Adresse (si renseignée) —',
    'CP: ' + (order.cp || '—'),
    'Ville: ' + (order.ville || '—'),
    '',
    'Envoyé le ' + new Date().toLocaleString('fr-FR')
  ];
  return lines.join('\n');
}

/** @returns {Promise<{ sent: boolean, error?: string }>} */
async function sendOrderEmail(order) {
  const to = process.env.MAIL_TO || 'infos.carvinguard@gmail.com';
  const subject = 'Carvinguard – Nouvelle commande ' + (order.vin || order.id || '');
  const text = getOrderEmailContent(order);

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.MAIL_FROM || 'onboarding@resend.dev';
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      text,
      replyTo: order.email || undefined
    });
    if (error) {
      console.error('Erreur Resend:', error.message || error);
      return { sent: false, error: error.message || String(error) };
    }
    console.log('Email commande envoyé à', to, '(Resend)', data?.id || '');
    return { sent: true };
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn('Email non envoyé: définir RESEND_API_KEY ou SMTP_* dans .env / Vercel');
    return { sent: false, error: 'RESEND_API_KEY non configurée (Vercel → Settings → Environment Variables)' };
  }
  try {
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass }
    });
    await transporter.sendMail({
      from: process.env.MAIL_FROM || user,
      to,
      subject,
      text,
      replyTo: order.email || undefined
    });
    console.log('Email commande envoyé à', to, '(SMTP)');
    return { sent: true };
  } catch (e) {
    console.error('Erreur envoi email commande:', e);
    return { sent: false, error: e.message || String(e) };
  }
}

app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
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
    const isCreditPurchase = await handleStripeCreditPurchase(pi);
    if (!isCreditPurchase) {
      if (orderAlreadyInFile(pi.id)) {
        return res.status(200).send('ok');
      }
      const m = pi.metadata || {};
      const order = {
        id: pi.id,
        montant: (pi.amount / 100).toFixed(2) + ' €',
        nom: m.nom || '',
        prenom: m.prenom || '',
        email: m.email || pi.receipt_email || '',
        phone: m.phone || '',
        vin: m.vin || '',
        titulaire: m.titulaire || '',
        typePersonne: m.typePersonne || 'particulier',
        miseCirculation: m.miseCirculation || '',
        dateCertificat: m.dateCertificat || '',
        cp: m.cp || '',
        ville: m.ville || '',
        planId: m.planId || '',
        planLabel: m.planLabel || '',
        packSize: m.packSize || '',
        packLabel: m.packLabel || ''
      };
      saveOrder(order);
      await notifyTeam(order);
      await sendOrderEmail(order);
    }
  } else if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid') {
    const invoice = event.data.object;
    await handleSubscriptionInvoicePayment(invoice);
  }
  res.status(200).send('ok');
});

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
    const result = await sendOrderEmail(fakeOrder);
    res.json({
      ok: result.sent,
      emailSent: result.sent,
      error: result.error || null
    });
  });
}

// ---------- SaaS : comptes, crédits, achat Stripe ----------
function saaSAuthReady() {
  return !!(getPrisma() && process.env.JWT_SECRET);
}

app.get('/api/saas-config', (req, res) => {
  const prisma = getPrisma();
  const vinApi = !!process.env.VEHICLEDATABASES_API_KEY;
  const creditsPacks = [
    {
      id: 'pack_5',
      credits: 5,
      priceCents: parseInt(process.env.CREDIT_PACK_5_CENTS || '499', 10),
      label: '5 recherches VIN',
      type: 'credit_purchase'
    },
    {
      id: 'pack_20',
      credits: 20,
      priceCents: parseInt(process.env.CREDIT_PACK_20_CENTS || '1499', 10),
      label: '20 recherches VIN',
      type: 'credit_purchase'
    }
  ];

  // Abonnement mensuel "7 rapports/mois (reset)" : piloté par des variables d’env.
  // - On charge 1€ au départ (initial price)
  // - Puis on crée un abonnement mensuel avec trial de 1 jour
  // - À chaque renouvellement : on reset le compteur à 7 crédits
  if (process.env.SUBSCRIPTION_PRICE_INITIAL_ID && process.env.SUBSCRIPTION_PRICE_MONTHLY_ID) {
    const creditsPerCycle = parseInt(process.env.SUBSCRIPTION_CREDITS_PER_CYCLE || '7', 10);
    const trialDays = parseInt(process.env.SUBSCRIPTION_TRIAL_DAYS || '1', 10);
    const monthlyCentsForDisplay = parseInt(process.env.SUBSCRIPTION_MONTHLY_CENTS_FOR_DISPLAY || '4999', 10);
    const initialCentsForDisplay = parseInt(process.env.SUBSCRIPTION_INITIAL_CENTS_FOR_DISPLAY || '100', 10);

    creditsPacks.push({
      id: 'sub_monthly_7',
      type: 'subscription_initial',
      credits: creditsPerCycle,
      priceCents: initialCentsForDisplay,
      label: 'Abonnement (7 rapports/mois)',
      displayPrice: '1 € puis ' + (monthlyCentsForDisplay / 100).toFixed(2).replace('.', ',') + ' €/mois',
      subscriptionMonthlyPriceId: process.env.SUBSCRIPTION_PRICE_MONTHLY_ID,
      trialDays
    });
  }

  res.json({
    vinRequiresAccount: !!(prisma && vinApi),
    authAvailable: saaSAuthReady(),
    creditPacks: creditsPacks
  });
});

app.post('/api/auth/register', async (req, res) => {
  if (!saaSAuthReady()) {
    return res.status(503).json({
      error: 'Inscription indisponible. Configurez DATABASE_URL et JWT_SECRET.'
    });
  }
  const prisma = getPrisma();
  const email = authLib.normalizeEmail(req.body && req.body.email);
  const password = (req.body && req.body.password) || '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Adresse email invalide.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
  }
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'Cet email est déjà utilisé.' });
    }
    const passwordHash = await authLib.hashPassword(password);
    const welcome = Math.max(0, parseInt(process.env.WELCOME_CREDITS || '0', 10) || 0);
    const user = await prisma.user.create({
      data: { email, passwordHash, credits: welcome }
    });
    if (welcome > 0) {
      await prisma.creditTransaction.create({
        data: { userId: user.id, delta: welcome, reason: 'welcome_bonus' }
      });
    }
    const token = authLib.signAuthToken(user.id);
    authLib.setAuthCookie(res, token);
    return res.json({
      user: { id: user.id, email: user.email, credits: user.credits }
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

app.post('/api/auth/logout', (req, res) => {
  authLib.clearAuthCookie(res);
  res.json({ ok: true });
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
      select: { id: true, email: true, credits: true }
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
  const packId = req.body && req.body.packId;
  const packs = {
    pack_5: {
      type: 'credit_purchase',
      credits: 5,
      cents: parseInt(process.env.CREDIT_PACK_5_CENTS || '499', 10)
    },
    pack_20: {
      type: 'credit_purchase',
      credits: 20,
      cents: parseInt(process.env.CREDIT_PACK_20_CENTS || '1499', 10)
    },
    sub_monthly_7: {
      type: 'subscription_initial',
      creditsPerCycle: parseInt(process.env.SUBSCRIPTION_CREDITS_PER_CYCLE || '7', 10),
      initialPriceId: process.env.SUBSCRIPTION_PRICE_INITIAL_ID || '',
      subscriptionMonthlyPriceId: process.env.SUBSCRIPTION_PRICE_MONTHLY_ID || '',
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
        return res.status(400).json({ error: 'Abonnement non configuré (variables env manquantes).' });
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

// API VIN Decode (Vehicle Databases - proxy ; crédits si DB + clé API)
app.get('/api/vin-decode/:vin', async (req, res) => {
  const prisma = getPrisma();
  const apiKey = process.env.VEHICLEDATABASES_API_KEY;
  const vin = (req.params.vin || '').replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '').toUpperCase();
  const vinMasked = vin.slice(0, 11) + '…';

  if (vin.length !== 17) {
    return res.status(400).json({ status: 'error', message: 'VIN invalide (17 caractères requis)' });
  }

  const requireAccountForVin = !!(prisma && apiKey);
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
        await tx.creditTransaction.create({
          data: {
            userId,
            delta: -1,
            reason: 'vin_decode',
            meta: JSON.stringify({ vin: vinMasked })
          }
        });
        return { ok: true };
      });
      if (!charged.ok) {
        return res.status(402).json({
          status: 'error',
          code: 'INSUFFICIENT_CREDITS',
          message: 'Crédits insuffisants. Rechargez votre compte.',
          credits: charged.credits
        });
      }
    } catch (e) {
      console.error('Débit crédit VIN:', e);
      return res.status(500).json({ status: 'error', message: 'Erreur compte' });
    }
  }

  if (!apiKey) {
    return res.status(503).json({
      status: 'error',
      error: 'Service VIN non configuré',
      degraded: true
    });
  }

  try {
    const extRes = await fetch(
      `https://api.vehicledatabases.com/advanced-vin-decode/v2/${vin}`,
      { headers: { 'x-authkey': apiKey } }
    );
    const data = await extRes.json();
    if (!extRes.ok) {
      if (requireAccountForVin) {
        await refundVinDecodeCredit(userId, vinMasked);
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
      return res.status(400).json({
        status: 'error',
        message: data.message || 'VIN introuvable ou invalide'
      });
    }
    res.json(data);
  } catch (e) {
    console.error('VIN decode:', e.message);
    if (requireAccountForVin) {
      await refundVinDecodeCredit(userId, vinMasked);
    }
    res.status(500).json({ status: 'error', message: 'Erreur service VIN' });
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
