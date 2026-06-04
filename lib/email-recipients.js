/**
 * Destinataires email (équipe / marchand) : une ou plusieurs adresses.
 * MAIL_TO / MERCHANT_EMAIL acceptent une liste séparée par virgule ou point-virgule.
 */

function parseEmailRecipients(value, fallback = '') {
  const raw = String(value || fallback || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

function getTeamRecipients() {
  const fromMailTo = parseEmailRecipients(process.env.MAIL_TO);
  if (fromMailTo.length) return fromMailTo;
  return parseEmailRecipients('infos.carvinguard@gmail.com');
}

function getMerchantRecipients() {
  const fromMerchant = parseEmailRecipients(process.env.MERCHANT_EMAIL);
  if (fromMerchant.length) return fromMerchant;
  return getTeamRecipients();
}

module.exports = {
  parseEmailRecipients,
  getTeamRecipients,
  getMerchantRecipients
};
