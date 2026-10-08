/**
 * Vercel serverless: GET /api/email-status
 * Vérifie si la clé Resend est configurée (pour debug).
 */
const { getTeamRecipients } = require('../lib/email-recipients');

module.exports = (req, res) => {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') return res.status(404).end();
  res.setHeader('Content-Type', 'application/json');
  const recipients = getTeamRecipients();
  res.status(200).json({
    resendConfigured: !!process.env.RESEND_API_KEY,
    mailFrom: process.env.MAIL_FROM || 'onboarding@resend.dev',
    mailTo: recipients.length ? recipients : ['contact@carvinguard.fr']
  });
};
