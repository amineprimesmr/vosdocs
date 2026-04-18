/**
 * Génère un PDF « rapport VIN » (Buffer) à partir des données véhicule.
 */

const PDFDocument = require('pdfkit');

function esc(s) {
  if (s == null || s === '') return '—';
  return String(s);
}

/**
 * @param {object} vehicleData - format front (make, model, year, …)
 * @param {string} vin
 * @param {{ prenom?: string, nom?: string, email?: string, planLabel?: string, montantEur?: string }} meta
 * @returns {Promise<Buffer>}
 */
function generateReportPdfBuffer(vehicleData, vin, meta) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Rapport VIN Carvinguard' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const vd = vehicleData || {};
    const title = 'Rapport historique véhicule (VIN)';
    const subtitle = 'Carvinguard — document généré automatiquement';

    doc.fontSize(20).fillColor('#0f172a').text(title, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#64748b').text(subtitle, { align: 'center' });
    doc.moveDown(1.2);

    doc.fontSize(9).fillColor('#64748b').text('Date du document : ' + new Date().toLocaleString('fr-FR'), {
      align: 'right'
    });
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#0f172a').text('Titulaire de la commande', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#334155');
    const nameLine = ((meta.prenom || '') + ' ' + (meta.nom || '')).trim();
    doc.text('Nom : ' + (nameLine ? esc(nameLine) : '—'));
    doc.text('Email : ' + esc(meta.email));
    if (meta.planLabel) doc.text('Formule : ' + esc(meta.planLabel));
    if (meta.montantEur) doc.text('Montant payé : ' + esc(meta.montantEur));
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#0f172a').text('Identification véhicule', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#334155');
    doc.text('VIN : ' + esc(vin));
    doc.moveDown(0.6);

    doc.fontSize(12).fillColor('#0f172a').text('Synthèse constructeur', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#334155');
    doc.text('Marque : ' + esc(vd.make));
    doc.text('Modèle : ' + esc(vd.model));
    doc.text('Année modèle : ' + esc(vd.year));
    if (vd.trim) doc.text('Finition / carrosserie : ' + esc(vd.trim));

    let eng = vd.engine || '';
    if (vd.fuel_type && eng.indexOf(String(vd.fuel_type)) === -1) {
      eng = eng ? eng + ' · ' + vd.fuel_type : String(vd.fuel_type);
    }
    doc.text('Motorisation : ' + esc(eng));
    doc.text('Transmission / traction : ' + esc(vd.transmission || vd.drivetrain || ''));
    doc.moveDown(0.5);

    doc.fontSize(10).fillColor('#475569');
    const sum = vd.summary || '';
    doc.text(sum ? 'Résumé : ' + esc(sum) : 'Résumé : —', { width: doc.page.width - 96, align: 'left' });

    doc.moveDown(1.2);
    doc.fontSize(8).fillColor('#94a3b8');
    doc.text(
      "Ce document est une synthèse d'informations issues de sources disponibles à partir du numéro VIN. " +
        "Il ne remplace pas un certificat d'immatriculation, un dossier administratif officiel ni une expertise. " +
        'Carvinguard ne garantit pas l’exhaustivité des données historiques.',
      { width: doc.page.width - 96, align: 'justify' }
    );

    doc.end();
  });
}

module.exports = { generateReportPdfBuffer };
