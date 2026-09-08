# Local Context Sentinel — architecture

## But

Apporter à Geo Intelligence un contexte public fiable sans jamais transmettre les données Clients/Ventes/Catalogue.

## Chaîne de priorité

1. Explore API v2.1 Clermont Auvergne Métropole.
2. Auto-discovery du catalogue Open Data.
3. Jeux structurants connus : parking, Base Adresse Locale, axes de voie.
4. Jeux travaux/circulation/mobilité détectés dynamiquement.
5. Pages officielles travaux comme source de complément/secours.
6. Open-Meteo.
7. Dernier contexte valide si une source tombe.

## API

Base : `https://opendata.clermontmetropole.eu/api/explore/v2.1`

Le connecteur utilise uniquement des requêtes GET publiques.

### Catalogue

`GET /catalog/datasets`

Le script parcourt le catalogue et attribue un score de pertinence aux titres/descriptions contenant des termes comme travaux, chantier, circulation, voirie, route, stationnement, mobilité, déviation ou InspiRe. Les jeux manifestement liés aux marchés publics/budgets sont pénalisés afin de limiter les faux positifs.

### Jeux connus

Le script privilégie les identifiants connus, puis tente une résolution dynamique par titre/description si l’identifiant disparaît :

- stationnement ;
- Base Adresse Locale ;
- axes de voie.

### Stationnement

Le schéma est normalisé de façon défensive : le script cherche les champs nom, capacité, disponibilité, occupation, statut, date et coordonnées sans supposer un nom de colonne unique.

### Jeux travaux/mobilité futurs

Si le catalogue fait apparaître un nouveau jeu pertinent, le connecteur tente automatiquement un échantillon de records et cherche des informations d’impact : travaux, chantier, circulation, fermeture, déviation, route barrée, InspiRe.

L’absence de jeu structuré dédié aux travaux n’est pas une erreur bloquante : les pages officielles restent actives en fallback.

## Résilience

- 3 tentatives HTTP avec backoff exponentiel ;
- timeout par requête ;
- contrôle JSON ;
- contrôle du schéma du payload final ;
- écriture dans un fichier temporaire ;
- remplacement atomique uniquement après validation ;
- conservation du dernier contexte public valide en cas de panne ;
- historique synthétique externe ;
- état de santé de chaque source visible dans l’interface ;
- aucune panne externe ne bloque l’analyse commerciale locale.

## Confidentialité

Aucune adresse client n’est envoyée à l’API. La Base Adresse Locale et les axes de voie sont utilisés comme sources publiques à sens unique. Les fichiers TGM ne quittent jamais le navigateur.
