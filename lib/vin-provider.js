'use strict';

/**
 * Choix du fournisseur de décodage VIN (une seule source pour server + vin-decode-core + fulfill).
 *
 * - Par défaut : si les deux clés existent, **Vehicle Databases** est utilisé (rapport PDF invité + enrichissement complet).
 * - Surcharge : `VIN_DECODE_PROVIDER=vehicledatabases` ou `carapi`.
 * - Un choix explicite est respecté ; aucun fournisseur de secours implicite.
 * - SKIP_VEHICLE_DATABASES=1 désactive VD, y compris quand les deux clés existent.
 * - Aucune clé partagée ou sandbox intégrée : les secrets viennent de l’environnement.
 */

function getVehicleDatabasesApiKey() {
  return String(process.env.VEHICLEDATABASES_API_KEY || '').trim();
}

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
  const vd = String(process.env.SKIP_VEHICLE_DATABASES || '').trim() === '1'
    ? '' : getVehicleDatabasesApiKey();

  if (prefer === 'carapi') {
    if (carapi) return { id: 'carapi', apiKey: carapi };
    return null;
  }
  if (prefer === 'vehicledatabases') {
    if (vd) return { id: 'vehicledatabases', apiKey: vd };
    return null;
  }

  if (prefer) return null;
  // Défaut : Vehicle Databases avec une clé configurée, sinon CarAPI.
  if (vd && carapi) return { id: 'vehicledatabases', apiKey: vd };
  if (vd) return { id: 'vehicledatabases', apiKey: vd };
  if (carapi) return { id: 'carapi', apiKey: carapi };
  return null;
}

/** Jeton CarAPI si présent, même lorsque le fournisseur principal est Vehicle Databases (rapport multi-sources). */
function getOptionalCarApiToken() {
  const t = normalizeCarapiToken(process.env.CARAPI_TOKEN || process.env.CARAPI_API_KEY || '');
  return t || null;
}

module.exports = { getVinDecodeProvider, getVehicleDatabasesApiKey, getOptionalCarApiToken };
