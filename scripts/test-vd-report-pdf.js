#!/usr/bin/env node
/**
 * Génère un PDF de test à partir d’un bundle VehicleDatabases (mock ou API réelle si VEHICLEDATABASES_API_KEY).
 * Usage : node scripts/test-vd-report-pdf.js [VIN]
 */
require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateReportPdfBuffer } = require('../lib/report-pdf');
const { fetchVehicleDatabasesFullEnrichment } = require('../lib/vehicledatabases-client');

const DEFAULT_VIN = '1HGBH41JXMN109186';

/** Forme alignée sur dashboard + API réelle (champs alternatifs pour le PDF). */
function buildMockVdBundle(vin) {
  return {
    vin,
    vinDecode: {
      ok: true,
      status: 200,
      data: {
        status: 'success',
        data: {
          vin,
          make: 'Honda',
          model: 'Accord',
          year: 2001,
          trim: 'LX',
          specifications: [],
          transmission: { type: 'automatic', number_of_speeds: 4 },
          colors: { exterior: [{ description: 'Crystal Blue' }],
            interior: [{ description: 'Gray' }] },
          dimensions: { exterior: { wheelbase_inches: 106 } }
        }
      }
    },
    europeVin: { ok: true, status: 200, data: { data: { general_information: { make: 'Honda', country: 'JP' } } } },
    stolenCheck: {
      ok: true,
      status: 200,
      data: { data: { stolen: false, countries_checked: 'US, EU sample', source: 'VehicleDatabases mock' } }
    },
    marketValue: {
      ok: true,
      status: 200,
      data: {
        data: {
          basic: { year: 2001, make: 'Honda', model: 'Accord' },
          trade_in: '$1,200',
          private_party: '$2,400',
          dealer_retail: '$3,100'
        }
      }
    },
    recalls: {
      ok: true,
      status: 200,
      data: { recall: [] }
    },
    salesHistory: {
      ok: true,
      status: 200,
      data: {
        data: {
          make: 'Honda',
          year: 2001,
          sales: [
            {
              date: '2019-06-15',
              price: 3200,
              mileage: 155000,
              city: 'Columbus',
              state: 'OH',
              country: 'us'
            }
          ]
        }
      }
    },
    auction: {
      ok: true,
      status: 200,
      data: {
        data: {
          auctions: [
            {
              sale_date: '2020-03-01',
              city: 'Houston',
              state: 'TX',
              sale_price: 4100,
              odometer: 160000
            }
          ]
        }
      }
    },
    media: {
      ok: true,
      status: 200,
      data: {
        data: {
          images: {
            exterior: ['https://via.placeholder.com/150.png?text=Ext+1'],
            interior: ['https://via.placeholder.com/150.png?text=Int+1'],
            colors: []
          }
        }
      }
    },
    maintenance: {
      ok: true,
      status: 200,
      data: {
        data: {
          maintenance_intervals: [
            { miles: 7500, months: 6, description: 'Vidange moteur et filtre à huile', month_interval: 6 }
          ]
        }
      }
    },
    warranty: {
      ok: true,
      status: 200,
      data: {
        data: {
          warranties: [
            { type: 'Garantie générale', months: 36, miles: 36000 },
            { type: 'Groupe motopropulseur', months: 60, miles: 60000 }
          ]
        }
      }
    }
  };
}

async function main() {
  const vinArg = process.argv[2] || DEFAULT_VIN;
  const vin = String(vinArg).replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '').toUpperCase();
  if (vin.length !== 17) {
    console.error('VIN invalide (17 caractères requis)');
    process.exit(1);
  }

  const apiKey = String(process.env.VEHICLEDATABASES_API_KEY || '').trim();
  let vdBundle;
  let label;
  if (apiKey) {
    label = 'API VehicleDatabases';
    vdBundle = await fetchVehicleDatabasesFullEnrichment(apiKey, { vin });
  } else {
    label = 'bundle mock (sans VEHICLEDATABASES_API_KEY)';
    vdBundle = buildMockVdBundle(vin);
  }

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
