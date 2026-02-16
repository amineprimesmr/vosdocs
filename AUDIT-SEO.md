# Audit SEO VosDocs.fr - Analyse complète

**Date :** 13 février 2026  
**Site :** vosdocs.fr

---

## ✅ CE QUI EST BIEN CONFIGURÉ

### Meta tags de base (toutes les pages)
- **Title** : Présent et unique sur chaque page
- **Description** : Présente, pertinente, 150-160 caractères
- **Robots** : `index, follow` sur pages publiques, `noindex, follow` sur checkout/récap/confirmation/404
- **Canonical** : Présent sur la plupart des pages
- **Viewport** : Configuré pour mobile
- **lang="fr"** : Déclaré sur `<html>`

### Page d'accueil (index.html)
- **Open Graph** : og:type, og:url, og:title, og:description, og:image, og:locale, og:site_name
- **Twitter Card** : summary_large_image avec title, description, image
- **Schema.org JSON-LD** : Organization, Product, WebPage, FAQPage
- **Structure H1** : Un seul H1 ("Certificat de non-gage : obtention en ligne en 5 minutes !")
- **Structure H2-H3** : Hiérarchie logique

### Sitemap & robots.txt
- **sitemap.xml** : Complet, toutes les pages indexables listées
- **robots.txt** : Allow /, Sitemap déclaré

### Images
- **Logo** : Alt="VosDocs" sur toutes les images logo

### Accessibilité
- **Skip link** : "Aller au contenu" sur la page d'accueil
- **ARIA** : aria-label sur boutons, aria-expanded sur menu

---

## ⚠️ PROBLÈMES À CORRIGER

### 1. **og-image.png manquant** (CRITIQUE)
- Les balises og:image et twitter:image pointent vers `https://www.vosdocs.fr/og-image.png`
- **Ce fichier n'existe pas** → image cassée lors du partage Facebook/LinkedIn/Twitter
- **Solution** : Créer og-image.png (1200×630 px) ou utiliser logo.png en temporaire

### 2. **Canonical carte-grise.html erroné**
- Actuellement : `canonical` → index.html
- **Problème** : La page carte-grise a son propre contenu, elle doit pointer vers elle-même
- **Solution** : `canonical` → https://www.vosdocs.fr/carte-grise.html

### 3. **Canonical confirmation.html manquant**
- La page confirmation n'a pas de balise canonical
- **Solution** : Ajouter canonical vers confirmation.html

### 4. **Open Graph / Twitter absents sur les autres pages**
- Seule index.html a og:* et twitter:*
- **Pages concernées** : contact, aide, demarches, prix-carte-grise, prix-cheval-fiscal, papiers, carte-grise, mentions-legales, conditions-generales-*
- **Impact** : Partage réseaux sociaux sans image ni titre optimisé sur ces pages
- **Solution** : Ajouter og:title, og:description, og:url, og:image (optionnel) sur les pages clés

### 5. **Schema.org uniquement sur index**
- Les autres pages (contact, aide, etc.) n'ont pas de données structurées
- **Impact modéré** : Moins de rich snippets possibles
- **Recommandation** : Ajouter LocalBusiness/Organization sur contact, FAQPage sur aide

### 6. **Sitemap : doublon / et index.html**
- Les deux URLs pointent vers la même page (priority 1.0)
- **Recommandation** : Choisir une URL canonique (ex: /) et garder une seule entrée prioritaire

### 7. **404.html : pas de meta description**
- Impact faible pour une page d'erreur (noindex)

---

## 📋 BACKLINKS (hors périmètre technique)

Les backlinks ne se gèrent pas dans le code. Pour en obtenir :
- Annuaires qualité (pages jaunes, annuaires métier)
- Partenariats, presse, partenaires
- Contenu de qualité partageable
- Netlinking ciblé (sites autorité)

---

## RÉSUMÉ PRIORITÉS

| Priorité | Action | Statut |
|----------|--------|--------|
| 1 | Créer og-image.png (1200×630) ou fallback logo.png | ✅ Fait (copie logo) |
| 2 | Corriger canonical carte-grise.html | ✅ Corrigé |
| 3 | Ajouter canonical confirmation.html | ✅ Corrigé |
| 4 | Ajouter OG/Twitter sur pages clés | ✅ Fait |
| 5 | Enrichir Schema.org sur contact, aide | Optionnel (non fait) |
