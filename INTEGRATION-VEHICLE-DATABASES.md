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

- **Clé configurée** : à la soumission du VIN, l’API Vehicle Databases est appelée pour valider et enrichir les données (marque, modèle, année). Si le VIN n’est pas reconnu, un message d’erreur s’affiche.
- **Clé non configurée** : le flux continue sans décodage, uniquement avec le VIN saisi.

## Flux technique

1. `index.html` → formulaire VIN
2. `form-handler.js` → appel `GET /api/vin-decode/{vin}`
3. `server.js` → proxy vers `https://api.vehicledatabases.com/advanced-vin-decode/v2/{vin}` (header `x-authkey`)
4. Données récupérées : `year`, `make`, `model`, `trim` → stockées dans `vehicleData` (sessionStorage)
5. Affichage sur : resultats, verification, rapport, checkout

## Documentation API

- [Advanced VIN Decode](https://vehicledatabases.com/docs/api-documentation/advanced-vin-decode/)
- [Documentation générale](https://www.vehicledatabases.com/docs)
