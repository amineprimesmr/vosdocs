# Comment vérifier l’indexation et le SEO (VosDocs)

Checklist pour vérifier que tout est correct après les corrections Search Console (sitemap, robots, redirections, noindex).

---

## 1. Vérifier en local (fichiers du projet)

| Vérification | Où regarder | Attendu |
|--------------|-------------|---------|
| **robots.txt** | `public/robots.txt` | `Disallow: /api/` présent, `Sitemap: https://www.vosdocs.fr/sitemap.xml` |
| **Sitemap** | `public/sitemap.xml` | Une seule URL d’accueil (`https://www.vosdocs.fr/`), **pas** de `index.html`, **pas** de `recapitulatif.html` ni `checkout.html` |
| **Page d’accueil** | `public/index.html` | `canonical` et `og:url` = `https://www.vosdocs.fr/` (sans `index.html`) |
| **Redirection** | `vercel.json` | `"source": "/index.html"` → `"destination": "/"`, `"permanent": true` |
| **Pages noindex** | checkout, recapitulatif, confirmation, 404 | Chacune a `<meta name="robots" content="noindex, follow">` |

---

## 2. Vérifier en production (après déploiement)

Ouvre ces URLs dans le navigateur (en remplaçant par ton domaine si différent) :

| URL | Ce qu’il faut vérifier |
|-----|-------------------------|
| `https://www.vosdocs.fr/robots.txt` | Texte avec `Disallow: /api/` et `Sitemap: https://www.vosdocs.fr/sitemap.xml` |
| `https://www.vosdocs.fr/sitemap.xml` | Liste d’URLs sans `recapitulatif`, sans `checkout`, une seule entrée pour l’accueil (`/`) |
| `https://www.vosdocs.fr/` | Page d’accueil s’affiche (pas d’erreur 404) |
| `https://www.vosdocs.fr/index.html` | Redirection automatique vers `https://www.vosdocs.fr/` (URL dans la barre d’adresse devient `/`) |

Pour la redirection : ouvre `https://www.vosdocs.fr/index.html` → tu dois finir sur `https://www.vosdocs.fr/` (sans `index.html`).

---

## 3. Vérifier dans Google Search Console

1. Va sur [Google Search Console](https://search.google.com/search-console).
2. Sélectionne la propriété **www.vosdocs.fr** (ou celle que tu utilises).
3. **Rapport « Couverture » / « Pages » (indexation)**
   - Menu : **Indexation** → **Pages** (ou **Couverture** selon l’interface).
   - Tu verras les motifs : « Introuvable (404) », « Bloquée (403) », « Page avec redirection », « Exclue par noindex ».
   - Clique sur chaque motif pour voir **la liste des URLs concernées**.
4. **Ce qui est normal après les corrections**
   - **Page avec redirection** : peut encore afficher `/index.html` quelques temps ; après crawl, ça doit diminuer.
   - **Exclue par noindex** : checkout, récap, confirmation, 404 peuvent encore apparaître (Google les a en base) ; ils ne doivent plus être dans le sitemap.
   - **403 / 404** : les URLs sous `/api/...` devraient disparaître du rapport une fois que Google respecte le `Disallow: /api/` (attendre quelques jours).
5. **Tester une URL**
   - Menu **Inspection d’URL**.
   - Saisis `https://www.vosdocs.fr/` → « Tester l’URL en direct » pour voir si Google peut indexer la page.
6. **Soumettre le sitemap**
   - **Sitemaps** : vérifier que `https://www.vosdocs.fr/sitemap.xml` est bien envoyé et sans erreur.

---

## 4. Vérifier que les URLs du sitemap existent

Toutes les URLs listées dans `sitemap.xml` doivent correspondre à des pages qui existent (pas de 404). En local, tu peux vérifier que chaque fichier existe dans `public/` :

- `conditions-generales-vente.html`
- `conditions-generales-utilisation.html`
- `politique-confidentialite.html`
- `contact.html`, `aide.html`, `carte-grise.html`, `demarches.html`
- `prix-carte-grise.html`, `prix-cheval-fiscal.html`, `papiers.html`
- `mentions-legales.html`, `guides.html`
- et les guides (certificat-non-gage-obligatoire, vendre-voiture-documents-obligatoires, etc.)

Si une URL du sitemap renvoie 404 en production, il faut soit créer la page soit la retirer du sitemap.

---

## 5. Résumé rapide

- **Code** : robots.txt avec `Disallow: /api/`, sitemap sans doublon accueil et sans pages noindex, canonical/og:url sur `/`, redirection 301 `/index.html` → `/`.
- **Production** : ouvrir `robots.txt`, `sitemap.xml`, `/`, `/index.html` (doit rediriger).
- **Search Console** : rapport d’indexation pour voir les URLs en 404/403/redirection/noindex, inspection d’URL sur `/`, sitemap soumis et valide.

Les effets complets dans Search Console peuvent prendre quelques jours après déploiement et re-crawl.
