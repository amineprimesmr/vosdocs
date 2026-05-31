#!/usr/bin/env node
/**
 * Génère un PDF de démonstration avec un bundle VehicleDatabases simulé
 * pour valider le design (synthèse, feux vert/orange/rouge) sans appel API.
 * Usage : node scripts/test-pdf-mock.js [scenario]
 *   scenario = clean | risky   (défaut: risky pour montrer toutes les couleurs)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateReportPdfBuffer } = require('../lib/report-pdf');

const scenario = process.argv[2] || 'risky';
const risky = scenario === 'risky';

const vdBundle = {
  vin: '1HGBH41JXMN109186',
  vinDecode: {
    ok: true,
    data: {
      data: {
        vin: '1HGBH41JXMN109186',
        make: 'Honda', model: 'Accord', year: '2018', trim: 'Sport', style: 'Berline 4 portes',
        doors: 4,
        specifications: [
          { engine: { type: 'L4', cylinders_configuration: 'In-Line', displacement: 1500, drivetype: 'fwd' } },
          { fuel: { type: 'petrol', grade: 'Regular' } },
          { mpg: { epa_city_economy: 30, epa_hwy_economy: 38, epa_combined_economy: 33 } }
        ],
        transmission: { type: 'automatic', number_of_speeds: 'CVT' },
        colors: { exterior: [{ description: 'Modern Steel Metallic', color_code: 'NH-797M' }] }
      }
    }
  },
  stolenCheck: {
    ok: true,
    data: { data: risky ? { stolen: true, source: 'Interpol', check_date: '2026-01-10' } : { stolen: false, source: 'Interpol', check_date: '2026-01-10' } }
  },
  recalls: {
    ok: true,
    data: {
      data: {
        recall: risky ? [
          { recall_no: '21V-123', campaign_id: 'NHTSA-21V123', recall_date: '2021-03-12', component_affected: 'Airbag', summary: 'Le module airbag conducteur peut se déployer de manière incorrecte.', consequences: 'Risque de blessure en cas d\'accident.', remedy: 'Remplacement gratuit du module en concession.' }
        ] : []
      }
    }
  },
  salesHistory: {
    ok: true,
    data: {
      data: {
        make: 'Honda', model: 'Accord', year: '2018',
        sales: [
          { sale_date: '2020-06-15', seller_type: 'Dealer', dealer_name: 'AutoMax', city: 'Lyon', country: 'fr', odometer_km: 45000, listing_price: { price: 18500, currency: 'EUR' } },
          { sale_date: '2023-09-02', seller_type: 'Private', city: 'Paris', country: 'fr', odometer_km: 92000, listing_price: { price: 13900, currency: 'EUR' } }
        ]
      }
    }
  },
  auction: {
    ok: true,
    data: {
      data: {
        auctions: risky ? [
          { vname: '2018 Honda Accord Sport', 'sale-date-location': { 'Auction Date': '2022-04-01', Location: 'Copart Dallas' }, price: 8200, 'title-and-condition': { 'Title Type': 'Salvage', 'Primary Damage': 'Front End' }, 'technical-specs': { Odometer: '78000 mi' } }
        ] : []
      }
    }
  },
  marketValue: {
    ok: true,
    data: {
      data: {
        basic: { make: 'Honda', model: 'Accord', year: '2018', mileage: 60000, state: 'CA' },
        market_value: { market_value_data: [ { trim: 'Sport', 'market value': [ { Condition: 'Clean', 'Trade-In': '$14,200', 'Private Party': '$15,800', 'Dealer Retail': '$17,500' }, { Condition: 'Average', 'Trade-In': '$12,900', 'Private Party': '$14,100', 'Dealer Retail': '$15,900' } ] } ] }
      }
    }
  }
};

(async () => {
  const pdf = await generateReportPdfBuffer(
    { make: 'Honda', model: 'Accord', year: '2018' },
    vdBundle.vin,
    { prenom: 'Jean', nom: 'Dupont', email: 'jean.dupont@example.com', planLabel: 'Rapport complet', montantEur: '14,99 €' },
    { vdBundle }
  );
  const outDir = path.join(os.tmpdir(), 'carvinguard-test');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `mock-${scenario}-${Date.now()}.pdf`);
  fs.writeFileSync(outPath, pdf);
  console.log('OK', outPath, pdf.length, 'octets');
})().catch((e) => { console.error(e); process.exit(1); });
