/**
 * Vercel serverless: POST /api/test-order-email
 * Simule une commande et envoie l'email à l'équipe via Resend.
 */
const { Resend } = require('resend');

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

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Méthode non autorisée' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const fakeOrder = {
    id: 'pi_test_' + Date.now(),
    montant: '19,90 €',
    nom: body.nom || 'Dupont',
    prenom: body.prenom || 'Jean',
    email: body.email || 'test@example.com',
    phone: body.phone || '06 12 34 56 78',
    immatriculation: body.immatriculation || 'AB-123-CD',
    departement: body.departement || '75',
    titulaire: body.titulaire || 'DUPONT Jean',
    typePersonne: body.typePersonne || 'particulier',
    miseCirculation: body.miseCirculation || '01/01/2020',
    dateCertificat: body.dateCertificat || new Date().toLocaleDateString('fr-FR'),
    cp: body.cp || '',
    ville: body.ville || ''
  };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      emailSent: false,
      error: 'RESEND_API_KEY non configurée. Vercel → Settings → Environment Variables → ajouter RESEND_API_KEY puis Redéployer.'
    });
  }

  const to = process.env.MAIL_TO || 'infos.carvinguard@gmail.com';
  const subject = 'Carvinguard – Nouvelle commande ' + (fakeOrder.immatriculation || fakeOrder.id || '');
  const text = getOrderEmailContent(fakeOrder);

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: process.env.MAIL_FROM || 'onboarding@resend.dev',
      to,
      subject,
      text,
      replyTo: fakeOrder.email || undefined
    });
    if (error) {
      return res.status(200).json({ ok: false, emailSent: false, error: error.message || String(error) });
    }
    return res.status(200).json({ ok: true, emailSent: true });
  } catch (e) {
    return res.status(200).json({ ok: false, emailSent: false, error: e.message || String(e) });
  }
};
