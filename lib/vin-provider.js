'use strict';

/**
 * Choix du fournisseur de décodage VIN (une seule source pour server + vin-decode-core + fulfill).
 *
 * - Par défaut : si les deux clés existent, **Vehicle Databases** est utilisé (rapport PDF invité + enrichissement complet).
 * - Surcharge : `VIN_DECODE_PROVIDER=vehicledatabases` ou `carapi`.
 * - `VIN_DECODE_PROVIDER=carapi` **n’impose plus CarAPI** si Vehicle Databases est disponible (clé env ou intégrée).
 *   Pour n’utiliser **que** CarAPI : définissez **`SKIP_VEHICLE_DATABASES=1`** sur le serveur.
 *
 * Clé VD : `VEHICLEDATABASES_API_KEY` en priorité ; sinon clé sandbox intégrée (pas besoin de Vercel).
 */

/** Sandbox Vehicle Databases — utilisée si aucune variable d’environnement. */
const DEFAULT_VEHICLEDATABASES_KEY = '1235c7f8208a11f188420242ac120002';

function getVehicleDatabasesApiKey() {
  const fromEnv = String(process.env.VEHICLEDATABASES_API_KEY || '').trim();
  return fromEnv || DEFAULT_VEHICLEDATABASES_KEY;
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
  const vd = getVehicleDatabasesApiKey();

  if (prefer === 'carapi') {
    const skipVd = String(process.env.SKIP_VEHICLE_DATABASES || '').trim() === '1';
    if (!skipVd && vd) return { id: 'vehicledatabases', apiKey: vd };
    if (carapi) return { id: 'carapi', apiKey: carapi };
    if (vd) return { id: 'vehicledatabases', apiKey: vd };
    return null;
  }
  if (prefer === 'vehicledatabases') {
    if (vd) return { id: 'vehicledatabases', apiKey: vd };
    if (carapi) return { id: 'carapi', apiKey: carapi };
    return null;
  }

  // Défaut : Vehicle Databases (clé env ou intégrée), sinon CarAPI seul.
  // Tout‑CarAPI : SKIP_VEHICLE_DATABASES=1 avec VIN_DECODE_PROVIDER=carapi et CARAPI_TOKEN.
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
