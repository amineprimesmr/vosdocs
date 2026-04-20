# Déploiement Carvinguard sur carvinguard.fr (Hostinger)

Ce guide explique comment déployer le site Carvinguard et connecter le domaine **carvinguard.fr** (détenu sur Hostinger).

---

## Option recommandée : Vercel + domaine Hostinger

Le projet est configuré pour Vercel. Hostinger fournit le domaine, Vercel héberge l'application.

### 1. Déployer sur Vercel

```bash
# Depuis le dossier du projet
npm install -g vercel   # si pas déjà installé
vercel
```

Ou connecte le dépôt GitHub à Vercel : [vercel.com/new](https://vercel.com/new) → importe le projet.

### 2. Ajouter le domaine dans Vercel

1. **Vercel** → ton projet → **Settings** → **Domains**
2. Ajoute : `carvinguard.fr` et `www.carvinguard.fr`
3. Vercel affiche les enregistrements DNS à configurer

### 3. Configurer le DNS chez Hostinger

1. Connecte-toi à **Hostinger** → **Domaines** → **carvinguard.fr** → **Gestion DNS**
2. Configure selon les instructions Vercel :

   **Pour la racine (carvinguard.fr) :**
   - Type : **A**
   - Nom : `@`
   - Valeur : `76.76.21.21` (IP Vercel)

   **Pour www :**
   - Type : **CNAME**
   - Nom : `www`
   - Valeur : `cname.vercel-dns.com`

3. Enregistre les changements. La propagation DNS peut prendre 5 min à 48 h.

### 4. Variables d'environnement Vercel

Dans **Vercel** → **Settings** → **Environment Variables**, configure :

| Variable | Valeur | Description |
|----------|--------|-------------|
| `BASE_URL` | `https://www.carvinguard.fr` | URL de production |
| `VEHICLEDATABASES_API_KEY` | (ta clé API) | Décodage VIN |
| `STRIPE_SECRET_KEY` | (ta clé Stripe) | Paiements |
| `STRIPE_PUBLISHABLE_KEY` | (ta clé Stripe) | Paiements |
| `STRIPE_WEBHOOK_SECRET` | (ta clé webhook) | Paiements |
| `RESEND_API_KEY` | (ta clé Resend) | Emails commandes |
| `MAIL_TO` | `contact@carvinguard.fr` | Email de réception |
| `DATABASE_URL` | (si Auto-Blog) | Connexion Postgres |
| `STRIPE_PAYMENT_LINK_ESSENTIEL` | (URL du lien Stripe) | Checkout — généré par `npm run stripe:tout` |
| `STRIPE_PAYMENT_LINK_CONFORT` | (URL du lien Stripe) | Idem |
| `STRIPE_PAYMENT_LINK_PREMIUM` | (URL du lien Stripe) | Idem |
| `SUBSCRIPTION_PRICE_INITIAL_ID` | (price Stripe 1€) | Abonnement : paiement initial |
| `SUBSCRIPTION_PRICE_MONTHLY_ID` | (price Stripe 49,99€/mois) | Abonnement : paiement mensuel |
| `SUBSCRIPTION_CREDITS_PER_CYCLE` | `7` | Crédits ajoutés par cycle mensuel |
| `SUBSCRIPTION_TRIAL_DAYS` | `1` | Facturation du mensuel au lendemain |
| `SUBSCRIPTION_INITIAL_CENTS_FOR_DISPLAY` | `100` | Juste pour l’affichage (1€) |
| `SUBSCRIPTION_MONTHLY_CENTS_FOR_DISPLAY` | `4999` | Juste pour l’affichage (49,99€) |

#### Remplir Stripe sans te perdre

1. En local, dans un fichier **`.env`** à la racine du projet : `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `BASE_URL` (clés **Live** sur [Stripe → Développeurs → Clés API](https://dashboard.stripe.com/apikeys)).
2. Lance **`npm run stripe:tout`** : le script explique les étapes en français, crée les 3 Payment Links, et écrit **`STRIPE-COLLER-VERCEL.txt`** (modèle pour coller sur Vercel — ce fichier ne doit pas être commité).
3. Crée le **webhook** Stripe (même mode Live) : URL **`https://www.carvinguard.fr/api/stripe-webhook`** (ou le domaine **canonique** affiché sur Vercel → Domains, **sans** redirection), événements :
   - **`payment_intent.succeeded`**
   - **`checkout.session.completed`** (obligatoire pour les **Payment Links** : fusion du VIN `client_reference_id` et finalisation du rapport)
   - **`invoice.payment_succeeded`** (si abonnement)
   puis copie **`STRIPE_WEBHOOK_SECRET`** (`whsec_…`) dans `.env` et sur Vercel.

   **Important — erreur 307 sur le webhook :** Stripe **ne suit pas** les redirections. Si l’URL configurée est `https://carvinguard.com/...` et que le domaine **redirige** (307/301) vers `www` ou `.fr`, les notifications **échouent** et les clients ne reçoivent pas le rapport. Mets l’URL **finale** dans Stripe (souvent `https://www.carvinguard.fr/api/stripe-webhook`). Vérification locale : **`npm run verify:webhook`** (avec `APP_ORIGIN` ou `BASE_URL` dans `.env`).
4. Vérifie : **`npm run saas:check:prod`**, puis redéploie Vercel.

Côté code (sans secrets) : **`npm run verify`** (Prisma + syntaxe du serveur).

### 5. Email contact@carvinguard.fr

Crée la boîte mail **contact@carvinguard.fr** dans Hostinger :

- Hostinger → **Emails** → Créer adresse email
- Ou configure une redirection si tu utilises une autre adresse

---

## Vérifications après déploiement

- [ ] https://carvinguard.fr fonctionne
- [ ] https://www.carvinguard.fr fonctionne
- [ ] Le formulaire de demande (numéro VIN) fonctionne
- [ ] Le paiement Stripe fonctionne
- [ ] Les emails de confirmation partent bien

---

## Références

- [Vercel - Custom domains](https://vercel.com/docs/concepts/projects/domains)
- [Hostinger - Gestion DNS](https://support.hostinger.com/)
