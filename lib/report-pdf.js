/**
 * Rapport VIN Carvinguard — export PDF
 * Supporte deux bundles : CarAPI (legacy) et VehicleDatabases (complet).
 */

const PDFDocument = require('pdfkit');
const { extractVinDecodeIdentity } = require('./carapi-client');

// ─── Traductions pays ────────────────────────────────────────────────────────

const COUNTRY_FR = {
  ad: 'Andorre', al: 'Albanie', at: 'Autriche', ba: 'Bosnie-Herzégovine', be: 'Belgique',
  bg: 'Bulgarie', by: 'Biélorussie', ca: 'Canada', ch: 'Suisse', cy: 'Chypre',
  cz: 'République tchèque', de: 'Allemagne', dk: 'Danemark', ee: 'Estonie', es: 'Espagne',
  fi: 'Finlande', fr: 'France', gb: 'Royaume-Uni', gr: 'Grèce', hr: 'Croatie',
  hu: 'Hongrie', ie: 'Irlande', is: 'Islande', it: 'Italie', li: 'Liechtenstein',
  lt: 'Lituanie', lu: 'Luxembourg', lv: 'Lettonie', md: 'Moldavie', me: 'Monténégro',
  mk: 'Macédoine du Nord', mt: 'Malte', nl: 'Pays-Bas', no: 'Norvège', pl: 'Pologne',
  pt: 'Portugal', ro: 'Roumanie', rs: 'Serbie', se: 'Suède', si: 'Slovénie',
  sk: 'Slovaquie', sm: 'Saint-Marin', ua: 'Ukraine', us: 'États-Unis', va: 'Vatican', skt: 'Slovaquie'
};

// ─── Palette couleurs PDF ────────────────────────────────────────────────────

const COL = {
  ink: '#0f172a',
  muted: '#64748b',
  band: '#0f2744',
  accent: '#0d9488',
  line: '#e2e8f0',
  okBg: '#ecfdf5',
  warnBg: '#fff7ed',
  errBg: '#fef2f2',
  critBg: '#fef2f2',
  infoBg: '#eff6ff',
  white: '#ffffff',
  greenText: '#065f46',
  redText: '#991b1b',
  blueText: '#1e40af'
};

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function val(s) {
  if (s == null) return 'Non renseigné';
  const t = String(s).trim();
  if (t === '' || /^none$/i.test(t) || t === 'n/a' || t === 'N/A' || t === 'null' || t === 'undefined') return 'Non renseigné';
  return t;
}

function firstDefined(obj, keys) {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== '' && !/^none$/i.test(String(v)) && String(v) !== 'n/a') return v;
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
    petrol: 'Essence', gasoline: 'Essence', diesel: 'Diesel', electric: 'Électrique',
    hybrid: 'Hybride', 'plug-in hybrid': 'Hybride rechargeable', lpg: 'GPL / GLP',
    cng: 'Gaz naturel (GNC)', hydrogen: 'Hydrogène', 'flexible fuel': 'Bi-carburant (E85)',
    other: 'Autre', unknown: 'Non renseigné', none: 'Non renseigné'
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
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return String(iso); }
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch { return String(iso); }
}

function formatKm(n) {
  if (n == null || n === '' || (typeof n === 'number' && !isFinite(n))) return '—';
  try { return `${new Intl.NumberFormat('fr-FR').format(Math.round(Number(n)))} km`; }
  catch { return String(n) + ' km'; }
}

function formatMilesMi(n) {
  if (n == null || n === '') return '—';
  try { return `${new Intl.NumberFormat('fr-FR').format(Math.round(Number(n)))} mi`; }
  catch { return String(n) + ' mi'; }
}

function formatMoney(n, currency) {
  if (n == null || n === '' || (typeof n === 'number' && !isFinite(n))) return '—';
  const c = currency && String(currency) ? String(currency) : 'EUR';
  try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Number(n)); }
  catch { return String(n) + ' ' + c; }
}

/**
 * Développe une section VehicleDatabases côté PDF comme sur le dashboard —
 * block.data puis data.data ou data (objet ou tableau).
 */
function vdUnwrapSectionInner(block) {
  if (!block || block.ok === false || block.error || block.skipped) return {};
  const body = block.data;
  if (!body || typeof body !== 'object') return {};
  const inner = body.data;
  if (inner != null && typeof inner === 'object') return inner;
  return body;
}

function vdCollectMediaUrls(inner) {
  const out = { exterior: [], interior: [], colors: [] };
  if (!inner || typeof inner !== 'object') return out;
  const imgs = inner.images && typeof inner.images === 'object' ? inner.images : null;
  if (imgs) {
    ['exterior', 'interior', 'colors'].forEach((k) => {
      if (Array.isArray(imgs[k])) {
        imgs[k].forEach((p) => {
          const url = typeof p === 'string' ? p : (p && (p.url || p.src || p.image_url || p.photo_url));
          if (url && /^https?:\/\//i.test(String(url))) out[k === 'colors' ? 'colors' : k].push(String(url));
        });
      }
    });
  }
  function pushUrlsFromMixedArray(arr, bucket) {
    if (!Array.isArray(arr)) return;
    arr.forEach((p) => {
      const url = typeof p === 'string' ? p : (p && (p.url || p.src || p.image_url || p.photo_url));
      if (url && /^https?:\/\//i.test(String(url))) out[bucket].push(String(url));
    });
  }
  pushUrlsFromMixedArray(inner.exterior, 'exterior');
  pushUrlsFromMixedArray(inner.interior, 'interior');
  ['photos', 'images', 'media'].forEach((cat) => {
    pushUrlsFromMixedArray(inner[cat], 'exterior');
  });
  const colorNames = inner.exterior_colors || inner.colors;
  if (Array.isArray(colorNames) && out.colors.length === 0) {
    colorNames.slice(0, 12).forEach((c) => {
      if (typeof c === 'string' && /^https?:\/\//i.test(c)) out.colors.push(c);
      else if (c && (c.photo_url || c.url)) pushUrlsFromMixedArray([c], 'colors');
    });
  }
  return out;
}

// ─── Primitives de mise en page ───────────────────────────────────────────────

function needPage(doc, minSpace) {
  const bottom = doc.page.height - 56;
  if (doc.y + (minSpace || 80) > bottom) doc.addPage();
}

function drawCoverHeader(doc) {
  const w = doc.page.width;
  doc.save();
  doc.rect(0, 0, w, 100).fill(COL.band);
  doc.fillColor(COL.white).font('Helvetica-Bold').fontSize(22);
  doc.text('Carvinguard', 50, 32, { width: w - 100, align: 'center' });
  doc.font('Helvetica').fontSize(9.5);
  doc.fillColor('#94a3b8').text('Rapport d\'analyse VIN (historique & données agrégées)', 50, 64, { width: w - 100, align: 'center' });
  doc.restore();
  doc.y = 118;
  doc.x = doc.options.margins?.left || 50;
}

function sectionTitle(doc, num, label, emoji) {
  needPage(doc, 52);
  const x = 50;
  const y = doc.y;
  const prefix = emoji ? emoji + ' ' : '';
  doc.save();
  doc.roundedRect(x, y, 4, 18, 1).fill(COL.accent);
  doc.fillColor(COL.ink).font('Helvetica-Bold').fontSize(12.5);
  doc.text(`${num} · ${prefix}${label}`, x + 12, y + 1, { width: doc.page.width - 100 - 12 });
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

function rowKVBold(doc, label, value) {
  needPage(doc, 18);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COL.ink);
  doc.text(String(label) + ' : ', 50, doc.y, { continued: true, width: 200 });
  doc.font('Helvetica').text(val(value), { width: doc.page.width - 260 });
  doc.moveDown(0.2);
}

function twoColRow(doc, a, b, boldA) {
  needPage(doc, 20);
  const y0 = doc.y;
  doc.font(boldA ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(COL.ink);
  doc.text(String(a), 50, y0, { width: 250, lineGap: 1 });
  doc.font('Helvetica').text(String(b), 310, y0, { width: doc.page.width - 360, lineGap: 1 });
  doc.y = y0 + 16;
  doc.x = 50;
}

function threeColRow(doc, a, b, c) {
  needPage(doc, 20);
  const y0 = doc.y;
  const w = doc.page.width - 100;
  doc.font('Helvetica').fontSize(8.5).fillColor(COL.ink);
  doc.text(String(a), 50, y0, { width: w / 3, lineGap: 1 });
  doc.text(String(b), 50 + w / 3, y0, { width: w / 3, lineGap: 1 });
  doc.text(String(c), 50 + (2 * w) / 3, y0, { width: w / 3, lineGap: 1 });
  doc.y = y0 + 16;
  doc.x = 50;
}

function coloredBadge(doc, text, bgColor, textColor) {
  needPage(doc, 40);
  const boxTop = doc.y;
  const boxH = 36;
  doc.save();
  doc.fillColor(bgColor);
  doc.roundedRect(50, boxTop, doc.page.width - 100, boxH, 4).fill();
  doc.fillColor(textColor || COL.ink).font('Helvetica-Bold').fontSize(11);
  doc.text(text, 58, boxTop + 10, { width: doc.page.width - 116 });
  doc.restore();
  doc.y = boxTop + boxH + 8;
  doc.x = 50;
}

function blockPreamble(doc, block) {
  if (block == null) { subMuted(doc, 'Rubrique : données absentes côté fournisseur.'); return; }
  if (block.skipped) {
    const r = String(block.reason || '—');
    const fr = r === 'make_model_year_unavailable'
      ? 'Données non disponibles (marque / modèle / année non reconnus).'
      : `Rubrique non générée : ${r}.`;
    subMuted(doc, fr);
    return;
  }
  if (block.error) { subMuted(doc, 'Erreur : ' + val(block.error)); return; }
  if (block.ok === false) {
    const st = block.status != null ? ' (HTTP ' + block.status + ')' : '';
    subMuted(doc, 'Réponse d\'échec ou donnée indisponible' + st + '.');
  }
}

function divider(doc) {
  needPage(doc, 12);
  doc.save();
  doc.strokeColor(COL.line).lineWidth(0.5);
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
  doc.restore();
  doc.moveDown(0.4);
}

// ─── Section 1 : Identification véhicule (VehicleDatabases advanced-vin-decode) ──

/**
 * Les specs VehicleDatabases sont un tableau d'objets : [{ steering: {...} }, { engine: {...} }...]
 * Cette fonction récupère un bloc de specs par nom de catégorie.
 */
function getVdSpec(specsArrayOrObj, name) {
  if (!specsArrayOrObj) return {};
  if (Array.isArray(specsArrayOrObj)) {
    const item = specsArrayOrObj.find((s) => s && s[name] != null);
    return (item && item[name] && typeof item[name] === 'object') ? item[name] : {};
  }
  return (specsArrayOrObj[name] && typeof specsArrayOrObj[name] === 'object') ? specsArrayOrObj[name] : {};
}

function renderVdIdentification(doc, block, vin) {
  if (!block || block.ok === false || block.error) {
    blockPreamble(doc, block);
    return;
  }
  const d = (block.data && block.data.data) ? block.data.data : (block.data || {});
  subMuted(doc, 'Fiche technique complète issue du numéro de châssis (VIN). Données constructeur / homologation.');

  // Identité principale
  rowKVBold(doc, 'VIN', String(vin || d.vin || '—').toUpperCase());
  rowKV(doc, 'Marque', d.make);
  rowKV(doc, 'Modèle', d.model);
  rowKV(doc, 'Année modèle', d.year);
  rowKV(doc, 'Finition', d.trim);
  rowKV(doc, 'Carrosserie', d.style || d.body_type);
  rowKV(doc, 'Description complète', d.trim_and_style || d.summary);
  rowKV(doc, 'Classification EPA', d.epa_classification);
  rowKV(doc, 'Nombre de portes', d.doors);
  rowKV(doc, 'Type porte arrière', d.rear_door_type);

  doc.moveDown(0.3);

  // Prix constructeur
  if (d.base_msrp || d.invoice_price || d.total_price) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COL.ink);
    doc.text('Prix catalogue constructeur (MSRP — référence US)', 50, doc.y);
    doc.moveDown(0.2);
    rowKV(doc, 'MSRP de base', formatMoney(d.base_msrp, d.currency || 'USD'));
    rowKV(doc, 'Prix facture concessionnaire', formatMoney(d.invoice_price, d.currency || 'USD'));
    rowKV(doc, 'Frais de livraison', formatMoney(d.delivery_charges, d.currency || 'USD'));
    rowKV(doc, 'Prix total', formatMoney(d.total_price, d.currency || 'USD'));
    doc.moveDown(0.3);
  }

  // Specs : tableau VD (chaque entrée = { nomCategorie: { champs... } })
  const specsRaw = d.specifications;
  const engine = getVdSpec(specsRaw, 'engine');
  const fuel = getVdSpec(specsRaw, 'fuel');
  const suspension = getVdSpec(specsRaw, 'suspensions');
  const braking = getVdSpec(specsRaw, 'braking');
  const emissions = getVdSpec(specsRaw, 'emissions');
  const mpg = getVdSpec(specsRaw, 'mpg');
  const seating = getVdSpec(specsRaw, 'seating');
  const steering = getVdSpec(specsRaw, 'steering');
  const trans = (d.transmission && typeof d.transmission === 'object') ? d.transmission : {};

  if (engine.type || engine.displacement || engine.cylinders_configuration || fuel.type) {
    needPage(doc, 50);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COL.ink);
    doc.text('Motorisation', 50, doc.y);
    doc.moveDown(0.2);
    if (engine.type) rowKV(doc, 'Type moteur', engine.type);
    if (engine.cylinders_configuration) rowKV(doc, 'Cylindres', engine.cylinders_configuration);
    if (engine.displacement) {
      const displL = engine.displacement > 100 ? (engine.displacement / 1000).toFixed(1) + ' L (' + engine.displacement + ' cc)' : String(engine.displacement) + ' L';
      rowKV(doc, 'Cylindrée', displL);
    }
    if (engine.compressor && engine.compressor !== 'None' && engine.compressor !== '') rowKV(doc, 'Compresseur', engine.compressor);
    if (engine.compression) rowKV(doc, 'Taux de compression', engine.compression);
    if (engine.drivetype) rowKV(doc, 'Traction', frDrivetrain(engine.drivetype));
    if (engine.engine_location) rowKV(doc, 'Position moteur', engine.engine_location);
    if (fuel.type) rowKV(doc, 'Carburant', frFuel(fuel.type));
    if (fuel.grade) rowKV(doc, 'Grade carburant', fuel.grade);
    doc.moveDown(0.2);
  }

  if (trans.type || trans.number_of_speeds || trans.description) {
    needPage(doc, 35);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COL.ink);
    doc.text('Transmission', 50, doc.y);
    doc.moveDown(0.2);
    if (trans.type) rowKV(doc, 'Type', frTrans(trans.type));
    if (trans.number_of_speeds) rowKV(doc, 'Nombre de rapports', trans.number_of_speeds);
    if (trans.description) rowKV(doc, 'Description', trans.description);
    if (trans.final_drive_axle_ratio && trans.final_drive_axle_ratio !== '') rowKV(doc, 'Rapport pont', trans.final_drive_axle_ratio);
    doc.moveDown(0.2);
  }

  if (mpg.epa_city_economy || mpg.epa_hwy_economy || mpg.epa_combined_economy) {
    needPage(doc, 30);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COL.ink);
    doc.text('Consommation (EPA)', 50, doc.y);
    doc.moveDown(0.2);
    if (mpg.epa_city_economy) rowKV(doc, 'Ville', String(mpg.epa_city_economy) + ' mpg');
    if (mpg.epa_hwy_economy) rowKV(doc, 'Autoroute', String(mpg.epa_hwy_economy) + ' mpg');
    if (mpg.epa_combined_economy) rowKV(doc, 'Combiné', String(mpg.epa_combined_economy) + ' mpg');
    if (emissions.greenhouse_gas_score) rowKV(doc, 'Score GES', emissions.greenhouse_gas_score);
    if (emissions.smog_rating) rowKV(doc, 'Indice pollution', emissions.smog_rating);
    doc.moveDown(0.2);
  }

  if (seating.number_of_seats || seating.max_seating_capacity) {
    rowKV(doc, 'Places', seating.max_seating_capacity || seating.number_of_seats);
  }

  if (steering.type) rowKV(doc, 'Direction', steering.type);

  if (suspension.front_type || suspension.rear_type) {
    rowKV(doc, 'Suspension avant', suspension.front_type_extended || suspension.front_type);
    rowKV(doc, 'Suspension arrière', suspension.rear_type_extended || suspension.rear_type);
  }

  if (braking.type || braking.front_disc) {
    rowKV(doc, 'Freinage', braking.type);
    rowKV(doc, 'ABS', braking.primary_abs_system);
  }

  // Dimensions
  const dims = (d.dimensions && typeof d.dimensions === 'object') ? d.dimensions : {};
  const extDim = dims.exterior || {};
  if (extDim.wheelbase_inches || extDim.length_inches || extDim.width_inches || extDim.height_inches) {
    needPage(doc, 40);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COL.ink);
    doc.text('Dimensions extérieures', 50, doc.y);
    doc.moveDown(0.2);
    if (extDim.wheelbase_inches) rowKV(doc, 'Empattement', extDim.wheelbase_mm ? String(extDim.wheelbase_mm) + ' mm' : String(extDim.wheelbase_inches) + '"');
    if (extDim.length_inches) rowKV(doc, 'Longueur', extDim.length_mm ? String(extDim.length_mm) + ' mm' : String(extDim.length_inches) + '"');
    if (extDim.width_inches) rowKV(doc, 'Largeur', extDim.width_mm ? String(extDim.width_mm) + ' mm' : String(extDim.width_inches) + '"');
    if (extDim.height_inches) rowKV(doc, 'Hauteur', extDim.height_mm ? String(extDim.height_mm) + ' mm' : String(extDim.height_inches) + '"');
    doc.moveDown(0.2);
  }

  const weights = dims.weights || {};
  if (weights.curb_weight_lbs || weights.gross_weight_lbs) {
    rowKV(doc, 'Poids à vide', weights.curb_weight_kg ? String(weights.curb_weight_kg) + ' kg' : String(weights.curb_weight_lbs || '—') + ' lbs');
    rowKV(doc, 'PTAC', weights.gross_weight_kg ? String(weights.gross_weight_kg) + ' kg' : String(weights.gross_weight_lbs || '—') + ' lbs');
    doc.moveDown(0.2);
  }

  // Couleurs disponibles
  const colorsObj = d.colors || {};
  const extColors = Array.isArray(colorsObj.exterior) ? colorsObj.exterior : [];
  const intColors = Array.isArray(colorsObj.interior) ? colorsObj.interior : [];
  if (extColors.length > 0) {
    needPage(doc, 40);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COL.ink);
    doc.text('Couleurs extérieures disponibles', 50, doc.y);
    doc.moveDown(0.2);
    extColors.slice(0, 10).forEach((c) => {
      needPage(doc, 16);
      const name = c.description || c.generic_name || c.color_code || '—';
      const code = c.color_code ? ' [' + c.color_code + ']' : '';
      const price = c.color_price && c.color_price !== '0' ? ' · +' + formatMoney(c.color_price, 'USD') : '';
      doc.font('Helvetica').fontSize(8.5).fillColor(COL.ink);
      doc.text('• ' + name + code + price, 50, doc.y, { width: doc.page.width - 100 });
      doc.moveDown(0.15);
    });
    if (extColors.length > 10) subMuted(doc, '… et ' + (extColors.length - 10) + ' autre(s) couleur(s).');
    doc.moveDown(0.2);
  }

  if (intColors.length > 0) {
    needPage(doc, 30);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COL.ink);
    doc.text('Couleurs intérieures disponibles', 50, doc.y);
    doc.moveDown(0.2);
    intColors.slice(0, 8).forEach((c) => {
      needPage(doc, 16);
      doc.font('Helvetica').fontSize(8.5).fillColor(COL.ink);
      doc.text('• ' + (c.description || c.generic_name || '—'), 50, doc.y, { width: doc.page.width - 100 });
      doc.moveDown(0.15);
    });
    doc.moveDown(0.2);
  }

  doc.moveDown(0.4);
}

// ─── Section 1b : Europe VIN Decode ─────────────────────────────────────────

function renderEuropeVin(doc, block, vin) {
  if (!block || block.ok === false || block.error) {
    subMuted(doc, 'Données Europe VIN non disponibles pour ce châssis (couverture limitée à certains constructeurs EU).');
    return;
  }
  const d = (block.data && block.data.data) ? block.data.data : (block.data || {});
  if (!d || Object.keys(d).length === 0) {
    subMuted(doc, 'Aucune donnée EU complémentaire pour ce VIN.');
    return;
  }
  subMuted(doc, 'Données spécifiques aux véhicules à VIN européen (constructeurs EU 1981-2026).');

  const gen = d.general_information || d;
  if (gen.make) rowKV(doc, 'Marque (EU)', gen.make);
  if (gen.model) rowKV(doc, 'Modèle (EU)', gen.model);
  if (gen.year) rowKV(doc, 'Année (EU)', gen.year);
  if (gen.body_style || gen.body_type) rowKV(doc, 'Carrosserie', gen.body_style || gen.body_type);
  if (gen.engine_type) rowKV(doc, 'Moteur (EU)', gen.engine_type);
  if (gen.fuel_type) rowKV(doc, 'Carburant (EU)', frFuel(gen.fuel_type));
  if (gen.transmission) rowKV(doc, 'Boîte (EU)', frTrans(gen.transmission));
  if (gen.vehicle_class) rowKV(doc, 'Classe véhicule', gen.vehicle_class);
  if (gen.manufacture_country) rowKV(doc, 'Pays de fabrication', frCountry(gen.manufacture_country));

  const spec = d.vehicle_specification || {};
  if (spec.displacement) rowKV(doc, 'Cylindrée', String(spec.displacement) + ' cc');
  if (spec.horsepower || spec.hp_kw) rowKV(doc, 'Puissance', String(spec.horsepower || spec.hp_kw) + ' kW');
  if (spec.doors) rowKV(doc, 'Portes', spec.doors);
  if (spec.seats) rowKV(doc, 'Places', spec.seats);
  if (spec.driveline) rowKV(doc, 'Transmission', frDrivetrain(spec.driveline));

  const mfr = d.manufacturer_details || d.manufacturer || {};
  if (mfr.name || mfr.city || mfr.country) {
    rowKV(doc, 'Fabricant', [mfr.name, mfr.city, frCountry(mfr.country)].filter(Boolean).join(', '));
  }
  doc.moveDown(0.4);
}

// ─── Section 2 : Antivol ─────────────────────────────────────────────────────

function renderStolenCheckVd(doc, block) {
  if (block == null || block.skipped || block.error) {
    blockPreamble(doc, block);
    return;
  }
  const d = vdUnwrapSectionInner(block);

  const records = Array.isArray(d.data)
    ? d.data
    : Array.isArray(d.records)
      ? d.records
      : [];
  const legacyPossible = records.some(
    (r) => r && (r.possible_stolen === true || String(r.possible_stolen).toLowerCase() === 'true')
  );

  const flag = d.stolen;
  const posFlag =
    flag === true ||
    flag === 'true' ||
    String(flag || '').toLowerCase() === 'yes' ||
    String(flag || '').toLowerCase() === 'stolen';

  const negFlag =
    flag === false ||
    flag === 'false' ||
    String(flag || '').toLowerCase() === 'no' ||
    String(flag || '').toLowerCase() === 'not stolen';

  const risky = legacyPossible === true || posFlag === true;

  needPage(doc, 60);
  let badgeText = '⚠ Statut vol : indicateur incomplet ou ambigu dans la réponse';
  let badgeBg = COL.warnBg;
  let badgeFg = '#92400e';
  if (risky) {
    badgeText = '⚠ VÉHICULE POSSIBLEMENT SIGNALÉ COMME VOLÉ';
    badgeBg = COL.errBg;
    badgeFg = COL.redText;
  } else if (negFlag === true || flag === false || flag === 'false') {
    badgeText = '✓ Aucun signalement de vol';
    badgeBg = COL.okBg;
    badgeFg = COL.greenText;
  }
  coloredBadge(doc, badgeText, badgeBg, badgeFg);

  if (risky) {
    subMuted(doc, 'Ce véhicule apparaît dans une base de signalement de vol ou un indicateur équivalent. Vérifiez impérativement auprès de la gendarmerie ou de la police avant toute acquisition.');
  } else if (badgeBg === COL.okBg) {
    subMuted(doc, 'Selon ces sources : pas de signalisation de vol. Ne remplace pas une vérification officielle sur place.');
  } else {
    subMuted(doc, 'Réponse sans indicateur exploitable (« volé » / « pas volé ») dans cet export PDF. Une vérification en préfecture ou auprès des autorités reste indispensable pour une décision d’achat.');
  }

  if (d.countries_checked != null && String(d.countries_checked).trim() !== '')
    rowKV(doc, 'Pays vérifiés', d.countries_checked);
  if (d.source != null && String(d.source).trim() !== '')
    rowKV(doc, 'Source', d.source);
  if (d.check_date != null && String(d.check_date).trim() !== '')
    rowKV(doc, 'Date de contrôle', d.check_date);

  const map = d.countries && typeof d.countries === 'object' && !Array.isArray(d.countries) ? d.countries : null;
  if (map) {
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COL.ink);
    doc.text('Détail par pays / territoires :', 50, doc.y);
    doc.moveDown(0.2);
    Object.keys(map).sort().forEach((k) =>
      rowKV(doc, frCountry(k), map[k] === true ? 'Signalé' : 'Non signalé dans cette source'));
  }

  if (records.length > 0) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COL.ink);
    doc.text('Détail additionnel des signalements :', 50, doc.y);
    doc.moveDown(0.3);
    records.forEach((r, i) => {
      needPage(doc, 50);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COL.ink);
      doc.text('Entrée ' + (i + 1), 50, doc.y);
      doc.moveDown(0.15);
      if (r.make || r.model) rowKV(doc, 'Véhicule', [r.make, r.model].filter(Boolean).join(' '));
      if (r.plate) rowKV(doc, 'Plaque', r.plate);
      if (r.color) rowKV(doc, 'Couleur', r.color);
      if (r.location) rowKV(doc, 'Lieu', r.location);
      if (r.date) rowKV(doc, 'Date signalement', r.date);
      if (r.possible_stolen != null) rowKV(doc, 'Poss. vol déclarée', String(r.possible_stolen));
      doc.moveDown(0.2);
    });
  }
  doc.moveDown(0.4);
}

// ─── Section 3 : Valeur marché ────────────────────────────────────────────────

function renderMarketValueVd(doc, block) {
  if (!block || block.ok === false || block.error || block.skipped) {
    blockPreamble(doc, block);
    subMuted(doc, 'La cote de marché est disponible pour les véhicules US/Canada avec VIN 17 caractères.');
    return;
  }
  const d = vdUnwrapSectionInner(block);
  const basic = d.basic || {};

  let marketValueData =
    d.market_value && Array.isArray(d.market_value.market_value_data)
      ? d.market_value.market_value_data
      : [];
  if (marketValueData.length === 0 && Array.isArray(d.market_value_data)) marketValueData = d.market_value_data;

  subMuted(doc, 'Estimation de valeur par condition : Outstanding (excellent) · Clean (bon) · Average (moyen) · Rough (mauvais état). Données marché US/Canada — prix indicatifs.');

  if (basic.make || basic.model || basic.year || d.year) {
    rowKV(
      doc,
      'Véhicule',
      [basic.year || d.year, basic.make || d.make, basic.model || d.model, basic.trim || d.trim].filter(Boolean).join(' ')
    );
    if (basic.mileage) rowKV(doc, 'Kilométrage de référence', formatMilesMi(basic.mileage));
    if (basic.state) rowKV(doc, 'État de référence', basic.state);
    doc.moveDown(0.3);
  }

  if (marketValueData.length === 0) {
    const ti = firstDefined(d, ['trade_in', 'tradeIn']) || firstDefined(basic, ['trade_in', 'tradeIn']);
    const pp = firstDefined(d, ['private_party', 'privateParty']) || firstDefined(basic, ['private_party', 'privateParty']);
    const dr =
      firstDefined(d, ['dealer_retail', 'dealerRetail']) || firstDefined(basic, ['dealer_retail', 'dealerRetail']);
    if (ti || pp || dr) {
      subMuted(doc, 'Fourchette estimée synthétique (réponse courte fournie par la source pour ce VIN).');
      if (ti) rowKV(doc, 'Reprise concession', ti);
      if (pp) rowKV(doc, 'Entre particuliers', pp);
      if (dr) rowKV(doc, 'Vente concessionnaire', dr);
      doc.moveDown(0.3);
      return;
    }
    subMuted(doc, 'Cote détaillée non disponible dans les données retournées pour ce VIN (véhicule hors couverture ou données insuffisantes).');
    return;
  }

  const conditionLabels = { Outstanding: 'Excellent', Clean: 'Bon état', Average: 'Moyen', Rough: 'Mauvais' };
  const w = doc.page.width - 100;

  marketValueData.forEach((trimEntry) => {
    const trimLabel = trimEntry.trim || '';
    const condRows =
      Array.isArray(trimEntry['market value'])
        ? trimEntry['market value']
        : Array.isArray(trimEntry.market_value)
          ? trimEntry.market_value
          : [];
    if (condRows.length === 0) return;

    needPage(doc, 60);
    if (trimLabel) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COL.ink);
      doc.text('Finition : ' + trimLabel, 50, doc.y);
      doc.moveDown(0.2);
    }

    const y0 = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COL.muted);
    doc.text('Condition', 50, y0, { width: w / 4 });
    doc.text('Reprise concess.', 50 + w / 4, y0, { width: w / 4 });
    doc.text('Particulier', 50 + w / 2, y0, { width: w / 4 });
    doc.text('Concessionnaire', 50 + (3 * w) / 4, y0, { width: w / 4 });
    doc.y = y0 + 16;
    doc.x = 50;
    divider(doc);

    condRows.forEach((row) => {
      needPage(doc, 18);
      const condLabel = conditionLabels[row.Condition] || String(row.Condition || '—');
      const tradeIn = row['Trade-In'] || '—';
      const privateParty = row['Private Party'] || '—';
      const dealerRetail = row['Dealer Retail'] || '—';
      const y1 = doc.y;
      doc.font('Helvetica').fontSize(8.5).fillColor(COL.ink);
      doc.text(condLabel, 50, y1, { width: w / 4 });
      doc.text(String(tradeIn), 50 + w / 4, y1, { width: w / 4 });
      doc.text(String(privateParty), 50 + w / 2, y1, { width: w / 4 });
      doc.text(String(dealerRetail), 50 + (3 * w) / 4, y1, { width: w / 4 });
      doc.y = y1 + 16;
      doc.x = 50;
    });
    doc.moveDown(0.3);
  });

  doc.moveDown(0.3);
}

// ─── Section 4 : Rappels sécurité ────────────────────────────────────────────

function renderRecallsVd(doc, block) {
  if (!block || block.ok === false || block.error || block.skipped) {
    blockPreamble(doc, block);
    return;
  }
  const inner = vdUnwrapSectionInner(block);
  const nested = inner.data && typeof inner.data === 'object' ? inner.data : inner;
  const recalls = Array.isArray(nested.recall)
    ? nested.recall
    : Array.isArray(inner.recall)
      ? inner.recall
      : [];

  if (recalls.length === 0) {
    coloredBadge(doc, '✓ Aucun rappel sécurité enregistré', COL.okBg, COL.greenText);
    subMuted(doc, 'Aucun rappel NHTSA pour ce VIN dans les bases consultées (US/Canada). Vérifiez également sur le site officiel nhtsa.gov.');
    return;
  }

  needPage(doc, 40);
  coloredBadge(doc, `⚠ ${recalls.length} rappel(s) de sécurité enregistré(s)`, COL.warnBg, '#92400e');
  subMuted(doc, 'Ces rappels peuvent affecter la sécurité. Vérifiez qu\'ils ont été traités auprès d\'un concessionnaire agréé. Source : NHTSA.');

  recalls.forEach((r, i) => {
    needPage(doc, 80);
    doc.save();
    doc.fillColor(COL.warnBg);
    const boxTop = doc.y;
    doc.roundedRect(50, boxTop, doc.page.width - 100, 18, 2).fill();
    doc.fillColor('#92400e').font('Helvetica-Bold').fontSize(9.5);
    doc.text(`Rappel ${i + 1}${r.campaign_id ? ' — Campagne : ' + r.campaign_id : ''}`, 58, boxTop + 4, { width: doc.page.width - 116 });
    doc.restore();
    doc.y = boxTop + 22;
    doc.x = 50;

    if (r.recall_no) rowKV(doc, 'N° NHTSA', r.recall_no);
    if (r.recall_date) rowKV(doc, 'Date', formatDate(r.recall_date));
    if (r.component_affected) rowKV(doc, 'Composant concerné', r.component_affected);
    if (r.manufacturer_name) rowKV(doc, 'Fabricant', r.manufacturer_name);

    if (r.summary) {
      needPage(doc, 30);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COL.ink);
      doc.text('Description :', 50, doc.y);
      doc.moveDown(0.1);
      doc.font('Helvetica').fontSize(8.5).fillColor(COL.ink);
      doc.text(String(r.summary), 50, doc.y, { width: doc.page.width - 100, align: 'justify' });
      doc.moveDown(0.3);
    }

    if (r.consequences) {
      needPage(doc, 25);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COL.redText);
      doc.text('Risques : ', 50, doc.y, { continued: true });
      doc.font('Helvetica').fillColor(COL.ink).text(String(r.consequences), { width: doc.page.width - 100 });
      doc.moveDown(0.3);
    }

    if (r.remedy) {
      needPage(doc, 25);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COL.greenText);
      doc.text('Remède : ', 50, doc.y, { continued: true });
      doc.font('Helvetica').fillColor(COL.ink).text(String(r.remedy), { width: doc.page.width - 100 });
      doc.moveDown(0.3);
    }

    if (r.notes) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor(COL.muted);
      doc.text(String(r.notes), 50, doc.y, { width: doc.page.width - 100 });
      doc.moveDown(0.2);
    }

    doc.moveDown(0.3);
  });
}

// ─── Section 5 : Historique des ventes ───────────────────────────────────────

function renderSalesHistoryVd(doc, block) {
  if (!block || block.ok === false || block.error || block.skipped) {
    blockPreamble(doc, block);
    return;
  }
  const d = vdUnwrapSectionInner(block);
  let history =
    Array.isArray(d.sales) ? d.sales
      : Array.isArray(d.sales_history) ? d.sales_history
        : Array.isArray(d.history) ? d.history
          : Array.isArray(d) ? d : [];

  if (
    history.length === 0 &&
    d.data &&
    typeof d.data === 'object' &&
    !Array.isArray(d.data)
  ) {
    const dd = d.data;
    history =
      Array.isArray(dd.sales) ? dd.sales
        : Array.isArray(dd.sales_history) ? dd.sales_history : [];
  }

  if (history.length === 0) {
    subMuted(doc, 'Aucun historique de vente disponible pour ce VIN dans les bases consultées.');
    return;
  }

  subMuted(doc, `${history.length} entrée(s) d\'historique. Permet de retracer les passages chez des concessionnaires / annonces / enchères.`);

  if (d.make || d.model || d.year) {
    rowKV(doc, 'Véhicule (historique)', [d.year, d.make, d.model, d.trim].filter(Boolean).join(' '));
    doc.moveDown(0.2);
  }

  history.slice(0, 10).forEach((sale, i) => {
    needPage(doc, 80);
    doc.save();
    doc.fillColor(COL.infoBg);
    const bTop = doc.y;
    doc.roundedRect(50, bTop, doc.page.width - 100, 16, 2).fill();
    doc.fillColor(COL.blueText).font('Helvetica-Bold').fontSize(9);
    doc.text(
      `Entrée ${i + 1}${sale.sale_status ? ' · ' + sale.sale_status : ''}`,
      58,
      bTop + 3,
      { width: doc.page.width - 116 }
    );
    doc.restore();
    doc.y = bTop + 20;
    doc.x = 50;

    const when = sale.post_date || sale.sale_date || sale.date || sale.sold_date;
    if (when) rowKV(doc, 'Date', formatDate(when));

    if (sale.seller_type) rowKV(doc, 'Type vendeur', sale.seller_type);
    if (sale.dealer_name) rowKV(doc, 'Vendeur', sale.dealer_name);

    const city = [sale.city, sale.state, frCountry(sale.country)].filter(Boolean).join(', ');
    if (city) rowKV(doc, 'Lieu', city);

    if (sale.odometer_km != null) rowKV(doc, 'Kilométrage', formatKm(sale.odometer_km));
    else if (sale.odometer_mi != null) rowKV(doc, 'Kilométrage', formatMilesMi(sale.odometer_mi));
    else if (sale.mileage != null || sale.odometer != null) {
      rowKV(doc, 'Kilométrage', String(sale.mileage != null ? sale.mileage : sale.odometer));
    }

    if (sale.exterior_color) rowKV(doc, 'Couleur extérieure', sale.exterior_color);
    if (sale.interior_color) rowKV(doc, 'Couleur intérieure', sale.interior_color);
    if (sale.vehicle_type) rowKV(doc, 'Type véhicule', sale.vehicle_type);

    const lp = sale.listing_price;
    const rawPrice =
      lp && typeof lp === 'object' ? lp.price || lp.amount : lp != null ? sale.price || sale.listing_amount : sale.price;

    const cur =
      lp && typeof lp === 'object' ? lp.currency || 'USD'
        : sale.currency || 'USD';
    if (rawPrice !== undefined && rawPrice !== null && String(rawPrice) !== '')
      rowKV(doc, 'Prix annoncé / relevé', formatMoney(rawPrice, cur));
    else if (sale.price != null) rowKV(doc, 'Prix', String(sale.price));

    if (lp && lp.retail_value) rowKV(doc, 'Valeur de revente', formatMoney(lp.retail_value, lp.currency || 'USD'));
    if (lp && lp.repair_cost) rowKV(doc, 'Coût réparations estimé', formatMoney(lp.repair_cost, lp.currency || 'USD'));

    const imgs = Array.isArray(sale.images) ? sale.images : [];
    if (imgs.length > 0) {
      doc.font('Helvetica').fontSize(8).fillColor(COL.muted);
      doc.text(`${imgs.length} photo(s) disponible(s) pour cette ligne.`, 50, doc.y, { width: doc.page.width - 100 });
      doc.moveDown(0.2);
    }

    doc.moveDown(0.3);
  });

  if (history.length > 10)
    subMuted(doc, `… et ${history.length - 10} autre(s) entrée(s) tronquée(s) pour la lisibilité.`);
}

// ─── Section 6 : Enchères ─────────────────────────────────────────────────────

function renderAuctionVd(doc, block) {
  if (!block || block.ok === false || block.error || block.skipped) {
    blockPreamble(doc, block);
    return;
  }
  const d = vdUnwrapSectionInner(block);
  let records =
    Array.isArray(d.auctions) ? d.auctions
      : Array.isArray(d.auction_list) ? d.auction_list
        : Array.isArray(d.results) ? d.results
          : Array.isArray(d.records) ? d.records
            : Array.isArray(d.data) ? d.data
              : Array.isArray(d) ? d : [];

  if (records.length === 0) {
    subMuted(doc, 'Aucun passage en salle des ventes / enchères trouvé pour ce VIN.');
    return;
  }

  subMuted(doc, `${records.length} lot(s) d\'enchères. Indique les passages en vente aux enchères (Copart, IAAI, Manheim…).`);

  records.slice(0, 8).forEach((r, i) => {
    needPage(doc, 90);

    const isCopartShape = !!(r.vname || r['sale-date-location'] || r['technical-specs'] || r['title-and-condition']);

    let title =
      r.vname ||
      [r.year, r.make, r.model].filter(Boolean).join(' ') ||
      r.auction_title ||
      r.title ||
      ('Lot ' + (i + 1));
    if (!title || title.trim() === '') title = 'Lot ' + (i + 1);

    doc.font('Helvetica-Bold').fontSize(10).fillColor(COL.ink);
    doc.text(`Enchère ${i + 1} : ${title}`, 50, doc.y);
    doc.moveDown(0.2);

    if (isCopartShape) {
      const sd = r['sale-date-location'] || {};
      const ts = r['technical-specs'] || {};
      const tc = r['title-and-condition'] || {};
      const cf = r['car-features'] || {};

      if (sd['Auction Date']) rowKV(doc, 'Date enchère', formatDate(sd['Auction Date']));
      if (sd.Location) rowKV(doc, 'Lieu', sd.Location);
      if (sd['Seller Type']) rowKV(doc, 'Type vendeur', sd['Seller Type']);
      if (sd['Auction Type']) rowKV(doc, 'Type enchère', sd['Auction Type']);
      if (sd['Buyer Country']) rowKV(doc, 'Pays acheteur', frCountry(sd['Buyer Country']));

      if (r.price != null && r.price !== '')
        rowKV(doc, 'Prix adjugé', formatMoney(r.price, 'USD'));
      if (r.sale_status) rowKV(doc, 'Statut', r.sale_status);
      if (r['lot-number']) rowKV(doc, 'N° lot', r['lot-number']);

      if (tc['Title Type']) rowKV(doc, 'Type titre', tc['Title Type']);
      if (tc['Primary Damage']) rowKV(doc, 'Dommage principal', tc['Primary Damage']);
      if (tc['Secondary Damage']) rowKV(doc, 'Dommage secondaire', tc['Secondary Damage']);

      if (ts.Odometer) rowKV(doc, 'Compteur', String(ts.Odometer));
      if (ts['Body Style']) rowKV(doc, 'Carrosserie', ts['Body Style']);
      if (ts.Color) rowKV(doc, 'Couleur', ts.Color);
      if (ts['Engine Type']) rowKV(doc, 'Moteur', ts['Engine Type']);
      if (ts['Fuel Type']) rowKV(doc, 'Carburant', frFuel(ts['Fuel Type']));
      if (ts.Transmission) rowKV(doc, 'Boîte', frTrans(ts.Transmission));
      if (ts['Repair Cost'])
        rowKV(doc, 'Coût réparations', formatMoney(ts['Repair Cost'], 'USD'));

      const fKeys = Object.keys(cf || {});
      if (fKeys.length > 0) {
        rowKV(doc, 'Caractéristiques', fKeys.map((k) => `${k}: ${cf[k]}`).join(' · '));
      }
    } else {
      const aucDate = r.date || r.sale_date || r.auction_date;
      const loc =
        [r.location, r.city, r.state, frCountry(r.country)].filter(Boolean).join(', ') || r.venue || r.yard_location;
      if (aucDate) rowKV(doc, 'Date', formatDate(String(aucDate)));
      if (loc) rowKV(doc, 'Lieu', loc);
      if (r.buyer_country) rowKV(doc, 'Pays acheteur', frCountry(r.buyer_country));
      if (r.odometer || r.mileage) rowKV(doc, 'Kilométrage', String(r.odometer != null ? r.odometer : r.mileage));

      const finalP = r.sale_price ?? r.final_price ?? r.hammer_price ?? r.winning_bid ?? r.price;
      if (finalP != null && finalP !== '') {
        rowKV(doc, 'Prix / adjudication', String(finalP));
      }
      if (r.bid_start != null || r.starting_bid != null) {
        rowKV(doc, 'Mise à prix', String(r.bid_start != null ? r.bid_start : r.starting_bid));
      }

      const dmg =
        firstDefined(r, ['damage', 'damage_description']) ||
        firstDefined(r, ['primary_damage']);
      const titleSt = firstDefined(r, ['title_status', 'title_type']);
      if (dmg) rowKV(doc, 'Dommages', dmg);
      if (titleSt) rowKV(doc, 'Titre / statut', titleSt);
    }

    const imgs = Array.isArray(r.images) ? r.images : [];
    if (imgs.length > 0) {
      doc.font('Helvetica').fontSize(8).fillColor(COL.muted);
      doc.text(`${imgs.length} photo(s) disponible(s) (enchère).`, 50, doc.y, { width: doc.page.width - 100 });
      doc.moveDown(0.2);
    }
    doc.moveDown(0.4);
  });

  if (records.length > 8) subMuted(doc, `… et ${records.length - 8} autre(s) lot(s) non affichés.`);
}

// ─── Section 7 : Médias / Photos ──────────────────────────────────────────────

function renderMediaVd(doc, block) {
  if (!block || block.ok === false || block.error || block.skipped) {
    blockPreamble(doc, block);
    return;
  }
  const inner = vdUnwrapSectionInner(block);
  const urls = vdCollectMediaUrls(inner);
  const exterior = urls.exterior;
  const interior = urls.interior;
  const colors = urls.colors;

  let colorLabels = '';
  const colorNamesArr = inner.exterior_colors || inner.colors;
  if (Array.isArray(colorNamesArr) && colorNamesArr.length > 0) {
    const labels = [];
    colorNamesArr.slice(0, 24).forEach((c) => {
      const label = typeof c === 'object' && c ? (c.name || c.color_name || c.generic_name || c.description || '') : String(c);
      if (label && String(label).trim()) labels.push(String(label).trim());
    });
    if (labels.length) colorLabels = labels.join(', ');
  }

  const total = exterior.length + interior.length + colors.length;

  if (total === 0 && !colorLabels) {
    subMuted(doc, 'Aucune URL de photo disponible pour ce véhicule dans les données retournées (la page web peut encore afficher une palette « couleurs » descriptive sans image).');
    return;
  }

  subMuted(
    doc,
    `${total} lien(s) vers photo(s) — ${exterior.length} extérieur, ${interior.length} intérieur, ${colors.length} couleur(s)(URL directe). Cliquez depuis un lecteur PDF interactif ou copiez l’URL.`
  );

  if (colorLabels) {
    needPage(doc, 25);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COL.ink);
    doc.text('Couleurs / finitions mentionnées :', 50, doc.y);
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(8.5).fillColor(COL.ink);
    doc.text(colorLabels, 50, doc.y, { width: doc.page.width - 100, align: 'left' });
    doc.moveDown(0.35);
    doc.fillColor(COL.muted).fontSize(8);
    doc.text('Certaines palettes ne fournissent que des libellés (sans téléchargement d’images).');
    doc.moveDown(0.4);
    doc.fillColor(COL.ink);
  }

  const renderPhotoList = (label, list) => {
    if (list.length === 0) return;
    needPage(doc, 25);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COL.ink);
    doc.text(label + ' (' + list.length + ') :', 50, doc.y);
    doc.moveDown(0.2);
    list.slice(0, 8).forEach((url) => {
      const u = String(url || '').trim();
      if (!u || typeof u !== 'string') return;
      needPage(doc, 16);
      doc.font('Helvetica').fontSize(7.2).fillColor('#2563eb');
      doc.text(u, 50, doc.y, { width: doc.page.width - 100, link: u.startsWith('http') ? u : undefined, underline: true });
      doc.moveDown(0.15);
      doc.fillColor(COL.ink);
    });
    if (list.length > 8)
      subMuted(doc, `… et ${list.length - 8} autre(s) URL(s).`);
    doc.moveDown(0.2);
  };

  renderPhotoList('Extérieur', exterior);
  renderPhotoList('Intérieur', interior);
  renderPhotoList('Variantes couleur (URL)', colors);
}

// ─── Section 8 : Entretien planifié ──────────────────────────────────────────

function renderMaintenanceVd(doc, block) {
  if (!block || block.ok === false || block.error || block.skipped) {
    blockPreamble(doc, block);
    return;
  }
  const d = vdUnwrapSectionInner(block);
  const intervals =
    Array.isArray(d.maintenance_intervals) ? d.maintenance_intervals
      : Array.isArray(d.intervals) ? d.intervals
        : Array.isArray(d.schedule) ? d.schedule
          : Array.isArray(d.maintenance) ? d.maintenance
            : Array.isArray(d) ? d : [];

  if (intervals.length === 0) {
    subMuted(doc, 'Programme d\'entretien non disponible pour ce VIN (couverture limitée hors US ou données inexistantes).');
    return;
  }

  subMuted(doc, 'Plan d\'entretien selon les données constructeur disponibles depuis la source. À rapprocher des carnets d\'entretien du véhicule.');

  intervals.slice(0, 20).forEach((interval, idx) => {
    needPage(doc, 44);
    const mi = interval.mileage;
    const miNum = typeof mi === 'number' ? mi : null;
    const miKm = mi && typeof mi === 'object' && mi.km != null ? String(mi.km) + ' km' : '';
    const miMiles = mi && typeof mi === 'object' && mi.miles != null ? '(' + String(mi.miles) + ' mi)' : '';
    let label =
      [miKm || (interval.km_interval != null ? String(interval.km_interval) + ' km' : ''), miMiles].filter(Boolean).join(' ')
        || (interval.miles != null ? String(interval.miles) + ' mi' : '')
        || (interval.mileage_interval != null ? String(interval.mileage_interval) + ' mi' : '')
        || (miNum != null ? String(miNum) : '')
        || interval.action
        || ('Intervalle ' + (idx + 1));

    const mos =
      interval.month_interval != null || interval.months != null
        ? ' · tous les ' + String(interval.month_interval || interval.months) + ' mois'
        : '';

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COL.accent);
    doc.text('▸ À ' + label + mos, 50, doc.y);
    doc.moveDown(0.2);

    const servicesRaw = interval.service_items || interval.services || interval.items || [];
    const texts = [];
    const pushStr = (t) => {
      if (t != null && String(t).trim() !== '') texts.push(String(t).trim());
    };
    pushStr(interval.description);
    pushStr(interval.task);
    pushStr(interval.service);
    pushStr(interval.operation);

    if (Array.isArray(servicesRaw) && servicesRaw.length > 0) {
      servicesRaw.forEach((s) => {
        if (typeof s === 'string') pushStr(s);
        else if (s && typeof s.description === 'string') pushStr(s.description);
      });
    }

    const uniq = [...new Set(texts)];
    if (uniq.length > 0) {
      uniq.forEach((s) => {
        needPage(doc, 14);
        doc.font('Helvetica').fontSize(8.5).fillColor(COL.ink);
        doc.text('  • ' + s.slice(0, 520), 50, doc.y, { width: doc.page.width - 100 });
        doc.moveDown(0.1);
      });
    } else {
      doc.font('Helvetica').fontSize(8.5).fillColor(COL.muted);
      doc.text('  (granularité minimale depuis la source)', 50, doc.y);
      doc.moveDown(0.1);
    }
    doc.moveDown(0.3);
  });

  if (intervals.length > 20) subMuted(doc, `… et ${intervals.length - 20} autre(s) ligne(s) non affichées.`);
}

// ─── Section 9 : Garantie constructeur ───────────────────────────────────────

function renderWarrantyVd(doc, block) {
  if (!block || block.ok === false || block.error || block.skipped) {
    blockPreamble(doc, block);
    if (block && block.skipped)
      subMuted(doc, 'La garantie nécessite marque/modèle/année — non disponibles pour ce véhicule.');
    return;
  }
  const d = vdUnwrapSectionInner(block);

  let written = false;
  subMuted(
    doc,
    'Garanties constructeur selon les bases consultées. Les durées / kilométrages peuvent être expirés — contrôlez aussi le carnet ou le concessionnaire officiel.'
  );

  rowKV(doc, 'Véhicule', [d.year, d.make, d.model].filter(Boolean).join(' '));
  doc.moveDown(0.2);

  if (Array.isArray(d.warranties) && d.warranties.length > 0) {
    needPage(doc, 26);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COL.ink);
    doc.text('Détail (liste brute de la source) :', 50, doc.y);
    doc.moveDown(0.2);
    d.warranties.forEach((w) => {
      needPage(doc, 22);
      const title = String(w.type || w.name || w.warranty_type || 'Rubrique garantie').trim();
      const parts = [
        w.months != null ? String(w.months) + ' mois' : '',
        w.miles != null ? String(w.miles) + ' mi' : '',
        w.km != null ? String(w.km) + ' km' : '',
        typeof w.term === 'string' ? w.term : ''
      ].filter(Boolean);
      rowKV(doc, title, parts.join(' / ') || String(w.details || 'Non décrit'));
      written = true;
    });
    doc.moveDown(0.25);
  }

  const warranty = d.warranty && typeof d.warranty === 'object' ? d.warranty : {};
  const warrantyTypes = {
    basic: 'Garantie générale',
    powertrain: 'Groupe motopropulseur',
    corrosion: 'Anti-perforation corrosion',
    maintenance: 'Entretien inclus',
    roadside_assistance: 'Assistance routière'
  };

  Object.entries(warrantyTypes).forEach(([key, label]) => {
    const w = warranty[key];
    if (!w || typeof w !== 'object') return;
    written = true;
    needPage(doc, 20);
    const months = w.months != null ? String(w.months) + ' mois' : '';
    const miles = w.miles != null ? String(w.miles) + ' mi' : '';
    const unlimited =
      String(w.unlimited || '').toLowerCase() === 'true'
        ? 'portée illimitée (km)'
        : '';
    const detail = [months, miles, unlimited].filter(Boolean).join(' / ') || 'Non spécifiée';
    rowKV(doc, label, detail);
  });

  const flatPairs = [
    ['Garantie générale', firstDefined(d, ['basic_warranty', 'basic'])],
    ['Anti-perforation', firstDefined(d, ['corrosion_warranty', 'corrosion'])],
    ['Groupe motopropulseur', firstDefined(d, ['powertrain_warranty', 'powertrain'])],
    ['Assistance routière', firstDefined(d, ['roadside_warranty', 'roadside', 'roadside_assistance'])]
  ];
  flatPairs.forEach(([lbl, val]) => {
    if (!val || String(val).trim() === '') return;
    written = true;
    needPage(doc, 16);
    rowKV(doc, lbl, val);
  });

  if (!written) subMuted(doc, 'Données de garantie non disponibles sous une forme exploitable pour ce véhicule.');
  doc.moveDown(0.4);
}

// ─── Rendu bundle VehicleDatabases complet ────────────────────────────────────

function renderVehicleDatabasesBundle(doc, bundle, vin) {
  const b = bundle && typeof bundle === 'object' ? bundle : {};
  const bVin = b.vin || vin;

  sectionTitle(doc, '1', 'Identification du véhicule (fiche technique complète)');
  renderVdIdentification(doc, b.vinDecode, bVin);

  needPage(doc, 40);
  sectionTitle(doc, '1b', 'Données complémentaires Europe VIN');
  renderEuropeVin(doc, b.europeVin, bVin);

  needPage(doc, 40);
  sectionTitle(doc, '2', 'Vérification antivol');
  renderStolenCheckVd(doc, b.stolenCheck);

  needPage(doc, 40);
  sectionTitle(doc, '3', 'Valeur marché (cote)');
  renderMarketValueVd(doc, b.marketValue);

  needPage(doc, 40);
  sectionTitle(doc, '4', 'Rappels de sécurité');
  renderRecallsVd(doc, b.recalls);

  needPage(doc, 40);
  sectionTitle(doc, '5', 'Historique des ventes');
  renderSalesHistoryVd(doc, b.salesHistory);

  needPage(doc, 40);
  sectionTitle(doc, '6', 'Enchères (Copart, IAAI, Manheim…)');
  renderAuctionVd(doc, b.auction);

  needPage(doc, 40);
  sectionTitle(doc, '7', 'Photos du modèle');
  renderMediaVd(doc, b.media);

  needPage(doc, 40);
  sectionTitle(doc, '8', 'Programme d\'entretien constructeur');
  renderMaintenanceVd(doc, b.maintenance);

  needPage(doc, 40);
  sectionTitle(doc, '9', 'Garantie constructeur');
  renderWarrantyVd(doc, b.warranty);
}

// ─── Sections CarAPI (rétrocompatibilité) ────────────────────────────────────

function renderDecodeSection(doc, block, bundleVin) {
  if (block == null || block.error) { subMuted(doc, 'Décodage : information non disponible pour ce châssis.'); return; }
  if (block.ok === false) { subMuted(doc, 'Le décodage n\'a pas pu être complété pour ce VIN.'); return; }
  const b = block.data && typeof block.data === 'object' && !Array.isArray(block.data) ? block.data : {};
  const inner = b.data && typeof b.data === 'object' && !Array.isArray(b.data) ? b.data : {};
  let id = block.identity && typeof block.identity === 'object' ? block.identity : null;
  if (!id && b) { const extracted = extractVinDecodeIdentity(b); if (extracted) id = extracted; }
  const make = (id && id.make) || b.make;
  const model = (id && id.model) || b.model;
  const y = (id && id.year != null) ? id.year : b.year;
  const vin = b.vin != null && b.vin !== '' ? b.vin : (bundleVin || '—');
  subMuted(doc, 'Fiche d\'identification : caractéristiques liées au numéro de châssis selon les bases consultées.');
  rowKV(doc, 'VIN', String(vin));
  rowKV(doc, 'Marque', make);
  rowKV(doc, 'Modèle', model);
  rowKV(doc, 'Année modèle', y);
  if (id && id.trim) rowKV(doc, 'Finition', id.trim);
  if (id && id.engine) rowKV(doc, 'Motorisation', id.engine);
  if (id && (id.fuel_type || id.fuel)) rowKV(doc, 'Carburant', frFuel(id.fuel_type || id.fuel));
  if (id && id.transmission) rowKV(doc, 'Transmission', frTrans(id.transmission));
  if (id && (id.drivetrain || id.drive_type)) rowKV(doc, 'Motricité', frDrivetrain(id.drivetrain || id.drive_type));
  const more = [];
  if (Object.keys(inner).length) {
    const t = firstDefined(inner, ['vehicleType', 'vehicle_type', 'type']);
    if (t) more.push({ l: 'Type', v: t });
    const bc = firstDefined(inner, ['bodyClass', 'body_class']);
    if (bc) more.push({ l: 'Carrosserie', v: bc });
  }
  for (const m of more) rowKV(doc, m.l, m.v);
  doc.moveDown(0.4);
}

function renderStolenSection(doc, block) {
  if (block == null) { subMuted(doc, 'Vérification vol : non disponible.'); return; }
  if (block.skipped || block.error) { blockPreamble(doc, block); return; }
  const d = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
  const stolen = d.stolen === true;
  needPage(doc, 50);
  coloredBadge(doc, stolen ? '⚠ Signalement de vol' : '✓ Aucun signalement de vol', stolen ? COL.errBg : COL.okBg, stolen ? COL.redText : COL.greenText);
  subMuted(doc, stolen
    ? 'D\'après les bases accessibles, ce véhicule apparaît signalé. Vérifiez auprès des autorités.'
    : 'Aucun vol signalé sur les recherches couvertes.');
  const map = d.countries && typeof d.countries === 'object' && !Array.isArray(d.countries) ? d.countries : null;
  if (map) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COL.ink);
    doc.text('Détail par pays :', 50, doc.y);
    doc.moveDown(0.2);
    Object.keys(map).sort().forEach((k) => rowKV(doc, frCountry(k), map[k] === true ? 'Signalé' : 'Rien de signalé'));
  }
}

function renderInspectionSection(doc, block) {
  if (block == null) { subMuted(doc, 'Inspection (CT, émissions) : non disponible.'); return; }
  if (block.skipped || block.error || block.ok === false) { blockPreamble(doc, block); return; }
  const d = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
  const ins = d.inspection && typeof d.inspection === 'object' ? d.inspection : {};
  subMuted(doc, 'Dates de contrôle périodique et d\'émissions selon le territoire de référence des sources.');
  rowKV(doc, 'Pays de référence', frCountry(d.country));
  rowKV(doc, 'STK (contrôle périodique) — validité', ins.stkValidTo ? formatDate(ins.stkValidTo) : 'Non indiqué');
  rowKV(doc, 'EK (émissions) — validité', ins.ekValidTo ? formatDate(ins.ekValidTo) : 'Non indiqué');
  doc.moveDown(0.3);
}

function renderMileageSection(doc, block) {
  if (block == null) { subMuted(doc, 'Historique kilométrique : non disponible.'); return; }
  if (block.skipped || block.error) { blockPreamble(doc, block); return; }
  const d = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
  const list = d.mileageHistory;
  const n = d.totalRecords != null ? Number(d.totalRecords) : (Array.isArray(list) ? list.length : 0);
  if (!Array.isArray(list) || list.length === 0) { subMuted(doc, 'Aucun relevé de kilométrage dans les sources consultées.'); return; }
  subMuted(doc, `${n} relevé(s).`);
  needPage(doc, 40);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COL.muted);
  twoColRow(doc, 'Date d\'enregistrement', 'Kilométrage', true);
  const sorted = list.slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  for (const row of sorted) twoColRow(doc, formatDateTime(row.createdAt), formatKm(row.mileage));
  doc.moveDown(0.3);
}

function renderListingsSection(doc, block) {
  if (block == null || block.skipped || block.error || block.ok === false) { blockPreamble(doc, block); return; }
  const d = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
  const L = d.listings;
  if (!Array.isArray(L) || L.length === 0) { subMuted(doc, 'Aucune annonce comparable trouvée.'); return; }
  subMuted(doc, `${L.length} annonce(s) (extrait).`);
  L.slice(0, 6).forEach((it, i) => {
    needPage(doc, 64);
    const spec = it.specifications && typeof it.specifications === 'object' ? it.specifications : {};
    const av = it.availability && typeof it.availability === 'object' ? it.availability : {};
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COL.ink);
    doc.text('Annonce ' + (i + 1) + (it.vin ? ' — VIN ' + String(it.vin) : ''), 50, doc.y);
    doc.moveDown(0.15);
    rowKV(doc, 'Marque / modèle', (spec.make || '—') + ' · ' + (spec.model || '—'));
    rowKV(doc, 'Carburant', frFuel(spec.fuel));
    rowKV(doc, 'Boîte', frTrans(spec.transmission));
    if (spec.registrationDate) rowKV(doc, '1ère immat.', formatDate(spec.registrationDate));
    doc.moveDown(0.3);
  });
}

function renderValuationSection(doc, block) {
  if (block == null || block.skipped || block.error || block.ok === false) { blockPreamble(doc, block); return; }
  const d = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
  const cur = d.currency || 'EUR';
  needPage(doc, 50);
  const valTop = doc.y;
  doc.save();
  doc.fillColor('#f0fdf4');
  doc.roundedRect(50, valTop, doc.page.width - 100, 40, 4).fill();
  doc.fillColor(COL.ink).font('Helvetica-Bold').fontSize(14);
  doc.text(formatMoney(d.valuationPrice, cur), 58, valTop + 8, { width: doc.page.width - 116, align: 'center' });
  doc.font('Helvetica').fontSize(8).fillColor(COL.muted);
  doc.text('Estimation indicative', 58, valTop + 28, { width: doc.page.width - 116, align: 'center' });
  doc.restore();
  doc.y = valTop + 48;
  doc.x = 50;
  rowKV(doc, 'Marque', d.make);
  rowKV(doc, 'Modèle', d.model);
  rowKV(doc, 'Année', d.year);
  doc.moveDown(0.3);
}

function renderPhotosSection(doc, block) {
  if (block == null || block.error) { subMuted(doc, 'Aucune photo pour ce VIN.'); return; }
  const d = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
  const photos = Array.isArray(d.photos) ? d.photos : Array.isArray(d.media) ? d.media : (d.data && Array.isArray(d.data.media)) ? d.data.media : [];
  if (photos.length === 0) { subMuted(doc, 'Aucun visuel lié à ce VIN.'); return; }
  subMuted(doc, `${photos.length} adresse(s) d\'image :`);
  photos.slice(0, 10).forEach((u) => {
    if (!u || typeof u !== 'string') return;
    needPage(doc, 20);
    doc.font('Helvetica').fontSize(7.2).fillColor('#2563eb');
    doc.text(u, 50, doc.y, { width: doc.page.width - 100, link: u, underline: true });
    doc.moveDown(0.15);
    doc.fillColor(COL.ink);
  });
}

function renderPaymentsSection(doc, block) {
  if (block == null || block.error || block.ok === false) { blockPreamble(doc, block); return; }
  const d = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
  const cur = d.currency || 'EUR';
  if (d.monthlyPayment != null || d.loanAmount != null) {
    rowKV(doc, 'Mensualité (estim.)', formatMoney(d.monthlyPayment, cur));
    rowKV(doc, 'Montant emprunté', formatMoney(d.loanAmount, cur));
    rowKV(doc, 'Coût total', formatMoney(d.totalPaid, cur));
    rowKV(doc, 'Intérêts totaux', formatMoney(d.totalInterest, cur));
  } else {
    subMuted(doc, 'Montants de simulation non renvoyés par le fournisseur.');
  }
}

function renderFullBundle(doc, bundle, vin) {
  const b = bundle && typeof bundle === 'object' ? bundle : null;
  if (!b) return;
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
}

// ─── Rapport simple (fallback sans bundle) ───────────────────────────────────

function renderSimpleVehicle(doc, vehicleData, vin) {
  const vd = vehicleData || {};
  subMuted(doc, 'Rapport réduit (décodage VIN uniquement).');
  rowKV(doc, 'VIN', vin);
  rowKV(doc, 'Marque', vd.make);
  rowKV(doc, 'Modèle', vd.model);
  rowKV(doc, 'Année', vd.year);
  if (vd.trim) rowKV(doc, 'Finition', vd.trim);
  const eng = vd.engine
    ? (vd.fuel_type && !String(vd.engine).toLowerCase().includes(String(vd.fuel_type).toLowerCase())
        ? String(vd.engine) + ' · ' + String(vd.fuel_type)
        : String(vd.engine))
    : val(vd.fuel_type);
  rowKV(doc, 'Motorisation / carburant', eng);
  rowKV(doc, 'Transmission / traction', vd.transmission || vd.drivetrain);
  doc.moveDown(0.5);
}

// ─── Métadonnées client ──────────────────────────────────────────────────────

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

// ─── Disclaimer ──────────────────────────────────────────────────────────────

function renderDisclaimer(doc) {
  needPage(doc, 100);
  doc.fillColor(COL.muted).font('Helvetica').fontSize(7.5);
  doc.text(
    'Avertissement légal : ce document regroupe des informations fournies par des partenaires techniques et des bases accessibles via le VIN. ' +
    'Il ne constitue ni un certificat d\'immatriculation, ni un avis d\'expert, ni une garantie d\'antécédents complets. ' +
    'Carvinguard ne saurait être tenu responsable d\'erreurs, d\'omissions ou d\'évolutions de données en dehors de notre contrôle. ' +
    'Pour toute transaction sur un véhicule, rapprochez-vous des services officiels (préfecture, gendarmerie, historique d\'entretien, expertise).',
    50, doc.y, { width: doc.page.width - 100, align: 'justify' }
  );
  doc.moveDown(0.5);
  doc.text('© Carvinguard — www.carvinguard.fr', 50, doc.y, { width: doc.page.width - 100, align: 'center' });
}

// ─── Point d\'entrée principal ─────────────────────────────────────────────────

/**
 * @param {object} vehicleData  — champs simples (make, model, year…)
 * @param {string} vin
 * @param {{ prenom?, nom?, email?, planLabel?, montantEur? }} meta
 * @param {{ fullBundle?: object, vdBundle?: object, guestSnapshot?: object }} [options]
 */
function generateReportPdfBuffer(vehicleData, vin, meta, options) {
  options = options || {};
  const fullBundle = options.fullBundle;   // CarAPI bundle (legacy)
  const vdBundle = options.vdBundle;       // VehicleDatabases bundle (nouveau)
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
      doc.text('Rapport d\'analyse VIN (complet)', 50, doc.y, { width: doc.page.width - 100, align: 'center' });
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(10).fillColor(COL.muted);
      doc.text('Document confidentiel — usage personnel', 50, doc.y, { width: doc.page.width - 100, align: 'center' });
      doc.moveDown(0.8);
      doc.fillColor(COL.ink);
      rowKV(doc, 'Numéro VIN (châssis)', (vin || '—').toUpperCase());
      doc.moveDown(0.2);
      renderClientMeta(doc, meta || {});

      // Priorité : VehicleDatabases > CarAPI > simple
      const hasVdBundle =
        vdBundle &&
        typeof vdBundle === 'object' &&
        (vdBundle.vinDecode != null || vdBundle.stolenCheck != null || vdBundle.recalls != null);

      const hasCarApiBundle =
        fullBundle &&
        typeof fullBundle === 'object' &&
        (fullBundle.decode != null || fullBundle.stolenCheck != null || fullBundle.inspection != null);

      if (hasVdBundle) {
        renderVehicleDatabasesBundle(doc, vdBundle, vin);
      } else if (hasCarApiBundle) {
        renderFullBundle(doc, fullBundle, vin);
      } else {
        if (guestSnapshot && typeof guestSnapshot === 'object' && guestSnapshot.vehicleData) {
          subMuted(doc, 'Rapport invité : décodage VIN enregistré à la commande. Rapport complet disponible via l\'analyse connectée.');
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
