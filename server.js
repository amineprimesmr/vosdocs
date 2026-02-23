/**
 * VosDocs - Serveur API
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

const app = express();
const PORT = process.env.PORT || 3000;
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

app.use(cors());
// Webhook Stripe doit recevoir le body brut AVANT express.json()
const ORDERS_FILE = path.join(__dirname, 'data', 'commandes.json');

function saveOrder(order) {
  try {
    let orders = [];
    if (fs.existsSync(ORDERS_FILE)) {
      orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    }
    orders.push(Object.assign({}, order, { date: new Date().toISOString() }));
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
    console.log('Commande enregistrée:', order.email || order.immatriculation);
  } catch (e) {
    console.error('Erreur sauvegarde commande:', e);
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

/** Envoi email à l'équipe (infos.vosdocs@gmail.com) avec le détail de la commande */
function getOrderEmailContent(order) {
  const lines = [
    'Nouvelle commande VosDocs – Paiement validé',
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
    'Immatriculation: ' + (order.immatriculation || '—'),
    'Département: ' + (order.departement || '—'),
    'Type: ' + (order.typePersonne === 'professionnel' ? 'Professionnel' : 'Particulier'),
    'Titulaire (C.1): ' + (order.titulaire || '—'),
    'Date 1ère immat. (B): ' + (order.miseCirculation || '—'),
    'Date certificat (I): ' + (order.dateCertificat || '—'),
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
  const to = process.env.MAIL_TO || 'infos.vosdocs@gmail.com';
  const subject = 'VosDocs – Nouvelle commande ' + (order.immatriculation || order.id || '');
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
    return res.status(200).send('ok');
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
    const m = pi.metadata || {};
    const order = {
      id: pi.id,
      montant: (pi.amount / 100).toFixed(2) + ' €',
      nom: m.nom || '',
      prenom: m.prenom || '',
      email: m.email || pi.receipt_email || '',
      phone: m.phone || '',
      immatriculation: m.immatriculation || '',
      departement: m.departement || '',
      titulaire: m.titulaire || '',
      typePersonne: m.typePersonne || 'particulier',
      miseCirculation: m.miseCirculation || '',
      dateCertificat: m.dateCertificat || '',
      cp: m.cp || '',
      ville: m.ville || ''
    };
    saveOrder(order);
    await notifyTeam(order);
    await sendOrderEmail(order);
  }
  res.status(200).send('ok');
});

app.use(express.json());

// --- ROUTE TEST TEMPORAIRE (à supprimer ensuite) ---
app.get('/api/email-status', (req, res) => {
  res.json({
    resendConfigured: !!process.env.RESEND_API_KEY,
    mailTo: process.env.MAIL_TO || 'infos.vosdocs@gmail.com'
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
    immatriculation: (req.body && req.body.immatriculation) || 'AB-123-CD',
    departement: (req.body && req.body.departement) || '75',
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

// Fichiers statiques : public/ (obligatoire pour Vercel, qui sert public/ via CDN)
app.use(express.static(path.join(__dirname, 'public')));

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
    console.log(`VosDocs démarré sur http://localhost:${PORT}`);
    if (!process.env.STRIPE_SECRET_KEY) {
      console.warn('⚠️  STRIPE_SECRET_KEY manquant dans .env - les paiements ne fonctionneront pas');
    }
    if (process.env.RESEND_API_KEY) {
      console.log('✓ Email (Resend) configuré →', process.env.MAIL_TO || 'infos.vosdocs@gmail.com');
    } else {
      console.warn('⚠️  RESEND_API_KEY manquant - les emails commande ne seront pas envoyés');
    }
  });
}
module.exports = app;
