# Analysis Power Intelligence Engine

## Objectif

Le moteur autonome doit produire une explication utile sans obliger l’utilisateur à savoir quelle analyse lancer. Il suit la chaîne :

**Observation → comparaison → détection → attribution → hypothèses → confiance → action.**

## Comparaison principale

La date de référence est la dernière date exploitable de l’extraction. Si la dernière journée semble partielle, elle est écartée du diagnostic comparatif. La longueur de fenêtre est choisie automatiquement selon l’historique disponible.

### Décomposition du CA

Pour deux périodes A (courante) et B (précédente) :

`CA = Tickets × Panier moyen`

La variation est décomposée exactement en :

- effet fréquentation = `(Tickets A - Tickets B) × Panier B` ;
- effet panier = `Tickets A × (Panier A - Panier B)`.

La somme des deux effets est égale à la variation du CA, à l’arrondi près.

## Attribution des variations

Le moteur calcule ensuite les contributions par :

- rayon ;
- famille ;
- produit ;
- jour de semaine normalisé par nombre réel de jours ;
- vendeur, en lecture brute uniquement ;
- clients présents/absents entre périodes.

Une contribution est un calcul exact. Une cause métier éventuelle reste une hypothèse.

## Hypothèses explicatives

### Stock

Un produit en recul et actuellement à stock nul, négatif ou critique génère un signal. Le stock courant ne prouve pas qu’une rupture existait au moment exact de la baisse ; l’hypothèse est donc étiquetée comme telle.

### Prix / volume

Une hausse du prix unitaire moyen accompagnée d’une baisse sensible des quantités peut produire un signal de sensibilité prix. Il ne s’agit pas d’une preuve causale.

### Migration produit

Pour une référence en recul, le moteur recherche si les acheteurs de la période précédente achètent maintenant une autre référence de la même famille. Une migration importante est présentée comme une explication possible.

### Client

Le risque de décrochage compare les jours depuis la dernière visite à l’intervalle médian propre au client. Il exige un minimum d’historique et ne classe pas tous les clients selon un seuil fixe de type « 90 jours ».

### Vacances scolaires

Clermont-Ferrand relève de la Zone A dans le calendrier intégré. Les résultats vacances / hors vacances sont normalisés par jours actifs. Le calendrier peut être un facteur associé mais n’est jamais traité comme cause unique.

### Anomalies quotidiennes

Une journée récente est comparée aux mêmes jours de semaine observés récemment. Le moteur utilise médiane et MAD pour limiter l’influence des valeurs extrêmes.

## Confiance

- 100 % : calcul déterministe à partir des données disponibles ;
- 75–99 % : signal fortement étayé mais comportant une composante inférentielle ;
- 55–74 % : hypothèse plausible nécessitant prudence ;
- <55 % : information faible, normalement non prioritaire.

Un pourcentage de confiance n’est pas une probabilité scientifique universelle : c’est un indicateur interne d’explicabilité et de solidité des éléments utilisés.

## Indice de pilotage

L’indice de pilotage synthétise tendance CA, marge, valeur historique des clients à risque, tension stock et couverture des données. C’est un **score de tri et de vigilance**, pas un indicateur comptable certifié.

## Questions locales

Le champ « Demander à Analysis Power » ne contacte aucune IA distante. Il reconnaît des intentions métier et reformule les diagnostics déjà calculés, avec leurs preuves et niveaux de confiance.

## Principe de non-invention

Si une donnée manque :

- elle est exclue de la conclusion correspondante ;
- la couverture est indiquée ;
- le moteur continue les analyses indépendantes lorsque cela est possible ;
- une contradiction forte peut bloquer tout le croisement.
