# Blog Carvinguard – Organisation et publication

Le blog est généré à partir de fichiers JSON. Les pages sont créées dans `public/blog/`.

---

## Fichiers

| Fichier | Rôle |
|--------|------|
| **blog-config.json** | Titre, sous-titre, catégories, SEO de la page d’accueil du blog. |
| **blog-articles.json** | Liste des **articles publiés** (affichés sur le site). |
| **blog-calendar.json** | File d’articles **à publier** : le workflow « tous les 3 jours » en prend un, le met dans `blog-articles.json` avec la date du jour, puis régénère le blog. |

---

## Catégories (blog-config.json)

- `certificat-non-gage` → Certificat de non-gage  
- `carte-grise` → Carte grise  
- `vente-vehicule` → Vente de véhicule  
- `achat-occasion` → Achat d'occasion  
- `demarches` → Démarches administratives  
- `documents` → Documents véhicule  

Tu peux en ajouter en modifiant `blog-config.json` (clé `categories`).

---

## Ajouter un article (manuel)

1. Éditer **blog-articles.json**.
2. Ajouter un objet en **premier** dans le tableau (pour qu’il soit le plus récent) :

```json
{
  "id": "4",
  "slug": "mon-nouvel-article",
  "title": "Titre de l’article",
  "description": "Résumé court pour SEO et cartes (150–160 caractères).",
  "date": "2026-03-01",
  "category": "certificat-non-gage",
  "keywords": ["mot-clé 1", "mot-clé 2"],
  "readingTime": "4 min",
  "bodyHtml": "<p>Contenu en HTML…</p><h2>Sous-titre</h2><p>…</p>"
}
```

3. Lancer la génération :  
   `npm run blog`

---

## Programmer une publication (calendrier)

1. Éditer **blog-calendar.json**.
2. Ajouter un objet à la **fin** du tableau (il sera publié après les autres) :

```json
{
  "slug": "futur-article",
  "title": "Titre prévu",
  "description": "Description pour SEO.",
  "category": "vente-vehicule",
  "keywords": ["vente", "voiture"],
  "readingTime": "5 min",
  "bodyHtml": "<p>Contenu complet en HTML…</p>"
}
```

Tous les **3 jours**, le workflow GitHub Actions exécute `publish-next-blog.js` : il déplace le **premier** article du calendrier vers `blog-articles.json` (avec la date du jour), régénère le blog et pousse le commit.

---

## Commandes

- **Générer le blog** (après modification de `blog-articles.json`) :  
  `npm run blog`
- **Publier le prochain article du calendrier** (date du jour + génération) :  
  `npm run blog:publish`

---

## Structure d’un article

- **slug** : identifiant URL (`slug.html`). Sans espaces, sans accents (ou slugifié).  
- **title** : titre affiché et utilisé dans le `<title>` et les partages.  
- **description** : meta description et aperçu (liste, cartes).  
- **date** : au format `AAAA-MM-JJ`.  
- **category** : une des clés de `blog-config.json` → `categories`.  
- **bodyHtml** : corps de l’article en **HTML** (paragraphes `<p>`, titres `<h2>`, listes `<ul>/<li>`, liens `<a href="…">`).  

Les pages générées incluent : fil d’Ariane, catégorie, date, temps de lecture, CTA « Obtenir mon certificat », articles similaires et balises SEO / schema Article.
