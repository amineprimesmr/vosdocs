# Configurer l’envoi d’email (commande → infos.carvinguard@gmail.com)

Une seule chose à faire : **mettre ta clé API Resend** dans le projet (en local et sur Vercel).

---

## 1. Récupérer la clé Resend

Tu as déjà un compte Resend. Récupère ta clé :

- Va sur **https://resend.com/api-keys** (ou Resend → API Keys)
- Copie la clé qui commence par **`re_`** (ex. `re_WtfVVMPM_GT6KB5hFbRbwfz2LdUubUe63`)

---

## 2. En local (pour le bouton test)

1. Ouvre le fichier **`.env`** à la racine du projet (s’il n’existe pas, copie `.env.example` et renomme en `.env`).
2. Ajoute ou modifie la ligne :
   ```env
   RESEND_API_KEY=re_ta_cle_ici
   ```
   (remplace `re_ta_cle_ici` par ta vraie clé Resend, sans espace).
3. Enregistre, puis lance **`npm start`**.
4. Ouvre **http://localhost:3000/checkout.html** et clique sur **« Test : simuler paiement et envoyer l’email »**.  
   L’email doit arriver sur **infos.carvinguard@gmail.com**.

---

## 3. En production (www.carvinguard.fr)

1. Va sur **https://vercel.com** → projet **carvinguard** → **Settings** → **Environment Variables**.
2. Ajoute (pour l’environnement **Production**) :
   - **RESEND_API_KEY** = ta clé Resend (celle qui commence par `re_`)
   - **MAIL_FROM** = `contact@carvinguard.fr` (domaine **carvinguard.fr** vérifié sur Resend — voir §4)
   - **MAIL_TO** = `starkxgroup@gmail.com,amine35ennasri@gmail.com` (plusieurs adresses séparées par une virgule)
   - **MERCHANT_EMAIL** = idem pour les emails de validation du blog auto
3. **Redéploie** le projet (Deployments → … → Redeploy).

Après ça, chaque paiement validé (et le bouton test) enverra un email à **toutes** les adresses listées dans `MAIL_TO`.

## 4. Vérifier le domaine carvinguard.fr sur Resend (obligatoire pour starkxgroup@gmail.com)

Sans domaine vérifié, Resend n’envoie qu’à l’email du compte (mode test `onboarding@resend.dev`).

**Hostinger** → Domaines → **carvinguard.fr** → Gestion DNS, ajoute :

| Type | Nom | Valeur | Priorité |
|------|-----|--------|----------|
| TXT | `resend._domainkey` | (valeur DKIM affichée sur [resend.com/domains](https://resend.com/domains)) | — |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |

Ou en local : `HOSTINGER_API_TOKEN=… node scripts/setup-resend-dns-hostinger.js`

Puis sur Resend : bouton **Verify** sur le domaine. Délai DNS : 5–30 min.

---

## Rapport client (PDF + lien en ligne)

En production, configure aussi :

- **`APP_ORIGIN`** = URL publique du site (ex. `https://www.carvinguard.fr`) — pour le lien « Voir mon rapport » dans l’email client.
- **`DATABASE_URL`** + **`npx prisma db push`** — pour enregistrer les commandes (`vin_orders`), le jeton de consultation et le statut `/api/order-status` sur la page `confirmation.html`.

Sans base de données, le **PDF est quand même joint** à l’email client ; le lien en ligne n’est pas disponible (message explicite dans l’email).

---

## Option : utiliser Gmail (SMTP) à la place

Si tu préfères Gmail, il faut activer la **validation en deux étapes** sur le compte Google, puis créer un **mot de passe d’application**. Ensuite dans `.env` : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`. Le projet utilise Resend si **RESEND_API_KEY** est défini, sinon il utilise le SMTP.
