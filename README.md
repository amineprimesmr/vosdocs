# Carvinguard - Rapport historique véhicule (VIN)

Site **100% fonctionnel** pour une agence prestataire proposant un **rapport historique véhicule** à partir du numéro VIN (à partir de 19,90 € selon formule).

## Structure du site

### Pages principales
- **index.html** - Page d'accueil (recherche VIN / rapport)
- **recapitulatif.html** - Récapitulatif (dates, titulaire, email)
- **checkout.html** - Infos client + paiement Stripe
- **confirmation.html** - Confirmation de commande

### Pages contenu
- **contact.html** - Formulaire de contact
- **aide.html** - FAQ et assistance
- **carte-grise.html** - Carte grise en ligne
- **demarches.html** - Toutes les démarches
- **prix-carte-grise.html** - Tarifs carte grise
- **prix-cheval-fiscal.html** - Cheval fiscal
- **papiers.html** - Documents véhicule
- **404.html** - Page erreur

### Légal
- **mentions-legales.html** - CGV, CGU, politique confidentialité

## Fonctionnalités

- ✅ **Flux simplifié** - Index (numéro VIN) → Récap (dates, titulaire, email) → Checkout (infos + paiement Stripe)
- ✅ **Paiement Stripe** - Payment Element, webhook, commandes dans `data/commandes.json`
- ✅ **Liste départements** - API /api/departements
- ✅ Design responsive, animations

## Lancer le site (recommandé)

```bash
cd carvinguard
npm install
npm start
```

Puis ouvrir : **http://localhost:3000**

Le serveur Node.js fournit l'API véhicule et sert les pages.

## Alternative : mode statique

```bash
cd carvinguard
python3 -m http.server 8080
```

Ouvrir http://localhost:8080 - Le site fonctionne avec des données simulées (liste limitée de départements, véhicules générés).

## Paiement et commandes

- **Stripe** : clés dans `.env` (voir `.env.example`)
- **Commandes** : enregistrées dans `data/commandes.json` via webhook Stripe
- **Google Sheets** : optionnel, voir **COMMANDES.md**

## SEO

Le site est optimisé pour le référencement. Voir **SEO-README.md** pour :
- Récapitulatif des optimisations implémentées
- Checklist avant mise en production
- Personnalisation du domaine et des images

## Personnalisation

- **Prix** : 19,90 € (modifier dans `server.js` et les handlers)
