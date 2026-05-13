# Accès agence SEO — mise en place de A à Z (Carvinguard)

Ce document permet à **toi (propriétaire)** de tout configurer une fois, et à **l’agence** de travailler en autonomie sur les balises SEO, sans équivalent `public_html` sur le serveur : tout passe par **Git** → **Vercel** redéploie automatiquement.

---

## 0. Règle critique (à lire en premier)

En production, le site sert les pages depuis le dossier **`public/`** (voir `server.js` : `express.static(…/public)` et `sendFile(…/public/index.html)`).

- **L’agence doit modifier les fichiers sous `public/`** (par ex. `public/index.html`, `public/contact.html`).
- Les fichiers `.html` à la **racine** du dépôt (hors `public/`) peuvent exister en doublon pour d’autres usages : **ne pas les considérer comme source de vérité** pour le site en ligne sur Vercel.

Liste à jour des pages HTML déployées :

```bash
npm run seo:pages
```

---

## 1. GitHub — donner à l’agence le pouvoir de tout modifier elle-même

### 1.1 Prérequis

- Le dépôt GitHub est **celui connecté à Vercel** (Vercel → Projet → **Settings** → **Git** : même dépôt / même branche de production).
- Branche de production habituelle : **`main`**.

### 1.2 Inviter un collaborateur (accès écriture)

1. Va sur GitHub → le dépôt **carvinguard** (ou le nom exact du repo).
2. **Settings** (onglet du dépôt) → **Collaborators** (ou **Collaborators and teams**).
3. **Add people** → saisis l’**adresse e-mail GitHub** ou le **nom d’utilisateur** de la personne de l’agence.
4. Choisis le rôle **Write** (suffisant pour pousser des commits et modifier les fichiers).

Avec **Write**, l’agence peut :

- modifier tous les fichiers du dépôt (y compris `public/*.html`, images dans `public/`, etc.) ;
- pousser sur `main` → **déclenche le déploiement Vercel** si le projet est lié à cette branche.

### 1.3 Comment l’agence édite sans logiciel (interface web GitHub)

1. Ouvrir le fichier, ex. `public/index.html`.
2. Cliquer sur le **crayon** (Edit this file).
3. Modifier le bloc `<head>` (title, meta description, keywords, Open Graph, Twitter, canonical, JSON-LD si besoin).
4. **Commit changes** : message clair (ex. `SEO: meta accueil`).
5. Choisir **Commit directly to the `main` branch** (autonomie totale) **ou** créer une branche + **Pull request** (voir section 4).

Après le commit sur `main`, Vercel lance un nouveau déploiement (quelques minutes).

### 1.4 Fichiers sensibles — interdiction pour l’agence (sécurité)

Demander explicitement à l’agence de **ne pas** modifier, sauf accord écrit :

- `.env`, `.env.local`, tout fichier contenant des secrets ;
- `server.js` (logique métier, paiements, API) ;
- `vercel.json`, workflows `.github/workflows/` (sauf si vous avez prévu un accompagnement dev).

Les **variables d’environnement** restent sur **Vercel** (dashboard), jamais dans le HTML.

---

## 2. Vercel — visibilité déploiements (optionnel mais utile)

Tu restes propriétaire du compte Vercel ; l’agence n’a **pas besoin** de Vercel pour éditer le SEO (GitHub suffit). Si tu veux qu’elle voie les logs / états de déploiement :

1. [vercel.com](https://vercel.com) → ton équipe / projet **Carvinguard**.
2. **Settings** → **Members** (ou invitation au **Team**).
3. Inviter l’e-mail de l’agence avec un rôle **Developer** (lecture + déploiements limités selon ton offre).

Elle ne remplace pas l’édition des fichiers : l’édition reste sur **GitHub**.

---

## 3. Google Search Console — accès complet pour l’agence

### 3.1 Créer / posséder la propriété (à faire une fois, par toi)

1. [Google Search Console](https://search.google.com/search-console).
2. **Ajouter une propriété** : de préférence le préfixe d’URL **`https://www.carvinguard.fr/`** (cohérent avec les canonicals actuels du site).
3. **Vérifier** la propriété. Méthodes courantes :
   - **Enregistrement DNS** chez Hostinger (TXT ou CNAME indiqué par Google) — souvent la plus simple si le domaine est déjà géré là ;
   - ou **fichier HTML** / **balise meta** : la balise peut être ajoutée dans `public/index.html` dans `<head>`, commit, déploiement, puis cliquer sur Vérifier dans Google.

### 3.2 Donner à l’agence les droits pour tout faire côté Search Console

1. Dans Search Console → **Paramètres** (icône engrenage) → **Utilisateurs et autorisations**.
2. **Ajouter un utilisateur** avec l’e-mail de l’agence.
3. Rôle : **Propriétaire** (ou **Utilisateur avec droits complets** selon l’intitulé actuel de l’interface) si tu veux qu’elle gère sitemaps, inspections d’URL, désaveux de liens, etc., sans te solliciter.

Tu peux retirer l’accès à tout moment.

---

## 4. Mode recommandé si tu veux valider avant mise en prod : branche + Pull Request

1. Sur GitHub, **Settings** → **Branches** → **Branch protection rules** → règle sur `main` : exiger une **Pull request** avant merge (et éventuellement une review obligatoire).
2. L’agence crée une branche `seo/…` depuis l’interface GitHub ou en local, pousse les changements, ouvre une **PR** vers `main`.
3. La CI du repo (`.github/workflows/ci.yml`) exécute `npm run verify` sur les PR.
4. Après ton **merge** dans `main`, Vercel déploie la production.

Les **déploiements preview** Vercel (si activés sur le projet) donnent une URL de prévisualisation par branche/PR : utile pour relire avant merge.

---

## 5. Images SEO (Open Graph, etc.)

- Fichiers typiques : `public/og-image.png`, logos référencés dans les meta (ex. `/newlogo.png` → fichier sous `public/`).
- Après ajout d’une image : utiliser une **URL absolue** en production dans les meta, ex. `https://www.carvinguard.fr/og-image.png`.
- Bonne pratique **og:image** : environ **1200×630** px.

---

## 6. Sitemap et robots

- Le sitemap peut être généré dynamiquement côté serveur ; en cas de doute après changement d’URLs, l’agence peut **resoumettre le sitemap** dans Search Console après déploiement.
- `robots.txt` : s’il est servi depuis `public/`, les mêmes règles Git s’appliquent.

---

## 7. E-mail type à envoyer à l’agence

Objet : Accès GitHub + Search Console — Carvinguard

Bonjour,

Voici l’accès pour intervenir directement sur le SEO technique (meta, titres, Open Graph, images référencées, etc.) :

1. **GitHub** : vous avez été invité en **Write** sur le dépôt [LIEN VERS LE REPO]. Les pages en ligne sont dans le dossier **`public/`** (ex. `public/index.html`). Merci de **ne pas** modifier les fichiers de secrets (`.env`) ni le backend (`server.js`) sans accord préalable. Chaque commit sur la branche **`main`** déclenche un déploiement automatique sur Vercel.

2. **Google Search Console** : invitation envoyée à [EMAIL] en tant que [rôle : propriétaire / complet].

3. **Domaine canonique** : `https://www.carvinguard.fr` — merci d’aligner canonicals et `og:url` sur ce choix.

Pour lister toutes les pages HTML concernées : commande `npm run seo:pages` en local après clone, ou parcourir `public/` sur GitHub.

Cordialement,

---

## 8. Checklist propriétaire (résumé)

| Étape | Où | Action |
|--------|-----|--------|
| 1 | GitHub | Inviter l’agence → rôle **Write** sur le bon dépôt |
| 2 | GitHub | Confirmer que Vercel est branché sur ce dépôt / `main` |
| 3 | Google Search Console | Propriété vérifiée + ajout utilisateur agence |
| 4 | (Option) Vercel | Inviter l’agence en **Developer** |
| 5 | (Option) GitHub | Protection de branche `main` + PR obligatoires |
| 6 | E-mail / appel | Rappeler : éditer **`public/`** uniquement pour le site prod |

Une fois ces étapes faites, l’agence peut **tout faire elle-même** côté contenu SEO dans les HTML, comme si elle avait les fichiers sur un hébergement classique, avec l’avantage du **historique Git** et des **déploiements automatiques**.
