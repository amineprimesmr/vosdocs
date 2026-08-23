# Auto-Blog SEO – Mise en place

Ce document décrit la mise en place du système de génération automatique d’articles de blog (tous les 3 jours, 2 propositions par email, validation par clic).

## Prérequis

- Compte **Neon** (PostgreSQL) ou **Supabase** (gratuit)
- Clé API **Groq** (gratuit) : [console.groq.com](https://console.groq.com) → API Keys
- **Resend** déjà utilisé pour les commandes (même clé)
- Variables d’environnement sur **Vercel** (ou en local dans `.env`)

## 1. Base de données (Neon ou Supabase)

1. Créez une base PostgreSQL sur [neon.tech](https://neon.tech) ou [supabase.com](https://supabase.com).
2. Copiez l’URL de connexion (format `postgresql://...`).
3. Ajoutez-la dans Vercel : **Settings → Environment Variables** → `DATABASE_URL`.

En local :

```bash
cp .env.example .env
# Éditez .env et renseignez DATABASE_URL
```

Puis appliquez le schéma et (optionnel) importez les articles existants :

```bash
npm install
npx prisma db push
node scripts/seed-blog-db.js
```

`scripts/seed-blog-db.js` lit `content/blog-articles.json` et insère les articles dans la table `blog_posts`.

## 2. Variables d’environnement (Vercel)

| Variable          | Où la trouver / valeur                                      |
|------------------|-------------------------------------------------------------|
| `DATABASE_URL`   | Neon ou Supabase → connection string PostgreSQL             |
| `GROQ_API_KEY`   | [console.groq.com](https://console.groq.com) → API Keys      |
| `GROQ_MODEL`     | Optionnel. Défaut `openai/gpt-oss-120b` (remplace `llama-3.3-70b-versatile`, retiré le 16/08/2026). |
| `CRON_SECRET`    | Générer : `openssl rand -hex 32`                            |
| `MERCHANT_EMAIL` | Adresse qui reçoit les 2 propositions (ex. infos.carvinguard@gmail.com) |
| `BASE_URL`       | URL du site (ex. https://www.carvinguard.fr)                    |
| `RESEND_API_KEY` | Déjà utilisé pour les emails commandes                      |
| `MAIL_FROM`      | Optionnel, défaut Resend (ex. noreply@carvinguard.fr si domaine vérifié) |

## 3. CRON (tous les 3 jours à 9h UTC)

Sur Vercel, le CRON ne peut pas envoyer d’en-tête personnalisé. Il faut donc utiliser un **service externe** qui appelle l’API avec le secret.

1. Créez un compte sur [cron-job.org](https://cron-job.org) (ou équivalent).
2. Créez un job :
   - **URL :** `https://www.carvinguard.fr/api/cron/generate-articles`
   - **Méthode :** GET
   - **En-tête :** `Authorization: Bearer VOTRE_CRON_SECRET`
   - **Planification :** tous les 3 jours à 9h00 UTC → expression cron : `0 9 */3 * *`

Alternative avec secret en query (moins propre mais possible) :  
`https://www.carvinguard.fr/api/cron/generate-articles?secret=VOTRE_CRON_SECRET`  
(à ne pas exposer dans des logs.)

## 4. Test manuel du CRON

```bash
curl -H "Authorization: Bearer VOTRE_CRON_SECRET" "https://www.carvinguard.fr/api/cron/generate-articles"
```

Ou en local (avec `.env` rempli) :

```bash
curl -H "Authorization: Bearer VOTRE_CRON_SECRET" "http://localhost:3000/api/cron/generate-articles"
```

Réponse attendue : `{"ok":true,"proposals":2,"emailId":"..."}`.  
Un email avec 2 cartes « Publier » doit arriver sur `MERCHANT_EMAIL`.

## 5. Flux utilisateur

1. Le CRON appelle `/api/cron/generate-articles` (avec le secret).
2. Groq génère 2 articles SEO, enregistrés en base avec le statut `PENDING`.
3. Un email est envoyé à `MERCHANT_EMAIL` avec 2 liens « Publier cet article ».
4. En cliquant sur un lien, l’utilisateur est redirigé vers `/api/blog/approve?token=...`.
5. L’article choisi est publié (table `blog_posts`), l’autre est marqué `REJECTED`.
6. L’article est visible sur `/blog` et `/blog/:slug`. Le sitemap (`/sitemap.xml`) est généré dynamiquement et inclut les articles.

## 6. Sécurité

- Les tokens d’approbation expirent après **48 h** et sont **à usage unique**.
- Le CRON est protégé par `CRON_SECRET` (header ou query).
- Pas de back-office : tout passe par email + lien avec token.

## 7. Build Vercel

Le script `postinstall` exécute `prisma generate`. Aucune action supplémentaire si vous gardez le build par défaut. Si vous avez un script `build` personnalisé, ajoutez-y `prisma generate` (ou laissez `postinstall`).
