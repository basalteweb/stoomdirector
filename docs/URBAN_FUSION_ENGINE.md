# Urban Fusion Engine — base contextuelle d’Analysis Power

## Objectif

Faire du contexte de Clermont un facteur explicatif transversal, pas un simple onglet. Chaque diagnostic commercial peut être confronté automatiquement aux conditions de mobilité et d’activité urbaine disponibles.

## Sources intégrées

| Source | Signal utilisé | Fréquence cible | Statut analytique |
|---|---|---:|---|
| Clermont Métropole Explore API | parkings, voirie, adresse publique, jeux mobilité | 4/j | public structuré |
| Pages travaux Métropole | chantiers, rues, restrictions | 4/j | secours / complément |
| Agenda Clermont-Ferrand | événements, lieux, dates | 4/j | contexte événementiel |
| T2C GTFS-RT | retards, annulations, trip updates si décodables | 4/j | contexte temps réel échantillonné |
| C.vélo | vélos / places disponibles | 4/j | proxy mobilité |
| ZELT | comptages vélo quotidiens | 4/j | proxy activité urbaine |
| Open-Meteo | pluie / température | 4/j | variable de contrôle |
| Calendrier Analysis Power | vacances Zone A / jours fériés | local | saisonnalité |

## Hiérarchie des explications

Le moteur commence par les causes arithmétiques certaines (tickets, panier, mix), puis cherche où se concentre le mouvement (zone, produit, clientèle), puis teste les facteurs externes et métier en concurrence.

Une explication urbaine est renforcée par :

- concentration dans une zone exposée ;
- zones témoins stables ;
- proximité temporelle entre événement et rupture commerciale ;
- durée cohérente ;
- rebond après fin/normalisation ;
- même signal sur plusieurs métriques liées (visites, revisites, horaires) ;
- source publique fraîche et structurée.

Elle est affaiblie lorsque toute la clientèle évolue de la même façon, lorsque le panier mais pas les visites change, lorsqu’une rupture de stock explique mieux le phénomène, ou lorsque la source externe est ancienne/partielle.

## Urban Pressure Score

Score contextuel 0–100 combinant les signaux disponibles de mobilité urbaine. Il sert à repérer un environnement sous pression ; il ne mesure pas directement la perte de CA.

## Historisation

`public-context-history.json` garde jusqu’à 2 160 snapshots. Le but est de remplacer progressivement les impressions ponctuelles par des relations calculées sur des observations répétées : parking ↔ visites, T2C ↔ fréquentation, pluie ↔ CA, etc.

## Anti-faux-positif Open Data

La découverte automatique ne transforme plus n’importe quel dataset contenant le mot « travaux » en chantier. Marchés publics, budgets, subventions, patrimoine et archéologie sont pénalisés/exclus. Un événement opérationnel doit contenir des indices de circulation/voirie suffisamment explicites.

## Geo Intelligence v4

Le rendu est défensif : valeurs manquantes protégées, tableaux bornés, graphiques dessinés après rendu, changement d’onglet annulant les anciens rendus, et écran de secours en cas d’exception. Cela évite qu’une anomalie d’une source externe rende l’onglet totalement vide.
