# Carvinguard - Rapport historique véhicule (VIN)

Service de rapports véhicule par VIN. Les domaines `.ma` et `.fr` sont rattachés au projet Vercel `vosdocs`. Une publication de ce projet affecte les deux domaines. L'état de validation et les limites connues sont documentés dans `docs/AUDIT-2026-09-22.md` ; la présence d'une page ne prouve pas que le paiement ou la livraison fonctionnent.

### Parcours actuel

Les pages actives sont dans `public/`. Le visiteur consulte un aperçu VIN, achète des crédits via Stripe Checkout, active son compte depuis un lien reçu par email et consulte ses rapports dans `compte.html`. Les utilisateurs et crédits sont persistés dans PostgreSQL avec Prisma. Les fichiers HTML à la racine et les scripts de paiement embarqué sont historiques.

Avant déploiement : `npm ci`, `npm test`, puis une préversion Vercel et des contrôles HTTP. Les tests de régression utilisent des services simulés : ils ne remplacent pas un achat de bout en bout en environnement Stripe de test. Les règles Vercel ne doivent pas réécrire les routes API vers `/server.js` : `api/router.js` reçoit les routes API via les règles explicites de `vercel.json`, avant le traitement filesystem, en conservant leur chemin grâce à `request.path`.

Les sections historiques ci-dessous peuvent décrire l'ancien parcours invité ; se référer au code de `public/checkout.html` pour le parcours commercial actuel.

## Structure du site

**Production (Vercel) :** les pages HTML servies au public sont dans **`public/`**. Les noms de fichiers ci‑dessous correspondent aux chemins sous `public/` (ex. `public/index.html`).

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

**Agence SEO (accès Git + Search Console, pages en `public/`) :** guide pas à pas **`docs/ACCES-AGENCE-SEO.md`**. Lister les pages HTML déployées : `npm run seo:pages`.

## Personnalisation

- **Prix** : 14,99 € (rapport unique) ; constantes en centimes dans `server.js` et handlers Stripe
