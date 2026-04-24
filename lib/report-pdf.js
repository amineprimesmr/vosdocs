/**
 * Rapport VIN Carvinguard — export PDF (multipage, toutes rubriques CarAPI disponibles).
 */

const PDFDocument = require('pdfkit');
const { extractVinDecodeIdentity } = require('./carapi-client');

const COUNTRY_FR = {
  ad: 'Andorre', al: 'Albanie', at: 'Autriche', ba: 'Bosnie-Herzégovine', be: 'Belgique', bg: 'Bulgarie',
  by: 'Biélorussie', ch: 'Suisse', cy: 'Chypre', cz: 'République tchèque', de: 'Allemagne', dk: 'Danemark',
  ee: 'Estonie', es: 'Espagne', fi: 'Finlande', fr: 'France', gb: 'Royaume-Uni', gr: 'Grèce', hr: 'Croatie',
  hu: 'Hongrie', ie: 'Irlande', is: 'Islande', it: 'Italie', li: 'Liechtenstein', lt: 'Lituanie', lu: 'Luxembourg',
  lv: 'Lettonie', md: 'Moldavie', me: 'Monténégro', mk: 'Macédoine du Nord', mt: 'Malte', nl: 'Pays-Bas', no: 'Norvège',
  pl: 'Pologne', pt: 'Portugal', ro: 'Roumanie', rs: 'Serbie', se: 'Suède', si: 'Slovénie', sk: 'Slovaquie', sm: 'Saint-Marin',
  ua: 'Ukraine', va: 'Vatican', skt: 'Slovaquie'
};

const COL = {
  ink: '#0f172a',
  muted: '#64748b',
  band: '#0f2744',
  accent: '#0d9488',
  line: '#e2e8f0',
  okBg: '#ecfdf5',
  warnBg: '#fff7ed',
  errBg: '#fef2f2',
  white: '#ffffff'
};

function val(s) {
  if (s == null) return 'Non renseigné';
  const t = String(s).trim();
  if (t === '' || /^none$/i.test(t) || t === 'n/a' || t === 'N/A' || t === 'null' || t === 'undefined') {
    return 'Non renseigné';
  }
  return t;
}

function firstDefined(obj, keys) {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== '' && !/^none$/i.test(String(v)) && String(v) !== 'n/a') {
      return v;
    }
  }
  return null;
}

function frCountry(c) {
  if (c == null || c === '') return '—';
  const k = String(c).toLowerCase();
  return COUNTRY_FR[k] || String(c).toUpperCase();
}

function frFuel(v) {
  if (v == null) return 'Non renseigné';
  const s = String(v).toLowerCase().trim();
  const m = {
    petrol: 'Essence', gasoline: 'Essence', diesel: 'Diesel', electric: 'Électrique', hybrid: 'Hybride',
    'plug-in hybrid': 'Hybride rechargeable', lpg: 'GPL / GLP', cng: 'Gaz naturel (GNC)', hydrogen: 'Hydrogène',
    'flexible fuel': 'Bi-carburant (E85, etc.)', other: 'Autre', unknown: 'Non renseigné', none: 'Non renseigné'
  };
  return m[s] || val(v);
}

function frTrans(v) {
  if (v == null) return 'Non renseigné';
  const s = String(v).toLowerCase().trim();
  const m = { manual: 'Manuelle', automatic: 'Automatique', cvt: 'CVT (variateur)', 'dual-clutch': 'Double embrayage', dct: 'Double embrayage', none: 'Non renseigné' };
  return m[s] || val(v);
}

function frDrivetrain(v) {
  if (v == null) return 'Non renseigné';
  const s = String(v).toLowerCase().trim();
  const m = { fwd: 'Traction', rwd: 'Propulsion', awd: '4 roues motrices (AWD/4x4)', '4x4': '4x4', none: 'Non renseigné' };
  return m[s] || val(v);
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return String(iso);
  }
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return String(iso);
  }
}

function formatKm(n) {
  if (n == null || n === '' || (typeof n === 'number' && !isFinite(n))) return '—';
  try {
    return `${new Intl.NumberFormat('fr-FR').format(Math.round(Number(n)))} km`;
  } catch {
    return String(n) + ' km';
  }
}

function formatMoney(n, currency) {
  if (n == null || n === '' || (typeof n === 'number' && !isFinite(n))) return '—';
  const c = currency && String(currency) ? String(currency) : 'EUR';
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Number(n));
  } catch {
    return String(n) + ' ' + c;
  }
}

function needPage(doc, minSpace) {
  const bottom = doc.page.height - 56;
  if (doc.y + (minSpace || 80) > bottom) {
    doc.addPage();
  }
}

function drawCoverHeader(doc) {
  const w = doc.page.width;
  doc.save();
  doc.rect(0, 0, w, 100).fill(COL.band);
  doc.fillColor(COL.white).font('Helvetica-Bold').fontSize(22);
  doc.text('Carvinguard', 50, 32, { width: w - 100, align: 'center' });
  doc.font('Helvetica').fontSize(9.5);
  doc.fillColor('#94a3b8').text('Rapport d’analyse VIN (historique & données agrégées)', 50, 64, { width: w - 100, align: 'center' });
  doc.restore();
  doc.y = 118;
  doc.x = doc.options.margins?.left || 50;
}

function sectionTitle(doc, num, label) {
  needPage(doc, 52);
  const x = 50;
  const y = doc.y;
  doc.save();
  doc.roundedRect(x, y, 4, 18, 1).fill(COL.accent);
  doc.fillColor(COL.ink).font('Helvetica-Bold').fontSize(12.5);
  doc.text(`${num} · ${label}`, x + 12, y + 1, { width: doc.page.width - 100 - 12 });
  doc.restore();
  doc.y = y + 28;
  doc.x = 50;
}

function subMuted(doc, text) {
  doc.fillColor(COL.muted).font('Helvetica-Oblique').fontSize(8.5);
  doc.text(text, 50, doc.y, { width: doc.page.width - 100, align: 'justify' });
  doc.moveDown(0.6);
  doc.fillColor(COL.ink).font('Helvetica');
}

function rowKV(doc, label, value) {
  needPage(doc, 18);
  doc.font('Helvetica').fontSize(9.5).fillColor(COL.ink);
  doc.text(String(label) + ' : ' + val(value), 50, doc.y, { width: doc.page.width - 100, align: 'left' });
  doc.moveDown(0.2);
}

function twoColTableRow(doc, a, b) {
  needPage(doc, 20);
  const y0 = doc.y;
  doc.font('Helvetica').fontSize(8.5).fillColor(COL.ink);
  doc.text(String(a), 50, y0, { width: 250, lineGap: 1 });
  doc.text(String(b), 300, y0, { width: doc.page.width - 350, lineGap: 1 });
  doc.y = y0 + 16;
  doc.x = 50;
}

function blockPreamble(doc, block) {
  if (block == null) {
    subMuted(doc, 'Rubrique : données absentes côté fournisseur.');
    return;
  }
  if (block.skipped) {
    const r = String(block.reason || '—');
    const fr = r === 'make_model_year_unavailable'
      ? 'La cote et les annonces comparables n’ont pas pu être générées (marque / modèle / année non reconnus automatiquement).'
      : `Rubrique non générée : ${r}.`;
    subMuted(doc, fr);
    return;
  }
  if (block.error) {
    subMuted(doc, 'Erreur : ' + val(block.error));
    return;
  }
  if (block.ok === false) {
    const st = block.status != null ? ' (HTTP ' + block.status + ')' : '';
    subMuted(doc, "Réponse d'échec ou donnée indisponible" + st + ".");
  }
}

function renderDecodeSection(doc, block, bundleVin) {
  if (block == null || block.error) {
    subMuted(doc, 'Décodage : information non disponible pour ce châssis.');
    return;
  }
  if (block.ok === false) {
    subMuted(doc, 'Le décodage n’a pas pu être complété pour ce VIN.');
    return;
  }
  const b = block.data && typeof block.data === 'object' && !Array.isArray(block.data) ? block.data : {};
  const inner = b.data && typeof b.data === 'object' && !Array.isArray(b.data) ? b.data : {};
  let id = block.identity && typeof block.identity === 'object' ? block.identity : null;
  if (!id && b) {
    const extracted = extractVinDecodeIdentity(b);
    if (extracted) id = extracted;
  }
  const make = (id && id.make) || b.make;
  const model = (id && id.model) || b.model;
  const y = (id && id.year != null) ? id.year : b.year;
  const vin = b.vin != null && b.vin !== '' ? b.vin : (bundleVin || '—');
  subMuted(
    doc,
    'Fiche d’identification : caractéristiques liées au numéro de châssis selon les bases consultées. La liste d’options peut être incomplète.'
  );
  rowKV(doc, 'VIN', String(vin));
  rowKV(doc, 'Marque', make);
  rowKV(doc, 'Modèle', model);
  rowKV(doc, 'Année modèle', y);
  if (id && id.trim) rowKV(doc, 'Finition', id.trim);
  if (id && id.engine) rowKV(doc, 'Motorisation', id.engine);
  if (id && (id.fuel_type || id.fuel)) rowKV(doc, 'Carburant', frFuel(id.fuel_type || id.fuel));
  if (id && id.transmission) rowKV(doc, 'Transmission', frTrans(id.transmission));
  if (id && (id.drivetrain || id.drive_type)) {
    rowKV(doc, 'Motricité', frDrivetrain(id.drivetrain || id.drive_type));
  }
  const more = [];
  if (Object.keys(inner).length) {
    const t = firstDefined(inner, ['vehicleType', 'vehicle_type', 'type']);
    if (t) more.push({ l: 'Type', v: t });
    const bc = firstDefined(inner, ['bodyClass', 'body_class']);
    if (bc) more.push({ l: 'Carrosserie', v: bc });
    const d = firstDefined(inner, ['driveType', 'drive_type', 'drivetrain']);
    if (d) more.push({ l: 'Motricité (fiche)', v: frDrivetrain(d) });
  }
  for (const m of more) rowKV(doc, m.l, m.v);
  doc.moveDown(0.4);
}

function renderStolenSection(doc, block) {
  if (block == null) {
    subMuted(doc, 'Vérification vol : non disponible.');
    return;
  }
  if (block.skipped || block.error) {
    blockPreamble(doc, block);
    return;
  }
  const d = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
  const stolen = d.stolen === true;
  needPage(doc, 50);
  const boxTop = doc.y;
  const boxH = stolen ? 58 : 50;
  doc.save();
  doc.fillColor(stolen ? COL.errBg : COL.okBg);
  doc.roundedRect(50, boxTop, doc.page.width - 100, boxH, 4).fill();
  doc.fillColor(COL.ink).font('Helvetica-Bold').fontSize(11);
  const ty = boxTop + 10;
  doc.text(stolen ? 'Signalement de vol' : 'Aucun signalement de vol', 58, ty, { width: doc.page.width - 116 });
  doc.font('Helvetica').fontSize(8.5).fillColor(COL.muted);
  doc.text(
    stolen
      ? 'D’après les bases accessibles, ce véhicule apparaît signalé. Vérifiez auprès des autorités en cas d’achat.'
      : 'Aucun vol signalé sur les recherches couvertes. Ne remplace pas une vérification officielle auprès de la gendarmerie / police.',
    58,
    ty + 16,
    { width: doc.page.width - 116, align: 'justify' }
  );
  doc.restore();
  doc.y = boxTop + boxH + 8;
  doc.x = 50;
  const map = d.countries && typeof d.countries === 'object' && !Array.isArray(d.countries) ? d.countries : null;
  if (map) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COL.ink);
    doc.text('Détail par pays (bases interrogées) :', 50, doc.y);
    doc.moveDown(0.2);
    Object.keys(map)
      .sort()
      .forEach((k) => {
        needPage(doc, 16);
        const on = map[k] === true;
        rowKV(doc, frCountry(k), on ? 'Signalé' : 'Rien de signalé');
      });
  }
}

function renderInspectionSection(doc, block) {
  if (block == null) {
    subMuted(doc, 'Inspection (CT, émissions) : non disponible.');
    return;
  }
  if (block.skipped || block.error || block.ok === false) {
    blockPreamble(doc, block);
    return;
  }
  const d = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
  const ins = d.inspection && typeof d.inspection === 'object' ? d.inspection : {};
  const ctry = d.country;
  const stk = ins.stkValidTo;
  const ek = ins.ekValidTo;
  subMuted(
    doc,
    'Dates de contrôle périodique et d’émissions selon le territoire de référence des sources. L’absence de date n’indique pas qu’il n’y a pas eu d’examen en France ou ailleurs.'
  );
  rowKV(doc, 'Pays de référence (données affichées)', frCountry(ctry));
  rowKV(doc, 'VIN', d.vin || '—');
  rowKV(doc, 'STK (contrôle périodique) — validité', stk ? formatDate(stk) : 'Non indiqué / N/A');
  rowKV(doc, 'EK (émissions / pollution) — validité', ek ? formatDate(ek) : 'Non indiqué / N/A');
  doc.moveDown(0.3);
}

function renderMileageSection(doc, block) {
  if (block == null) {
    subMuted(doc, 'Historique kilométrique : non disponible.');
    return;
  }
  if (block.skipped || block.error) {
    blockPreamble(doc, block);
    return;
  }
  const d = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
  const list = d.mileageHistory;
  const n = d.totalRecords != null ? Number(d.totalRecords) : (Array.isArray(list) ? list.length : 0);
  if (!Array.isArray(list) || list.length === 0) {
    subMuted(doc, "Aucun relevé d’historique de kilométrage dans les sources consultées. D’autres preuves peuvent exister hors de ce rapport.");
    return;
  }
  subMuted(doc, `${n} relevé(s). Méfiez-vous des incohérences entre dates (fraude possible).`);
  needPage(doc, 40);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COL.muted);
  twoColTableRow(doc, 'Date d’enregistrement', 'Kilométrage');
  const sorted = list.slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  for (const row of sorted) {
    needPage(doc, 20);
    twoColTableRow(doc, formatDateTime(row.createdAt), formatKm(row.mileage));
  }
  doc.moveDown(0.3);
}

function renderListingsSection(doc, block) {
  if (block == null) {
    subMuted(doc, 'Annonces : non disponible.');
    return;
  }
  if (block.skipped) {
    blockPreamble(doc, block);
    return;
  }
  if (block.error || block.ok === false) {
    blockPreamble(doc, block);
    return;
  }
  const d = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
  const L = d.listings;
  if (!Array.isArray(L) || L.length === 0) {
    subMuted(doc, "Aucune annonce comparable trouvée dans l’échantillon consulté. L’offre d’occasion évolue souvent.");
    return;
  }
  subMuted(doc, `${L.length} annonce(s) (extrait) — non exhaustif, visée indicative.`);
  L.slice(0, 6).forEach((it, i) => {
    needPage(doc, 64);
    const spec = it.specifications && typeof it.specifications === 'object' ? it.specifications : {};
    const av = it.availability && typeof it.availability === 'object' ? it.availability : {};
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COL.ink);
    doc.text('Annonce ' + (i + 1) + (it.vin ? ' — VIN ' + String(it.vin) : ''), 50, doc.y);
    doc.moveDown(0.15);
    doc.font('Helvetica').fontSize(8.5);
    rowKV(doc, 'Marque / modèle', (spec.make || '—') + ' · ' + (spec.model || '—'));
    rowKV(doc, 'Carburant', frFuel(spec.fuel));
    rowKV(doc, 'Boîte', frTrans(spec.transmission));
    if (spec.registrationDate) rowKV(doc, '1ère immat. (indic.)', formatDate(spec.registrationDate));
    rowKV(
      doc,
      'Métadonnées',
      'Photos ' + (av.imagesCount != null ? av.imagesCount : '0') + ', immat. ' + (av.plateNumbersCount != null ? av.plateNumbersCount : '0')
    );
    doc.moveDown(0.3);
  });
}

function renderValuationSection(doc, block) {
  if (block == null) {
    subMuted(doc, 'Cote : non disponible.');
    return;
  }
  if (block.skipped) {
    blockPreamble(doc, block);
    return;
  }
  if (block.error || block.ok === false) {
    blockPreamble(doc, block);
    return;
  }
  const d = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
  const cur = d.currency || 'EUR';
  needPage(doc, 50);
  const valTop = doc.y;
  doc.save();
  doc.fillColor('#f0fdf4');
  doc.roundedRect(50, valTop, doc.page.width - 100, 40, 4).fill();
  doc.fillColor(COL.ink).font('Helvetica-Bold').fontSize(14);
  const yy = valTop + 8;
  doc.text(formatMoney(d.valuationPrice, cur), 58, yy, { width: doc.page.width - 116, align: 'center' });
  doc.font('Helvetica').fontSize(8).fillColor(COL.muted);
  doc.text('Estimation indicative (marché, état, km non figés dans ce seul chiffre)', 58, yy + 20, { width: doc.page.width - 116, align: 'center' });
  doc.restore();
  doc.y = valTop + 48;
  doc.x = 50;
  rowKV(doc, 'Marque', d.make);
  rowKV(doc, 'Modèle', d.model);
  rowKV(doc, 'Année', d.year);
  rowKV(doc, 'Marché de référence', frCountry(d.country));
  doc.moveDown(0.3);
}

function renderPhotosSection(doc, block) {
  if (block == null) {
    subMuted(doc, 'Photos : non disponible.');
    return;
  }
  if (block.error || (block.data && /no photos|not found/i.test(String(block.data.error || block.data.message || '')))) {
    subMuted(doc, "Aucune photo pour ce VIN dans cette analyse — situation fréquente.");
    return;
  }
  const d = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
  const photos = Array.isArray(d.photos)
    ? d.photos
    : Array.isArray(d.media)
      ? d.media
      : d.data && Array.isArray(d.data.media)
        ? d.data.media
        : [];
  if (!Array.isArray(photos) || photos.length === 0) {
    subMuted(doc, "Aucun visuel lié à ce VIN dans les sources de cette consultation.");
    return;
  }
  subMuted(doc, `${photos.length} adresse(s) d’image (ouvrez les liens dans le navigateur si besoin) :`);
  photos.slice(0, 10).forEach((u) => {
    if (!u || typeof u !== 'string') return;
    needPage(doc, 20);
    doc.font('Helvetica').fontSize(7.2).fillColor('#2563eb');
    doc.text(u, 50, doc.y, { width: doc.page.width - 100, link: u, underline: true });
    doc.moveDown(0.15);
    doc.fillColor(COL.ink);
  });
  if (photos.length > 10) {
    subMuted(doc, `… et ${photos.length - 10} autre(s) adresse(s) (tronqué dans le PDF pour la lisibilité).`);
  }
}

function renderPaymentsSection(doc, block) {
  if (block == null) {
    subMuted(doc, 'Financement (simulation) : non disponible.');
    return;
  }
  if (block.error || block.ok === false) {
    blockPreamble(doc, block);
    return;
  }
  const d = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
  const cur = d.currency || 'EUR';
  const pay = Array.isArray(d.payments) ? d.payments : [];
  if (d.monthlyPayment != null || d.loanAmount != null) {
    rowKV(doc, 'Mensualité (estim.)', formatMoney(d.monthlyPayment, cur));
    rowKV(doc, 'Montant emprunté (après apport)', formatMoney(d.loanAmount, cur));
    rowKV(doc, 'Coût total (capital + intérêts)', formatMoney(d.totalPaid, cur));
    rowKV(doc, 'Intérêts totaux (estim.)', formatMoney(d.totalInterest, cur));
  } else {
    subMuted(doc, "Les montants de simulation n’ont pas été renvoyés par le fournisseur.");
  }
  if (pay.length) {
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(9).text('Détail des échéances (aperçu) :', 50, doc.y);
    doc.moveDown(0.2);
    for (const p of pay.slice(0, 12)) {
      needPage(doc, 20);
      doc.font('Helvetica').fontSize(8);
      rowKV(doc, formatDate(p.dueDate), formatMoney(p.amount, p.currency || cur) + ' — ' + (p.frequency || '') + ' — ' + (p.type || ''));
    }
  }
  subMuted(doc, "Simulation d’exemple (TAEG, assurances, frais non inclus). Pour un crédit réel, sollicitez un organisme agréé.");
  doc.moveDown(0.2);
}

function renderPlateToVinNote(doc) {
  subMuted(
    doc,
    "Cette analyse a été faite sur la base du VIN saisi. La recherche par plaque d'immatriculation et pays peut être proposée séparément sur le service lorsqu'elle est disponible — elle n'a pas servi ici."
  );
}

function renderClientMeta(doc, meta) {
  doc.fillColor(COL.ink).font('Helvetica').fontSize(9.5);
  const nameLine = ((meta.prenom || '') + ' ' + (meta.nom || '')).trim();
  rowKV(doc, 'Titulaire', nameLine || '—');
  rowKV(doc, 'E-mail', meta.email);
  if (meta.planLabel) rowKV(doc, 'Formule / contexte', meta.planLabel);
  if (meta.montantEur) rowKV(doc, 'Montant', meta.montantEur);
  doc.moveDown(0.3);
  rowKV(doc, 'Généré le', new Date().toLocaleString('fr-FR'));
  doc.moveDown(0.8);
}

function renderDisclaimer(doc) {
  needPage(doc, 100);
  doc.fillColor(COL.muted).font('Helvetica').fontSize(7.5);
  doc.text(
    "Avertissement légal : ce document regroupe des informations fournies par des partenaires techniques et des bases accessibles via le VIN. " +
      "Il ne constitue ni un certificat d'immatriculation, ni un avis d'expert, ni une garantie d'antécédents complets. " +
      "Carvinguard ne saurait être tenu responsable d'erreurs, d'omissions ou d'évolutions de données en dehors de notre contrôle. " +
      "Pour toute transaction sur un véhicule, rapprochez-vous en plus des services officiels (préfecture, gendarmerie, historique d'entretien, expertise).",
    50,
    doc.y,
    { width: doc.page.width - 100, align: 'justify' }
  );
  doc.moveDown(0.5);
  doc.text('© Carvinguard — www.carvinguard.fr', 50, doc.y, { width: doc.page.width - 100, align: 'center' });
}

function renderSimpleVehicle(doc, vehicleData, vin) {
  const vd = vehicleData || {};
  subMuted(
    doc,
    'Rapport réduit (décodage VIN uniquement, sans bundle d’enrichissement complet). Passez par une analyse CarAPI complète pour toutes les rubriques.'
  );
  rowKV(doc, 'VIN', vin);
  rowKV(doc, 'Marque', vd.make);
  rowKV(doc, 'Modèle', vd.model);
  rowKV(doc, 'Année', vd.year);
  if (vd.trim) rowKV(doc, 'Finition', vd.trim);
  const eng = vd.engine
    ? vd.fuel_type && !String(vd.engine).toLowerCase().includes(String(vd.fuel_type).toLowerCase())
      ? String(vd.engine) + ' · ' + String(vd.fuel_type)
      : String(vd.engine)
    : val(vd.fuel_type);
  rowKV(doc, 'Motorisation / carburant', eng);
  rowKV(doc, 'Transmission / traction', vd.transmission || vd.drivetrain);
  if (vd.summary) {
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor(COL.ink);
    doc.text('Résumé : ' + val(vd.summary), 50, doc.y, { width: doc.page.width - 100, align: 'justify' });
  }
  doc.moveDown(0.5);
}

function renderFullBundle(doc, bundle, vin) {
  const b = bundle && typeof bundle === 'object' ? bundle : null;
  if (!b) {
    return;
  }
  const bVin = b.vin || vin;
  sectionTitle(doc, '1', 'Décodage VIN (fiche technique)');
  renderDecodeSection(doc, b.decode, bVin);
  needPage(doc, 40);
  sectionTitle(doc, '2', 'Vérification des véhicules volés');
  renderStolenSection(doc, b.stolenCheck);
  needPage(doc, 40);
  sectionTitle(doc, '3', 'Inspection (CT / STK, émissions EK)');
  renderInspectionSection(doc, b.inspection);
  needPage(doc, 40);
  sectionTitle(doc, '4', 'Historique du kilométrage');
  renderMileageSection(doc, b.mileageHistory);
  needPage(doc, 40);
  sectionTitle(doc, '5', 'Annonces de véhicules (marché)');
  renderListingsSection(doc, b.listings);
  needPage(doc, 40);
  sectionTitle(doc, '6', 'Évaluation (cote marché indicative)');
  renderValuationSection(doc, b.vehicleValuation);
  needPage(doc, 40);
  sectionTitle(doc, '7', 'Photos');
  renderPhotosSection(doc, b.photos);
  needPage(doc, 40);
  sectionTitle(doc, '8', 'Financement (simulation)');
  renderPaymentsSection(doc, b.payments);
  needPage(doc, 30);
  sectionTitle(doc, '9', 'Méthode d’analyse');
  renderPlateToVinNote(doc);
}

/**
 * @param {object} vehicleData - champs simples (make, model, year…)
 * @param {string} vin
 * @param {{ prenom?: string, nom?: string, email?: string, planLabel?: string, montantEur?: string }} meta
 * @param {{ fullBundle?: object, guestSnapshot?: { vehicleData?: object, decode?: object } }} [options]
 */
function generateReportPdfBuffer(vehicleData, vin, meta, options) {
  options = options || {};
  const fullBundle = options.fullBundle;
  const guestSnapshot = options.guestSnapshot;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: { Title: 'Rapport VIN Carvinguard', Author: 'Carvinguard', Subject: 'Analyse VIN' }
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    try {
      drawCoverHeader(doc);
      doc.y = 118;
      doc.fillColor(COL.ink).font('Helvetica-Bold').fontSize(16);
      doc.text('Rapport d’analyse VIN (complet)', 50, doc.y, { width: doc.page.width - 100, align: 'center' });
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(10).fillColor(COL.muted);
      doc.text('Document confidentiel — usage personnel', 50, doc.y, { width: doc.page.width - 100, align: 'center' });
      doc.moveDown(0.8);
      doc.fillColor(COL.ink);
      rowKV(doc, 'Numéro VIN (châssis)', (vin || '—').toUpperCase());
      doc.moveDown(0.2);
      renderClientMeta(doc, meta || {});

      const hasEnrichment =
        fullBundle &&
        typeof fullBundle === 'object' &&
        (fullBundle.decode != null || fullBundle.stolenCheck != null || fullBundle.inspection != null);
      if (hasEnrichment) {
        renderFullBundle(doc, fullBundle, vin);
      } else {
        if (guestSnapshot && typeof guestSnapshot === 'object' && guestSnapshot.vehicleData) {
          subMuted(
            doc,
            "Parcours invité (paiement) : ce PDF reprend le décodage VIN enregistré à la commande. Pour toutes les rubriques (vol, CT, annonces, cote, etc.), l’analyse connectée CarAPI complète (crédit) contient l’export détaillé."
          );
          renderSimpleVehicle(doc, guestSnapshot.vehicleData || vehicleData, vin);
        } else {
          renderSimpleVehicle(doc, vehicleData, vin);
        }
      }

      renderDisclaimer(doc);
    } catch (e) {
      return reject(e);
    }

    doc.end();
  });
}

module.exports = { generateReportPdfBuffer };
