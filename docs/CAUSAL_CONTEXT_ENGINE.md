# Causal Context Engine — Analysis Power

## Objectif

Le moteur contextuel ne traite plus les travaux comme un onglet séparé. Chaque diagnostic commercial généré par Analysis Power est automatiquement soumis à un test de contexte Clermont.

Chaîne générale :

`constat → segment concerné → zones contributrices → comparaison aux zones témoins → rupture temporelle → travaux compatibles → test avant/après → causes concurrentes → score contextuel → explication → action de suivi`

Le logiciel ne transforme jamais une coïncidence en preuve certaine. Le score représente une **compatibilité contextuelle**, pas une probabilité scientifique de causalité.

## Diagnostics testés automatiquement

Le moteur tente le couplage pour :

- CA global ;
- marge ;
- jours de semaine et fréquentation ;
- rayons ;
- familles ;
- produits ;
- mouvements de clientèle ;
- clients à risque ;
- retours ;
- vendeurs (avec prudence, sans planning) ;
- calendrier ;
- autres diagnostics disposant d’un échantillon suffisant.

Les diagnostics de qualité des données sont exclus car un chantier ne peut pas expliquer un conflit de données.

## Test géographique

Pour le segment étudié, le moteur calcule la variation par zone. Il mesure :

- la part de chaque zone dans le mouvement négatif ou positif ;
- la variation de cette zone ;
- la variation du reste de la clientèle ;
- l’écart zone / zones témoins ;
- l’Impact Score Geo Intelligence déjà calculé ;
- la taille d’échantillon.

Un chantier n’obtient pas un score fort uniquement parce qu’il appartient au même grand secteur Métropole. Une **affinité géographique** supplémentaire compare le lieu public du chantier au micro-secteur commercial lorsque cette précision existe.

## Test temporel

Le moteur exploite, dans l’ordre :

1. dates structurées renvoyées par une source API ;
2. dates détectées dans les textes officiels ;
3. dates de première/dernière observation de l’événement public ;
4. présence dans la fenêtre récente si aucune date exploitable n’existe.

Des fenêtres égales avant/après sont calculées lorsque l’historique le permet. Le moteur teste également la proximité d’une rupture de tendance commerciale avec un démarrage ou une fin de chantier.

## Baisse et rebond

Pour un diagnostic négatif, le moteur privilégie le **début** du chantier ou de la contrainte.

Pour un diagnostic positif, il peut privilégier la **fin** ou la disparition observée d’un événement afin de détecter un rebond après rétablissement de l’accès.

`data/public-context.json` contient désormais `works_history` afin de conserver des événements récemment terminés au lieu de ne connaître que les chantiers actifs du jour.

## Causes concurrentes

Avant de présenter les travaux comme explication principale, le moteur recherche également :

- tension / rupture de stock ;
- évolution de prix associée à une baisse de quantité ;
- vacances scolaires et saisonnalité ;
- météo lorsque la corrélation pluie / fréquentation est mesurable ;
- remises et modification du mix de marge.

Une carte peut donc conclure :

- « compatibilité travaux forte » ;
- « travaux plausibles mais stock également important » ;
- « contexte travaux faible, stock/prix à privilégier » ;
- « aucun signal travaux convaincant ».

## Scores

- **78–100** : compatibilité forte ;
- **58–77** : compatibilité moyenne ;
- **36–57** : compatibilité faible ;
- **0–35** : aucun signal travaux convaincant.

Le score combine : concentration géographique, écart aux zones témoins, chronologie, sévérité de l’événement public, affinité géographique, variation autour de l’événement, qualité/fraîcheur des sources et taille d’échantillon.

## Interface

Chaque conclusion autonome affiche désormais un badge `Contexte Clermont` et, dans « Voir l’explication et les preuves » :

- conclusion contextuelle ;
- chaîne explicative automatique ;
- événements publics testés ;
- score événement ;
- causes concurrentes.

Un écran **Contexte causal** regroupe les chaînes les plus fortes et les événements publics reliés à plusieurs diagnostics.

## Autopilot

Autopilot exécute automatiquement :

- le test de contexte sur tous les diagnostics exploitables ;
- le classement des chaînes explicatives ;
- le suivi des couples diagnostic ↔ zone ;
- la génération d’un plan de vérification ;
- la conservation de ces éléments dans les snapshots locaux.

## Confidentialité

Aucune donnée client n’est envoyée à l’API Clermont Métropole. L’API et les pages officielles sont collectées par GitHub Actions dans un fichier public. Le croisement avec les ventes, clients et adresses TGM se fait ensuite uniquement dans le navigateur.
