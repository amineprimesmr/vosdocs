# Audit d'adaptation au Maroc — 27 septembre 2026

## Conclusion

`/ma` est une entrée de secours vers le site français, pas une version localisée. Le français peut être conservé ; contenu, données, offre et parcours doivent être adaptés séparément. Aucune modification commerciale ni publication supplémentaire pendant cet audit.

## Constats

- `vercel.json` réécrit `/ma` vers `/index.html`. Les pages de rapport, paiement et compte utilisent les routes communes à la racine ; aucun contexte Maroc n'est transmis par cette règle.
- Accueil : partenaire français de carte grise, logos de médias français, référence à service-public.fr, téléphone français et mentions Carvinguard.fr. Le champ VIN parle de « carte grise, zone E » sans vérification pour le document marocain.
- Les chiffres « 1 million+ », « 32 000 avis » et notes divergentes 4,75 / 4,5 ne sont pas étayés par une preuve dans les fichiers inspectés. Le lien Trustpilot pointe vers sa page générique.
- Tarifs en EUR : 14,99 / 29,99 / 69,99 ; abonnement 1 EUR puis 49,99 EUR après 24 heures. Le backend vérifie et utilise EUR ; remplacer seulement le symbole par MAD serait incorrect. Aucun parcours de paiement marocain de bout en bout testé.
- `lib/carapi-client.js:271` utilise FR par défaut ; le parcours dashboard n'ajoute pas de contexte MA. Les inspections interrogent SK. Les données éventuelles d'un véhicule importé restent celles des pays sources, pas une preuve de couverture locale.
- Le fournisseur intégré est CarAPI.dev (distinct de carapi.app). Son OpenAPI actuel exclut MA de la cote (24 pays) et du décodage de plaque (PL, NO, SK, SE, CZ, US). Le contrôle vol décrit cinq pays européens ; les inspections sont documentées pour SK/CZ. Le test Honda Accord américain ne valide pas les véhicules marocains.
- CGV : assistance administrative, accès illimité, abonnement 49 EUR ; la page commerciale décrit décodage VIN, 7 rapports et 49,99 EUR. La FAQ évoque traitement par opératrices et email, à rapprocher du parcours automatique réel.
- Les mentions légales désignent StarkX LLC aux États-Unis, et font référence au droit français. Les pages doivent refléter l'exploitant réel et les marchés visés ; aucune identité de société marocaine ne doit être inventée. La conformité locale n'a pas été certifiée par cet audit technique.
- SEO : canonique français, pas de pages locales distinctes ; /ma est volontairement noindex pour ce secours.

## Priorités proposées

1. Pour une présentation : français orienté acheteurs au Maroc, numéro de châssis/VIN, véhicules d'occasion et importés ; retirer les références françaises non pertinentes et les preuves marketing non justifiées.
2. Conserver un contexte Maroc dans les pages, API et rapports. Marquer la couverture par pays/source et masquer les blocs sans couverture pertinente. Ne pas convertir une cote française en dirhams pour la présenter comme une cote marocaine.
3. Confirmer avec le fournisseur la couverture et tester un échantillon autorisé de véhicules effectivement vendus au Maroc, avec cas sans résultat et remboursement de crédit.
4. Choisir les vrais prix et la devise de facturation, puis aligner catalogue Stripe, pages, reçus et CGV. Une conversion indicative doit être distinguée du montant débité.
5. Vérifier l'identité du vendeur, les conditions réelles et les obligations applicables avant lancement commercial local.

## Sources fournisseur consultées

- https://api.carapi.dev/openapi.json
- https://docs.carapi.dev/endpoints/vehicle-valuation
- https://docs.carapi.dev/endpoints/plate-to-vin
- https://docs.carapi.dev/endpoints/vin-decode

## Version Maroc publiée après l’audit

Déploiement final : `dpl_3DNFtUwZaJ2GhjpAZDcFurkzrwEe`, URL technique `https://vosdocs-klp4dk0wt-amines-projects-00de692e.vercel.app`. Accès public : https://www.carvinguard.fr/ma/.

- 13 pages générées par `scripts/build-morocco.js`. Sources éditoriales dans `content/morocco/`; pages de compte/paiement issues des pages existantes avec chemins adaptés. `npm run build` régénère la version Maroc.
- Accueil, aide, contact, mentions, CGV, confidentialité et aperçu VIN dédiés. Suppression des avis/chiffres non justifiés et références aux démarches françaises sur les pages Maroc. Pas de balises publicitaires héritées sur ces pages.
- Parcours sous `/ma/`, API sous `/api/ma/`. Middleware explicite : `req.market=MA`. Le premier essai `/ma/api/` ne conservait pas le chemin dans Vercel ; il a été remplacé avant publication.
- Retours Stripe et emails d’activation/récupération conservent `/ma`. Métadonnées de session et PaymentIntent conservent l’origine approuvée, y compris pour les commandes couvertes par promotion.
- Pour les rapports CarAPI au contexte MA, aucune requête de cote/annonces, inspection SK, vol européen ou simulation financière par défaut. Ces blocs indiquent leur indisponibilité ; les données VIN, photos et relevés disponibles peuvent toujours provenir de sources étrangères. Mention de couverture ajoutée au PDF d’un rapport MA.
- Prix EUR existants conservés faute de nouveaux prix fournis. Le site annonce explicitement EUR et les éventuels frais/conversion bancaires. Aucun faux tarif MAD ni contact local inventé. Les CGV Maroc décrivent les packs et l’abonnement actuels, au lieu de l’ancienne offre illimitée.
- 30 tests passent (dont origines MA, conservation des retours/métadonnées Stripe, exclusion des endpoints sans couverture Maroc), plus Prisma et syntaxe. 28 contrôles HTTP FR/MA passent sur la première publication complète ; après le dernier changement limité à l’aperçu HTML, son contenu publié et son rendu dans le navigateur ont été recontrôlés.
- Accueil et tarifs vérifiés à 390 px sans débordement horizontal. Recherche réelle du VIN de test → identité Honda Accord 2003 → tarifs → Stripe 14,99 EUR ; lien de retour Stripe vers `/ma/checkout.html` vérifié. Une session Checkout non payée a été créée pour ce contrôle. Aucun débit, email client ou nouvelle inscription effectué.
- L’accueil français est identique au fichier de production précédent lors du contrôle par comparaison binaire.

### Limites encore réelles

L’adaptation du site ne crée pas une source de données marocaines. Aucun historique officiel marocain ni couverture exhaustive n’est disponible/validé. Il reste à choisir une éventuelle facturation MAD, à valider l’offre avec l’exploitant et les obligations locales (notamment données/transferts), et à réaliser un achat de bout en bout avec livraison en environnement Stripe de test. La validation du domaine .ma est toujours indépendante et en attente du registrar. La version /ma reste noindex pendant cette phase.
