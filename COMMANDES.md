# 📋 Récupérer les commandes clients

Les commandes sont enregistrées **automatiquement** après chaque paiement réussi.

> **Pour le dev local** : Stripe envoie le webhook uniquement vers une URL publique. Pour tester en local, utilise [Stripe CLI](https://stripe.com/docs/stripe-cli) : `stripe listen --forward-to localhost:3000/api/stripe-webhook` puis ajoute le secret généré dans `.env`.

---

## 1. Fichier local (automatique)

**Toutes les commandes** sont enregistrées dans :

```
data/commandes.json
```

Ouvre ce fichier pour voir la liste des commandes. Chaque entrée contient :
- `date` – Date et heure
- `nom`, `prenom` – Identité
- `email`, `phone` – Contact
- `vin` – Numéro VIN du véhicule (17 caractères)
- `titulaire`, `miseCirculation`, `dateCertificat` – Infos carte grise (case I, etc.)
- `cp`, `ville` – Adresse
- `montant` – Montant payé

---

## 2. Google Sheets (optionnel, partage équipe)

Pour remplir une feuille Google partagée avec ton équipe :

### Étape 1 – Créer la feuille

1. Crée une feuille Google : [sheets.google.com](https://sheets.google.com)
2. En ligne 1, mets les en-têtes :
   ```
   Date | Nom | Prénom | Email | Téléphone | VIN | Titulaire | Date certif | CP | Ville | Montant
   ```

### Étape 2 – Script Apps Script

1. Dans la feuille : **Extensions → Apps Script**
2. Supprime tout le code existant et colle :

```javascript
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);
    sheet.appendRow([
      data.date || '',
      data.nom || '',
      data.prenom || '',
      data.email || '',
      data.phone || '',
      data.vin || '',
      data.departement || '',
      data.titulaire || '',
      data.dateCertificat || '',
      data.cp || '',
      data.ville || '',
      data.montant || ''
    ]);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

3. **Deploy → New deployment** → Type : **Web app**
4. **Execute as** : Me
5. **Who has access** : Anyone
6. Clique sur **Deploy**
7. Copie l’**URL de l’application** (ex. `https://script.google.com/macros/s/xxx/exec`)

### Étape 3 – Ajouter l’URL dans .env

Dans ton fichier `.env` :

```
ORDERS_WEBHOOK_URL=https://script.google.com/macros/s/VOTRE_ID/exec
```

### Étape 4 – Webhook Stripe

1. Va sur [dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks)
2. **Add endpoint**
3. **URL** : `https://votredomaine.com/api/stripe-webhook`
4. **Événements** : `payment_intent.succeeded`
5. Clique sur **Add endpoint**
6. Ouvre l’endpoint, clique sur **Reveal** pour afficher le **Signing secret**
7. Dans `.env`, ajoute :
   ```
   STRIPE_WEBHOOK_SECRET=whsec_xxxxx
   ```

Redémarre le serveur. Les nouvelles commandes iront à la fois dans `data/commandes.json` et dans ta Google Sheet.
