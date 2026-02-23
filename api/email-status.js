/**
 * Vercel serverless: GET /api/email-status
 * Vérifie si la clé Resend est configurée (pour debug).
 */
module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({
    resendConfigured: !!process.env.RESEND_API_KEY,
    mailTo: process.env.MAIL_TO || 'infos.vosdocs@gmail.com'
  });
};
