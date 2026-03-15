# Carvinguard - Guide SEO Complet

Toutes les optimisations SEO ont été implémentées sur le site. Ce document récapitule ce qui a été fait et ce que vous devez personnaliser avant mise en production.

## ✅ Implémenté

### Balises meta
- **Title** unique par page avec mots-clés
- **Meta description** (150-160 caractères) sur chaque page
- **Meta keywords** (page d'accueil)
- **Meta robots** (index/follow sur accueil, noindex sur checkout)
- **Canonical URL** sur toutes les pages
- **Geo.region** FR pour ciblage France

### Open Graph (réseaux sociaux)
- og:type, og:url, og:title, og:description
- og:image, og:locale, og:site_name

### Twitter Cards
- summary_large_image
- title, description, image

### Schema.org JSON-LD
- **Organization** : nom, logo, contact (téléphone, horaires)
- **Product** : certificat non-gage, prix 19,90€, avis (4.6/5)
- **WebPage** : URL, breadcrumb
- **FAQPage** : 3 questions fréquentes
- **BreadcrumbList** : Carte Grise > Démarches > Certificat non-gage

### Structure HTML
- Balise `<main>` pour le contenu principal
- Hiérarchie H1 > H2 > H3 correcte
- Attributs aria-labelledby pour accessibilité
- Breadcrumb avec microdonnées

### Fichiers techniques
- **sitemap.xml** : toutes les pages
- **robots.txt** : Allow / + Sitemap
- **favicon.svg** : icône du site

### Pages additionnelles
- **mentions-legales.html** : page obligatoire pour le SEO

## 📋 À personnaliser avant mise en ligne

### 1. URLs et domaine
Remplacer `https://www.carvinguard.fr` par votre domaine réel dans :
- Tous les `<link rel="canonical">`
- sitemap.xml
- robots.txt
- Meta Open Graph et Twitter
- Schema JSON-LD

### 2. Images
- **og-image.png** : créer une image 1200x630px pour les partages (réseaux sociaux)
- **logo.png** : logo de l'entreprise pour le Schema
- Placer dans la racine du site

### 3. Mentions légales
Compléter `mentions-legales.html` avec :
- Raison sociale exacte
- Adresse du siège
- Nom de l'hébergeur
- SIRET si applicable

### 4. Google Search Console
1. Créer un compte sur [search.google.com/search-console](https://search.google.com/search-console)
2. Ajouter la propriété (votre domaine)
3. Soumettre le sitemap : `https://votredomaine.com/sitemap.xml`
4. Vérifier l'indexation

### 5. Google Business Profile
Si vous avez une adresse physique :
- Créer une fiche sur [business.google.com](https://business.google.com)
- Ajouter horaires, téléphone, photos

## Mots-clés ciblés

- certificat de non-gage
- certificat situation administrative
- non gage voiture
- CSA véhicule
- vente voiture occasion
- carte grise
- document officiel véhicule

## Checklist avant lancement

- [ ] Domaine configuré
- [ ] HTTPS activé (certificat SSL)
- [ ] og-image.png créée
- [ ] Mentions légales complétées
- [ ] Sitemap soumis à Google
- [ ] Search Console configurée
