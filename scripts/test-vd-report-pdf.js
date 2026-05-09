#!/usr/bin/env node
/**
 * Génère un PDF de test via l’API Vehicle Databases (clé depuis env ou valeur par défaut dans lib/vin-provider.js).
 * Usage : node scripts/test-vd-report-pdf.js [VIN]
 */
require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateReportPdfBuffer } = require('../lib/report-pdf');
const { fetchVehicleDatabasesFullEnrichment } = require('../lib/vehicledatabases-client');
const { getVehicleDatabasesApiKey } = require('../lib/vin-provider');

const DEFAULT_VIN = '1HGBH41JXMN109186';

async function main() {
  const vinArg = process.argv[2] || DEFAULT_VIN;
  const vin = String(vinArg).replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '').toUpperCase();
  if (vin.length !== 17) {
    console.error('VIN invalide (17 caractères requis)');
    process.exit(1);
  }

  const apiKey = getVehicleDatabasesApiKey();
  const label = 'API Vehicle Databases';
  const vdBundle = await fetchVehicleDatabasesFullEnrichment(apiKey, { vin });

  const pdf = await generateReportPdfBuffer(
    {
      make: 'Honda',
      model: 'Accord',
      year: '2001',
      vehicleDesc: 'Test VehicleDatabases PDF'
    },
    vin,
    {
      prenom: 'Test',
      nom: 'Rapport VD',
      email: 'test@example.com',
      planLabel: label
    },
    { vdBundle }
  );

  if (!Buffer.isBuffer(pdf) || pdf.length < 2000) {
    console.error('PDF trop petit ou invalide, longueur=', pdf && pdf.length);
    process.exit(2);
  }

  const head = pdf.slice(0, 5).toString('utf8');
  if (!head.startsWith('%PDF')) {
    console.error('En-tête PDF inattendu:', head);
    process.exit(3);
  }

  const outDir = path.join(os.tmpdir(), 'carvinguard-test');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `vd-report-${vin}-${Date.now()}.pdf`);
  fs.writeFileSync(outPath, pdf);
  console.log('OK —', label);
  console.log('    Fichier :', outPath);
  console.log('    Octets :', pdf.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
