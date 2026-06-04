/**
 * Emails commande rapport VIN — équipe + client (PDF).
 */

const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const { getTeamRecipients } = require('./email-recipients');
const { sendResendEmail } = require('./resend-send');

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
async function sendTeamOrderEmail(order) {
  const to = getTeamRecipients();
  if (!to.length) {
    console.warn('Email équipe non envoyé: MAIL_TO vide ou invalide');
    return { sent: false, error: 'MAIL_TO non configuré' };
  }
  const subject = 'Carvinguard – Nouvelle commande ' + (order.vin || order.id || '');
  const text = getOrderEmailContent(order);

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.MAIL_FROM || 'onboarding@resend.dev';
    const result = await sendResendEmail(resend, {
      from,
      to,
      subject,
      text,
      replyTo: order.email || undefined
    });
    if (!result.sent) {
      console.error('Erreur Resend (équipe):', result.error, result.skipped || '');
      return { sent: false, error: result.error };
    }
    if (result.partial) {
      console.warn('Resend (équipe) partiel:', result.sentTo, 'ignorés:', result.skipped);
    }
    return { sent: true, partial: result.partial, sentTo: result.sentTo, skipped: result.skipped };
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn('Email équipe non envoyé: RESEND_API_KEY ou SMTP_* manquant');
    return { sent: false, error: 'Email non configuré' };
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
    return { sent: true };
  } catch (e) {
    console.error('Erreur SMTP équipe:', e);
    return { sent: false, error: e.message || String(e) };
  }
}

function customerEmailHtml(prenom, reportUrl) {
  const name = prenom ? ` ${escapeHtml(prenom)}` : '';
  const linkBlock = reportUrl
    ? `<p>Vous trouverez en pièce jointe votre <strong>rapport VIN</strong> au format PDF. Vous pouvez aussi consulter votre rapport en ligne :</p>
  <p style="margin:24px 0;"><a href="${escapeHtml(reportUrl)}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">Voir mon rapport en ligne</a></p>
  <p style="font-size:14px;color:#64748b;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><span style="word-break:break-all;">${escapeHtml(reportUrl)}</span></p>`
    : `<p>Vous trouverez en pièce jointe votre <strong>rapport VIN</strong> au format PDF.</p>
  <p style="font-size:14px;color:#64748b;">Conservez ce document : la consultation en ligne nécessite une base de données configurée sur le serveur.</p>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a;max-width:560px;margin:0 auto;padding:24px;">
  <p>Bonjour${name},</p>
  <p>Merci pour votre commande sur <strong>Carvinguard</strong>. Votre paiement est bien enregistré.</p>
  ${linkBlock}
  <p style="font-size:14px;color:#64748b;">Pour toute question : <a href="mailto:contact@carvinguard.fr">contact@carvinguard.fr</a></p>
  <p>L’équipe Carvinguard</p>
</body></html>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
async function sendCustomerReportEmail({ to, prenom, reportUrl, pdfBuffer, vinLast4 }) {
  const subject = 'Votre rapport VIN Carvinguard — PDF joint';
  const html = customerEmailHtml(prenom, reportUrl);

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.MAIL_FROM || 'onboarding@resend.dev';
    const payload = {
      from,
      to: [to],
      subject,
      html,
      attachments: [
        {
          filename: 'rapport-vin-carvinguard.pdf',
          content: pdfBuffer
        }
      ]
    };
    const { error } = await resend.emails.send(payload);
    if (error) {
      console.error('Erreur Resend (client):', error.message || error);
      return { sent: false, error: error.message || String(error) };
    }
    return { sent: true };
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    return { sent: false, error: 'RESEND_API_KEY ou SMTP requis pour l’email client' };
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
      html,
      attachments: [
        {
          filename: 'rapport-vin-carvinguard.pdf',
          content: pdfBuffer
        }
      ]
    });
    return { sent: true };
  } catch (e) {
    console.error('Erreur SMTP client:', e);
    return { sent: false, error: e.message || String(e) };
  }
}

function walletBaseUrl(baseUrl) {
  const u = String(baseUrl || process.env.APP_ORIGIN || process.env.BASE_URL || '').trim().replace(/\/$/, '');
  return u || 'https://www.carvinguard.fr';
}

/**
 * Nouveau compte après paiement (sans connexion préalable).
 * @param {{ to: string, inviteToken: string, baseUrl?: string, credits: number }} opts
 */
async function sendAccountInviteEmail(opts) {
  const to = opts.to;
  const credits = opts.credits;
  const base = walletBaseUrl(opts.baseUrl);
  const link = base + '/compte.html?invite=' + encodeURIComponent(opts.inviteToken);
  const subject = 'Carvinguard — activez votre espace client (crédits VIN)';
  const text = [
    'Bonjour,',
    '',
    'Votre paiement est bien enregistré. Votre compte Carvinguard a été créé avec ' +
      credits +
      ' crédit(s) VIN.',
    '',
    'Pour choisir votre mot de passe et accéder à votre espace :',
    link,
    '',
    'Ce lien est valable 7 jours.',
    '',
    '— L’équipe Carvinguard'
  ].join('\n');

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.MAIL_FROM || 'onboarding@resend.dev';
    const { error } = await resend.emails.send({ from, to, subject, text });
    if (error) {
      console.error('Resend invite wallet:', error.message || error);
      return { sent: false, error: error.message || String(error) };
    }
    return { sent: true };
  }
  console.warn('sendAccountInviteEmail: RESEND_API_KEY manquant');
  return { sent: false, error: 'Email non configuré' };
}

/**
 * Compte existant : crédits ajoutés après achat sans session.
 */
async function sendWalletCreditsEmail(opts) {
  const to = opts.to;
  const credits = opts.credits;
  const base = walletBaseUrl(opts.baseUrl);
  const subject = 'Carvinguard — crédits ajoutés à votre compte';
  const text = [
    'Bonjour,',
    '',
    'Votre paiement est enregistré : ' +
      credits +
      ' crédit(s) VIN ont été ajoutés sur votre compte.',
    '',
    'Connectez-vous : ' + base + '/compte.html',
    '',
    '— L’équipe Carvinguard'
  ].join('\n');

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.MAIL_FROM || 'onboarding@resend.dev';
    const { error } = await resend.emails.send({ from, to, subject, text });
    if (error) {
      console.error('Resend wallet credits:', error.message || error);
      return { sent: false, error: error.message || String(error) };
    }
    return { sent: true };
  }
  console.warn('sendWalletCreditsEmail: RESEND_API_KEY manquant');
  return { sent: false, error: 'Email non configuré' };
}

module.exports = {
  getOrderEmailContent,
  sendTeamOrderEmail,
  sendCustomerReportEmail,
  sendAccountInviteEmail,
  sendWalletCreditsEmail
};
