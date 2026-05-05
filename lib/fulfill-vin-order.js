/**
 * Après paiement Stripe : enregistrement commande, PDF, emails équipe + client, lien sécurisé.
 */

const crypto = require('crypto');
const { getPrisma } = require('./prisma');
const { decodeVinForReport, apiResponseToVehicleData, getVinDecodeProvider } = require('./vin-decode-core');
const { fetchVehicleDatabasesFullEnrichment } = require('./vehicledatabases-client');
const { generateReportPdfBuffer } = require('./report-pdf');
const { sendTeamOrderEmail, sendCustomerReportEmail } = require('./order-emails');

function appBaseUrl() {
  const o = String(process.env.APP_ORIGIN || '').trim().replace(/\/$/, '');
  if (o) return o;
  if (process.env.VERCEL_URL) return 'https://' + String(process.env.VERCEL_URL).replace(/^https?:\/\//, '');
  return 'http://localhost:3000';
}

function paymentIntentToOrder(pi) {
  const m = pi.metadata || {};
  return {
    id: pi.id,
    montant: (pi.amount / 100).toFixed(2).replace('.', ',') + ' €',
    nom: m.nom || '',
    prenom: m.prenom || '',
    email: (m.email || pi.receipt_email || '').trim(),
    phone: m.phone || '',
    vin: (m.vin || '').replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '').toUpperCase(),
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
}

/**
 * Flux invité « rapport VIN » après payment_intent.succeeded (hors crédits SaaS).
 * Idempotent (DB + metadata Stripe cg_fulfilled).
 */
async function fulfillGuestVinOrder(stripe, pi) {
  let m = pi.metadata || {};
  if (m.purpose === 'credit_purchase' || m.purpose === 'subscription_initial') {
    return { ok: true, skipped: true, reason: 'saas' };
  }
  if (stripe) {
    try {
      const fresh = await stripe.paymentIntents.retrieve(pi.id);
      m = fresh.metadata || m;
      pi = fresh;
    } catch (e) {
      console.warn('fulfill retrieve PI:', e.message);
    }
  }
  if (m.cg_fulfilled === '1') {
    return { ok: true, skipped: true, reason: 'stripe_meta' };
  }

  const order = paymentIntentToOrder(pi);
  if (!order.vin || order.vin.length !== 17) {
    console.warn('fulfillGuestVinOrder: VIN manquant ou invalide', pi.id);
    return { ok: false, error: 'vin_invalide' };
  }
  if (!order.email) {
    console.warn('fulfillGuestVinOrder: email manquant', pi.id);
    return { ok: false, error: 'email_manquant' };
  }

  const prisma = getPrisma();
  let row = null;
  if (prisma) {
    row = await prisma.vinOrder.findUnique({ where: { stripePaymentIntentId: pi.id } });
    if (row && row.customerEmailSentAt) {
      return { ok: true, skipped: true, reason: 'db_done' };
    }
  }

  let decodeJson = await decodeVinForReport(order.vin);
  const vehicleData = apiResponseToVehicleData(decodeJson);
  order.vehicleDesc = vehicleData.vehicleDesc || [vehicleData.year, vehicleData.make, vehicleData.model].filter(Boolean).join(' · ');

  // Enrichissement VehicleDatabases complet (vol, cote, rappels, ventes, enchères, photos, entretien, garantie)
  let vdBundle = null;
  const provider = getVinDecodeProvider();
  if (provider && provider.id === 'vehicledatabases') {
    try {
      vdBundle = await fetchVehicleDatabasesFullEnrichment(provider.apiKey, { vin: order.vin });
    } catch (e) {
      console.error('VehicleDatabases full enrichment:', e.message);
    }
  }

  const montantEur = (pi.amount / 100).toFixed(2).replace('.', ',') + ' €';
  let pdfBuffer;
  try {
    pdfBuffer = await generateReportPdfBuffer(vehicleData, order.vin, {
      prenom: order.prenom,
      nom: order.nom,
      email: order.email,
      planLabel: order.planLabel || order.planId,
      montantEur
    }, { vdBundle });
  } catch (e) {
    console.error('PDF:', e);
    return { ok: false, error: 'pdf' };
  }

  let accessToken = row && row.accessToken ? row.accessToken : crypto.randomBytes(24).toString('hex');
  const base = appBaseUrl();

  const snapshot = JSON.stringify({ decode: decodeJson, vehicleData, vdBundle: vdBundle ? true : false });

  if (prisma) {
    if (row) {
      await prisma.vinOrder.update({
        where: { stripePaymentIntentId: pi.id },
        data: {
          vehicleDataJson: snapshot,
          pdfGeneratedAt: new Date()
        }
      });
    } else {
      try {
        await prisma.vinOrder.create({
          data: {
            stripePaymentIntentId: pi.id,
            accessToken,
            email: order.email,
            nom: order.nom || null,
            prenom: order.prenom || null,
            phone: order.phone || null,
            vin: order.vin,
            vehicleDataJson: snapshot,
            planId: order.planId || null,
            planLabel: order.planLabel || null,
            amountCents: pi.amount,
            pdfGeneratedAt: new Date()
          }
        });
      } catch (e) {
        if (e.code !== 'P2002') {
          throw e;
        }
      }
    }
    const reloaded = await prisma.vinOrder.findUnique({
      where: { stripePaymentIntentId: pi.id }
    });
    if (reloaded) {
      row = reloaded;
      if (reloaded.accessToken) {
        accessToken = reloaded.accessToken;
      }
    }
  }

  const reportUrl = prisma
    ? `${base}/mon-rapport.html?token=${encodeURIComponent(accessToken)}`
    : null;

  let teamResult = { sent: false };
  if (!row || !row.teamEmailSentAt) {
    teamResult = await sendTeamOrderEmail(order);
    if (teamResult.sent) {
      const hook = process.env.ORDERS_WEBHOOK_URL;
      if (hook) {
        try {
          await fetch(hook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(order)
          });
        } catch (e) {
          console.error('ORDERS_WEBHOOK_URL:', e.message);
        }
      }
    }
    if (prisma && teamResult.sent) {
      await prisma.vinOrder.update({
        where: { stripePaymentIntentId: pi.id },
        data: { teamEmailSentAt: new Date() }
      });
    }
  } else {
    teamResult = { sent: true };
  }

  let customerResult = { sent: false };
  if (!row || !row.customerEmailSentAt) {
    customerResult = await sendCustomerReportEmail({
      to: order.email,
      prenom: order.prenom,
      reportUrl,
      pdfBuffer
    });
    if (prisma && customerResult.sent) {
      await prisma.vinOrder.update({
        where: { stripePaymentIntentId: pi.id },
        data: { customerEmailSentAt: new Date() }
      });
    }
  } else {
    customerResult = { sent: true };
  }

  if (stripe && customerResult.sent) {
    try {
      const md = pi.metadata || {};
      await stripe.paymentIntents.update(pi.id, {
        metadata: {
          ...Object.fromEntries(Object.entries(md).map(([k, v]) => [k, String(v).slice(0, 500)])),
          cg_fulfilled: '1'
        }
      });
    } catch (e) {
      console.warn('Stripe metadata update:', e.message);
    }
  }

  return {
    ok: true,
    teamEmailSent: teamResult.sent,
    customerEmailSent: customerResult.sent,
    reportUrl
  };
}

module.exports = { fulfillGuestVinOrder, paymentIntentToOrder, appBaseUrl };
