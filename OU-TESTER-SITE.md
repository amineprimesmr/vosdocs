# Où tester l'intégration sur le site Carvinguard

## Accès au site

- **Production (Vercel)** : https://votre-projet.vercel.app ou https://www.carvinguard.fr si le domaine est configuré
- **Local** : `npm start` puis http://localhost:3000

---

## Flux complet (où l'intégration apparaît)

### 1. **Page d'accueil** (`/` ou `index.html`)
- **Champ unique** : numéro VIN (17 caractères)
- Entrez un VIN valide (ex: `WBADT43452G123456`, `1HGBH41JXMN109186`)
- Cliquez sur **Rechercher**
- → Appel API Vehicle Databases pour décoder le VIN
- Si le VIN est reconnu : redirection vers **resultats**
- Si le VIN n'est pas reconnu : message d'erreur sous le bouton

### 2. **Page Résultats** (`resultats.html`)
- Badge **VIN:** avec le numéro saisi
- **Description véhicule** (si API configurée) : ex. « 2006 Dodge Stratus SXT » (année + marque + modèle + finition)
- Animation « 330 millions de relevés », « 1000 sources », « 45 pays »
- Redirection automatique vers **verification**

### 3. **Page Vérification** (`verification.html`)
- **VIN** affiché en gras
- **Description véhicule** sous le VIN (ex: « 2006 Dodge Stratus SXT »)
- Barre de progression + liste des points vérifiés
- Redirection automatique vers **rapport**

### 4. **Page Rapport** (`rapport.html`)
- Titre « LES RÉSULTATS SONT PRÊTS »
- **VIN** du véhicule
- **Description véhicule** (marque, modèle, année)
- Date du rapport
- Bloc avertissement vert
- Formulaire email + bouton « Voir les résultats »
- Redirection vers **checkout**

### 5. **Page Checkout / Paiement** (`checkout.html`)
- Bloc récap : Démarche, Numéro VIN
- **Ligne Véhicule** (si données API) : ex. « 2006 Dodge Stratus SXT »
- Formulaire certificat (dates, type, titulaire)
- Formulaire coordonnées (nom, prénom, tél, email)
- Paiement Stripe

### 6. **Email de commande** (après paiement)
- VIN
- **Description véhicule** (année + marque + modèle) si disponible

---

## VIN de test (Vehicle Databases)

Exemples de VIN reconnus par l'API (US/EU) :
- `1HGBH41JXMN109186` (Honda)
- `WBADT43452G123456` (BMW)
- `1B3AL46XX6N227698` (Dodge Stratus 2006)

---

## Si la clé API n'est pas configurée

Le site fonctionne en **mode dégradé** :
- Le VIN est accepté et le flux continue
- **Pas de description véhicule** (marque/modèle/année) : seuls le VIN et « — » sont affichés
- Pour activer le décodage : ajouter `VEHICLEDATABASES_API_KEY` dans Vercel → Environment Variables
