/**
 * Envoi Resend avec repli si le domaine n’est pas encore vérifié.
 */
const TEST_FROM = 'onboarding@resend.dev';
const DEFAULT_TEST_RECIPIENT = 'amine35ennasri@gmail.com';

function isDomainOrSandboxError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('domain is not verified') ||
    msg.includes('only send testing emails') ||
    msg.includes('validation_error')
  );
}

/**
 * @param {import('resend').Resend} resend
 * @param {object} payload - from, to (string|string[]), subject, ...
 * @returns {Promise<{ sent: boolean, error?: string, partial?: boolean, sentTo?: string[], skipped?: string[] }>}
 */
async function sendResendEmail(resend, payload) {
  const from = payload.from || process.env.MAIL_FROM || TEST_FROM;
  const toList = Array.isArray(payload.to)
    ? payload.to
    : [payload.to].filter(Boolean);

  const primary = await resend.emails.send({ ...payload, from, to: toList });
  if (!primary.error) {
    return { sent: true, sentTo: toList, emailId: primary.data?.id };
  }

  if (!isDomainOrSandboxError(primary.error)) {
    return { sent: false, error: primary.error.message || String(primary.error) };
  }

  const allowed =
    process.env.RESEND_TEST_RECIPIENT || DEFAULT_TEST_RECIPIENT;
  const allowedLower = allowed.trim().toLowerCase();
  const sentTo = [];
  const skipped = [];

  for (const addr of toList) {
    const email = String(addr).trim().toLowerCase();
    if (email !== allowedLower) {
      skipped.push(email);
      continue;
    }
    const one = await resend.emails.send({
      ...payload,
      from: TEST_FROM,
      to: [email]
    });
    if (one.error) {
      return {
        sent: false,
        error: one.error.message || String(one.error),
        partial: sentTo.length > 0,
        sentTo,
        skipped
      };
    }
    sentTo.push(email);
  }

  if (sentTo.length) {
    return {
      sent: true,
      partial: skipped.length > 0,
      sentTo,
      skipped,
      emailId: undefined,
      error: skipped.length
        ? 'Domaine non vérifié : certains destinataires ignorés (ajoutez les DNS Resend sur Hostinger).'
        : undefined
    };
  }

  return {
    sent: false,
    error:
      primary.error.message ||
      'Domaine carvinguard.fr non vérifié sur Resend — configurez les DNS (Hostinger).',
    skipped: toList
  };
}

module.exports = { sendResendEmail, isDomainOrSandboxError };
