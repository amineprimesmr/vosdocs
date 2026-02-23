# Guide complet : Google Analytics, Search Console, SEO – A à Z

**Objectif :** optimisation SEO maximale et suivi complet de vosdocs.fr.

---

## PARTIE 1 – Google Search Console (déjà commencé)

### Ce que tu as déjà fait
- Propriété domaine **vosdocs.fr** vérifiée (DNS TXT).

### À faire tout de suite

1. **Soumettre le sitemap**
   - Search Console → **Indexation** → **Sitemaps**.
   - Nouveau sitemap : `https://www.vosdocs.fr/sitemap.xml`
   - Cliquer sur **Envoyer**.

2. **Demander l’indexation des pages importantes**
   - En haut : **Inspection d’URL**.
   - Tester et demander l’indexation pour :
     - `https://www.vosdocs.fr/`
     - `https://www.vosdocs.fr/index.html`
     - `https://www.vosdocs.fr/contact.html`
     - `https://www.vosdocs.fr/aide.html`
     - `https://www.vosdocs.fr/demarches.html`
   - Pour chaque URL : **Demander une indexation**.

3. **Comprendre les pages non indexées**
   - **Indexation** → **Pages** → **Pourquoi les pages ne sont pas indexées**.
   - Corriger les erreurs (URL en double, redirections, etc.).

4. **Vérifier la couverture**
   - Après quelques jours : **Indexation** → **Pages**.
   - Objectif : voir des pages passer en « Indexées ».

---

## PARTIE 2 – Google Analytics 4 (GA4)

### Étape 1 : Créer un compte GA4

1. Va sur [analytics.google.com](https://analytics.google.com).
2. Connecte-toi avec le compte Google de VosDocs.
3. **Admin** (engrenage en bas à gauche) → **Créer un compte**.
   - Nom du compte : `VosDocs` (ou ce que tu veux).
4. **Créer une propriété** :
   - Nom : `VosDocs.fr` ou `Site VosDocs`.
   - Fuseau : France.
   - Devise : Euro (EUR).
5. **Détails du site** :
   - URL : `https://www.vosdocs.fr`
   - Nom du flux : `Site web principal`.
   - Créer un flux **Web**.
6. Tu obtiens un **ID de mesure** du type : `G-XXXXXXXXXX`.

### Étape 2 : Brancher GA4 sur le site

Le site est déjà prêt pour GA4. Il suffit de :

1. Ouvrir le fichier **`public/js/analytics.js`**.
2. Remplacer `G-XXXXXXXXXX` par ton vrai **ID de mesure** (ex. `G-A1B2C3D4E5`).
3. Déployer le site (push Git → Vercel).

Après déploiement, les visites seront enregistrées dans GA4 (délai possible 24–48 h).

### Étape 3 : Configurations utiles dans GA4

- **Objectifs (conversions)** : marquer comme conversion « Début du paiement » ou « Paiement réussi » si tu veux suivre les commandes.
- **Exploration** : utiliser les rapports **Acquisition** (d’où viennent les visiteurs) et **Engagement** (pages vues, durée).
- **Liens avec Search Console** : dans GA4, **Admin** → **Liens** → **Search Console** → associer la propriété vosdocs.fr pour voir les requêtes dans GA4.

---

## PARTIE 3 – Lier Search Console et GA4

1. Dans **GA4** : **Admin** → **Liens** (colonne Propriété).
2. **Liens Search Console** → **Lier**.
3. Choisir le compte et la propriété **vosdocs.fr**.
4. Valider.

Résultat : dans GA4, tu pourras voir une partie des requêtes Google qui amènent du trafic (données dans **Acquisition** / rapports liés à la recherche).

---

## PARTIE 4 – Google Business Profile (si tu as une adresse)

Si VosDocs a une adresse physique ou un local :

1. [business.google.com](https://business.google.com) → **Gérer maintenant**.
2. Créer / revendiquer la fiche pour ton activité.
3. Renseigner : adresse, téléphone (ex. 07 98 63 78 31), site (vosdocs.fr), horaires.
4. Choisir une catégorie (ex. « Service administratif » ou proche).
5. Valider la fiche (courrier, téléphone ou email selon ce que Google propose).

Ça améliore la visibilité en recherche locale et sur Google Maps.

---

## PARTIE 5 – Google Tag Manager (optionnel mais pratique)

Utile si plus tard tu ajoutes d’autres outils (publicité, remarketing, etc.) sans retoucher le code à chaque fois.

1. [tagmanager.google.com](https://tagmanager.google.com) → Créer un compte.
2. Créer un **conteneur** pour **Web** → URL : `https://www.vosdocs.fr`.
3. Tu reçois deux extraits de code (un pour le `<head>`, un pour le `<body>`).
4. Dans GTM, ajouter une **balise** de type **Google Analytics : GA4** et y coller ton ID de mesure GA4.
5. Déclencher la balise sur **All Pages**.
6. Remplacer le script GA4 actuel du site par les deux codes GTM (et désactiver l’ancien script GA4 dans le code pour éviter le double comptage).

On peut le faire plus tard ; pour l’instant GA4 direct suffit.

---

## PARTIE 6 – SEO : checklist technique (déjà en place sur vosdocs.fr)

| Élément | Statut |
|--------|--------|
| Balises title uniques | OK |
| Meta description par page | OK |
| Balises canonical | OK |
| Open Graph (réseaux sociaux) | OK |
| Twitter Cards | OK |
| Schema.org (Organization, Product, FAQ) | OK sur l’accueil |
| Sitemap XML | OK |
| robots.txt | OK |
| HTTPS | À vérifier sur l’hébergement |
| Vitesse / mobile | À surveiller (Core Web Vitals dans Search Console) |

---

## PARTIE 7 – Suivi et objectifs

### Chaque semaine (5 min)
- Search Console : **Performances** (clics, impressions, requêtes).
- Search Console : **Indexation** → **Pages** (évolution des indexées / non indexées).

### Chaque mois
- GA4 : **Acquisition** (trafic, canaux : organique, direct, etc.).
- GA4 : **Engagement** (pages vues, écrans les plus vus).
- Search Console : **Expérience** → **Core Web Vitals** (mobile / desktop).

### Objectifs à suivre
- Nombre de **pages indexées** (objectif : toutes les pages utiles).
- **Clics** et **impressions** en recherche (tendance à la hausse).
- **Conversions** dans GA4 (ex. démarrage ou finalisation du paiement).

---

## PARTIE 8 – Ordre d’action recommandé (résumé)

1. **Aujourd’hui**
   - Search Console : soumettre le sitemap.
   - Search Console : demander l’indexation des 5–6 URLs principales.
   - Créer la propriété GA4 et récupérer l’ID `G-XXXXXXXXXX`.
   - Remplacer l’ID dans `public/js/analytics.js`, puis déployer.

2. **Cette semaine**
   - Vérifier dans Search Console que les pages passent en « Indexées ».
   - Lier Search Console à GA4.
   - Vérifier dans GA4 que le trafic apparaît (après quelques visites).

3. **Ensuite**
   - Corriger les pages non indexées si besoin.
   - Mettre en place une vraie image **og-image** 1200×630 si pas encore fait.
   - Optionnel : Google Business Profile, puis Google Tag Manager.

---

## Fichiers importants sur le projet

- **Sitemap** : `public/sitemap.xml`
- **Robots** : `public/robots.txt`
- **Analytics** : `public/js/analytics.js` (remplacer `G-XXXXXXXXXX` par ton ID GA4)
- **Config SEO** : `public/js/seo-config.js`
- **Audit SEO** : `AUDIT-SEO.md`

Si tu me donnes ton **ID de mesure GA4** (G-…), je peux te confirmer exactement quoi mettre dans `analytics.js` et où.
