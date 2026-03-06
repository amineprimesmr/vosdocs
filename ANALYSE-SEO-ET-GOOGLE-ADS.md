# Analyse A–Z : Données structurées (avis) + Google Ads

Ce document explique le problème « Extraits d'avis » corrigé et comment tout tester pour lancer des annonces Google Ads sereinement.

---

## 1. Ce que Google vous a signalé

**Alerte Search Console :** « Données structurées – Extraits d'avis »  
**Erreur critique :** « Type d'objet non valide pour le champ &lt;parent_node&gt; »

### Cause identifiée

Sur la page d'accueil, les **avis (étoiles)** étaient décrits en JSON-LD avec un **AggregateRating** placé dans un objet de type **Service**.

Pour afficher les étoiles dans les résultats de recherche, Google n'accepte l'AggregateRating que dans certains types de « parent » : **Product**, **LocalBusiness**, **Recipe**, etc. Le type **Service** n’est pas pris en charge (ou plus) pour les extraits d’avis, d’où l’erreur sur le « parent_node ».

Conséquences possibles :
- Pas d’étoiles (4,6 / 5) dans les résultats Google.
- Page ou fonctionnalité considérées comme invalides, ce qui peut dégrader la confiance du site et indirectement l’environnement des campagnes Google Ads (qualité de la page de destination).

---

## 2. Correction appliquée

Dans **index.html** et **public/index.html** :

| Avant | Après |
|-------|--------|
| `"@type": "Service"` avec `aggregateRating` | `"@type": "Product"` avec `aggregateRating` |
| `"@id": "https://www.vosdocs.fr/#service"` | `"@id": "https://www.vosdocs.fr/#product"` |
| `"reviewCount": "32000"` (chaîne) | `"reviewCount": 32000` (nombre) |
| `"bestRating": "5"`, `"worstRating": "1"` | `"bestRating": 5`, `"worstRating": 1` (nombres) |
| Propriété `provider` (spécifique Service) | Supprimée (Product n’en a pas besoin) |

Résultat : l’AggregateRating a maintenant un **parent de type Product**, accepté par Google pour les extraits d’avis. Les champs numériques sont en nombre, ce qui respecte mieux le schéma.

---

## 3. Comment tester que tout est réglé

### Étape 1 – Tester les données structurées (Rich Results)

1. Déployer le site avec les corrections.
2. Aller sur : [Google Rich Results Test](https://search.google.com/test/rich-results).
3. Saisir l’URL de la page d’accueil : `https://www.vosdocs.fr/` (ou `https://www.vosdocs.fr/index.html` si elle ne redirige pas).
4. Lancer le test.
5. Vérifier qu’il n’y a **plus d’erreur** sur « Review snippet » / « Extraits d’avis » et que le type détecté pour l’entité contenant l’avis est bien **Product** (ou équivalent).

Si le test est vert pour les avis, la structure est correcte côté Google.

### Étape 2 – Search Console (validation de la correction)

1. [Google Search Console](https://search.google.com/search-console) → propriété **www.vosdocs.fr**.
2. Menu **Améliorations** (ou **Expérience**) → **Données structurées** / **Extraits d’avis** (selon l’interface).
3. Ouvrir le rapport qui montrait l’erreur « Type d’objet non valide pour le champ &lt;parent_node&gt; ».
4. Cliquer sur **« Valider la correction »** (ou « Demander une réindexation » / « Tester l’URL en direct » selon les options proposées).
5. Attendre quelques jours : Google re-crawle et l’erreur doit disparaître du rapport.

Cela confirme que la correction est bien prise en compte par Search Console.

### Étape 3 – Vérifier la page de destination pour Google Ads

Pour que les annonces fonctionnent correctement, la **page d’accueil** (ou la page cible de vos annonces) doit être :

- **Accessible** : pas de 404, pas de redirection bizarre.
- **Conforme** : pas de contenu trompeur, politique de confidentialité et infos légales accessibles (mentions, CGV, etc.).
- **Techniquement saine** : pas d’erreurs bloquantes (dont données structurées invalides).

Checklist rapide :

- [ ] Ouvrir `https://www.vosdocs.fr/` en navigation privée : la page s’affiche correctement.
- [ ] Pas de message d’erreur dans la console du navigateur (F12).
- [ ] Liens « Obtenir mon certificat », « Contact », « Mentions légales » fonctionnent.
- [ ] Données structurées : test Rich Results OK (étape 1).
- [ ] Search Console : validation de la correction demandée (étape 2).

### Étape 4 – Tester la balise Google Ads (conversions / remarketing)

1. [Google Ads](https://ads.google.com) → Outils → **Mesure** → **Conversions** (et éventuellement **Audiences** pour le remarketing).
2. Vérifier que la balise **gtag (AW-17972633421)** est bien installée (déjà fait sur le site).
3. Utiliser l’outil **« Tester la connexion »** ou **« Vérifier la balise »** proposé dans Google Ads pour l’URL de la page d’accueil.
4. S’assurer que le **conversion tracking** (et le remarketing si utilisé) sont actifs et détectés.

Si la connexion est OK, les annonces peuvent envoyer du trafic vers une page techniquement et structurellement correcte.

---

## 4. Pourquoi « ça ne marchait pas » pour les ads – vue d’ensemble

Les annonces Google Ads peuvent être refusées ou mal notées pour plusieurs raisons. Voici les points qui ont été traités ou à surveiller :

| Point | Statut | Impact sur les ads |
|-------|--------|---------------------|
| **Données structurées (avis) invalides** | Corrigé (Product + champs numériques) | Améliore la « compréhension » du site par Google et la qualité perçue de la page de destination. |
| **Balise Google Ads (AW-17972633421)** | Installée sur les pages | Nécessaire pour les conversions et le remarketing. |
| **Indexation (404, 403, noindex, redirections)** | Déjà traité (sitemap, robots, canonical) | Un site bien indexé et sans erreurs renforce la cohérence du domaine. |
| **Contenu de la page** | À garder clair, honnête, conforme | Évite les refus pour « expérience utilisateur » ou « contenu ». |
| **Politique / CGV / Contact** | Déjà présents sur le site | Souvent exigés par les politiques Google Ads. |

En résumé : l’erreur « Extraits d’avis » est **corrigée**. En validant la correction dans Search Console et en testant la balise dans Google Ads, vous mettez toutes les chances de votre côté pour que les annonces puissent tourner correctement.

---

## 5. Récap des actions à faire de ton côté

1. **Déployer** les derniers changements (index avec schéma Product + AggregateRating en nombres).
2. **Tester** l’URL de la page d’accueil dans [Rich Results Test](https://search.google.com/test/rich-results) et confirmer qu’il n’y a plus d’erreur sur les avis.
3. Dans **Search Console**, demander la **validation de la correction** pour les données structurées « Extraits d’avis ».
4. Dans **Google Ads**, lancer **« Tester la connexion »** (ou équivalent) pour la balise sur la page d’accueil.
5. Si tout est vert, **créer ou reprendre une campagne** en ciblant l’URL `https://www.vosdocs.fr/` (ou la page de destination choisie).

Si après tout ça une campagne est encore refusée, le message de refus dans Google Ads (e-mail ou dans l’interface) indiquera la raison précise (ex. « Expérience de la page de destination », « Contenu », « Compte ») à traiter en priorité.
