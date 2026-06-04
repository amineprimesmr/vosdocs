/**
 * Vercel serverless: POST /api/test-order-email
 * Simule une commande et envoie l'email à l'équipe via Resend.
 */
const { sendTeamOrderEmail } = require('../lib/order-emails');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Méthode non autorisée' });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(200).json({
      ok: false,
      emailSent: false,
      error:
        'RESEND_API_KEY non configurée. Vercel → Settings → Environment Variables → ajouter RESEND_API_KEY puis Redéployer.'
    });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const fakeOrder = {
    id: 'pi_test_' + Date.now(),
    montant:
      (parseInt(process.env.TIER_ESSENTIEL_CENTS || '1499', 10) / 100)
        .toFixed(2)
        .replace('.', ',') + ' €',
    nom: body.nom || 'Dupont',
    prenom: body.prenom || 'Jean',
    email: body.email || 'test@example.com',
    phone: body.phone || '06 12 34 56 78',
    vin: body.vin || 'WBADT43452G123456',
    titulaire: body.titulaire || 'DUPONT Jean',
    typePersonne: body.typePersonne || 'particulier',
    miseCirculation: body.miseCirculation || '01/01/2020',
    dateCertificat: body.dateCertificat || new Date().toLocaleDateString('fr-FR'),
    cp: body.cp || '',
    ville: body.ville || ''
  };

  const result = await sendTeamOrderEmail(fakeOrder);
  return res.status(200).json({
    ok: result.sent,
    emailSent: result.sent,
    partial: result.partial || false,
    sentTo: result.sentTo || null,
    skipped: result.skipped || null,
    error: result.error || null
  });
};
