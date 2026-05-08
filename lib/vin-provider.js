'use strict';

/**
 * Choix du fournisseur de décodage VIN (une seule source pour server + vin-decode-core + fulfill).
 *
 * - Par défaut : si les deux clés existent, **Vehicle Databases** est utilisé (rapport PDF invité + enrichissement complet).
 * - Surcharge : `VIN_DECODE_PROVIDER=vehicledatabases` ou `carapi`.
 */

function normalizeCarapiToken(s) {
  return String(s || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

function getVinDecodeProvider() {
  const prefer = String(process.env.VIN_DECODE_PROVIDER || '')
    .trim()
    .toLowerCase();
  const carapi = normalizeCarapiToken(process.env.CARAPI_TOKEN || process.env.CARAPI_API_KEY || '');
  const vd = String(process.env.VEHICLEDATABASES_API_KEY || '').trim();

  if (prefer === 'carapi') {
    if (carapi) return { id: 'carapi', apiKey: carapi };
    if (vd) return { id: 'vehicledatabases', apiKey: vd };
    return null;
  }
  if (prefer === 'vehicledatabases') {
    if (vd) return { id: 'vehicledatabases', apiKey: vd };
    if (carapi) return { id: 'carapi', apiKey: carapi };
    return null;
  }

  // Défaut : Vehicle Databases dès qu'une clé VD est présente (sinon CarAPI seul)
  if (vd && carapi) return { id: 'vehicledatabases', apiKey: vd };
  if (vd) return { id: 'vehicledatabases', apiKey: vd };
  if (carapi) return { id: 'carapi', apiKey: carapi };
  return null;
}

module.exports = { getVinDecodeProvider };
