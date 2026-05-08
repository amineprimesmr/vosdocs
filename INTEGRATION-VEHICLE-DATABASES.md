# Intégration Vehicle Databases API

Carvinguard utilise l’**API Vehicle Databases** (vehicledatabases.com) pour décoder les numéros VIN et récupérer les informations véhicule (marque, modèle, année).

## Configuration

### 1. Clé API

1. Connectez-vous à [vehicledatabases.com/portal/home](https://vehicledatabases.com/portal/home)
2. **Pour les tests** : utilisez la **Sandbox key** affichée sur le tableau de bord (`1235c7f8208a11f188420242ac120002` par défaut)
3. **Pour la production** : créez une clé API live dans "Make the Payment & Access Live Keys"

### 2. Variables d'environnement

Ajoutez dans `.env` (local) ou dans **Vercel → Settings → Environment Variables** :

```
VEHICLEDATABASES_API_KEY=votre_cle_sandbox_ou_live
```

Pour les tests avec la Sandbox :
```
VEHICLEDATABASES_API_KEY=1235c7f8208a11f188420242ac120002
```

### 3. Redéployer

Après avoir ajouté la variable, redéployez l’application (push Git ou redéploiement manuel sur Vercel).

## Comportement

- **Choix du fournisseur** (voir `lib/vin-provider.js`) : si `VEHICLEDATABASES_API_KEY` est défini, **Vehicle Databases est utilisé en priorité** (y compris si `CARAPI_TOKEN` est aussi défini). Sinon, CarAPI seul ou NHTSA. Surcharge : `VIN_DECODE_PROVIDER=vehicledatabases` ou `carapi`.
- **Rapport PDF invité** (`fulfill-vin-order`) : avec le fournisseur VD, l’enrichissement complet (`fetchVehicleDatabasesFullEnrichment`) alimente le PDF.
- **Espace client** : recherche « rapport complet » appelle `GET /api/vd/full-report/:vin` lorsque le fournisseur actif est VD (1 crédit).
- **Clé non configurée** : repli NHTSA ou message d’erreur selon le parcours.

## Flux technique

1. `index.html` → formulaire VIN
2. `form-handler.js` → appel `GET /api/vin-decode/{vin}`
3. `server.js` → proxy vers `https://api.vehicledatabases.com/advanced-vin-decode/v2/{vin}` (header `x-authkey`)
4. Données récupérées : `year`, `make`, `model`, `trim` → stockées dans `vehicleData` (sessionStorage)
5. Affichage sur : resultats, verification, rapport, checkout

## Documentation API

- [Advanced VIN Decode](https://vehicledatabases.com/docs/api-documentation/advanced-vin-decode/)
- [Documentation générale](https://www.vehicledatabases.com/docs)
