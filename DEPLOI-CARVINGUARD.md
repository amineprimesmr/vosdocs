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
| `STRIPE_SECRET_KEY` | (ta clé Stripe) | Paiements |
| `STRIPE_PUBLISHABLE_KEY` | (ta clé Stripe) | Paiements |
| `STRIPE_WEBHOOK_SECRET` | (ta clé webhook) | Paiements |
| `RESEND_API_KEY` | (ta clé Resend) | Emails commandes |
| `MAIL_TO` | `contact@carvinguard.fr` | Email de réception |
| `DATABASE_URL` | (si Auto-Blog) | Connexion Postgres |

### 5. Email contact@carvinguard.fr

Crée la boîte mail **contact@carvinguard.fr** dans Hostinger :

- Hostinger → **Emails** → Créer adresse email
- Ou configure une redirection si tu utilises une autre adresse

---

## Vérifications après déploiement

- [ ] https://carvinguard.fr fonctionne
- [ ] https://www.carvinguard.fr fonctionne
- [ ] Le formulaire de demande (plaque + département) fonctionne
- [ ] Le paiement Stripe fonctionne
- [ ] Les emails de confirmation partent bien

---

## Références

- [Vercel - Custom domains](https://vercel.com/docs/concepts/projects/domains)
- [Hostinger - Gestion DNS](https://support.hostinger.com/)
