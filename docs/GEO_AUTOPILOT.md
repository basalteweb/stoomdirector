# Geo Intelligence & Autopilot — méthode

## Objectif

Détecter automatiquement les changements de comportement liés à la provenance géographique de la clientèle et produire des actions internes sans intervention humaine.

## Classification géographique

La classification locale utilise uniquement les champs déjà présents dans TGM : ville, code postal et, pour certaines micro-zones clermontoises, un lexique local de voies/secteurs. Aucune adresse n’est envoyée à un géocodeur externe.

Chaque rattachement conserve un niveau de confiance et une source (`commune`, `code postal + commune`, `adresse + commune`). Une micro-zone non démontrable n’est jamais inventée.

## Comparaison zone / zone témoin

Pour chaque zone Z, le moteur calcule :

- variation propre de Z ;
- variation de toutes les transactions hors Z ;
- **écart géographique** = variation Z − variation hors Z ;
- CA attendu de Z si Z avait suivi la tendance des autres zones ;
- écart entre CA observé et CA attendu.

Le dernier indicateur est une estimation contrefactuelle simple, pas un montant comptable certifié.

## Change-point detection

Le CA de chaque zone est agrégé par semaine. Le moteur teste les points de coupure possibles en conservant au moins quatre semaines de chaque côté. Le point réduisant le plus la variance interne est conservé lorsqu’il dépasse les seuils de robustesse du logiciel.

L’objectif est de répondre automatiquement à « depuis quand cette zone a-t-elle changé ? ».

## Prévision géographique à 7 jours

Pour chaque zone disposant d’un historique suffisant, le moteur estime automatiquement le CA et le nombre de visites des sept prochains jours. Il compare chaque futur jour au comportement récent du même jour de semaine et affiche un score de confiance lié à la quantité d’historique réellement disponible.

Cette projection est une **estimation**, jamais une promesse de CA. Elle sert de référence pour détecter plus vite un décrochage anormal au prochain import.

## Garde-fou de journée incomplète

Si la dernière journée de l’extraction se termine nettement plus tôt que l’heure de fermeture habituelle observée dans l’historique, Geo Intelligence utilise automatiquement la veille comme date de référence comparative. Cela évite qu’un export réalisé à midi crée artificiellement une baisse géographique.

## Impact Score

L’Impact Score combine notamment :

- écart négatif au reste de la clientèle ;
- baisse de visites ;
- part de clients à risque élevé ;
- solidité d’une rupture temporelle détectée ;
- volume d’observations.

Le score sert à prioriser les zones. Il ne mesure pas directement l’intensité physique des travaux.

## Autopilot

Autopilot exécute des actions **internes et réversibles** : calculs, listes, classements, plans et alertes.

Il compare également les nouveaux résultats aux snapshots locaux précédents afin de signaler automatiquement une zone qui s’améliore, se dégrade ou reste durablement sous pression.

Il ne réalise pas une action externe irréversible sans outil autorisé. Il peut donc préparer une liste de réactivation clients ou un plan de commande, mais ne contacte personne et ne commande rien tout seul dans cette version GitHub Pages autonome.

## Contexte travaux / météo

La GitHub Action Local Context Sentinel actualise plusieurs fois par jour un fichier public sans aucune donnée client. Le moteur rapproche ensuite :

- zone commerciale en anomalie ;
- secteur officiel de travaux ;
- éléments travaux publics disponibles ;
- météo lorsque suffisamment de jours sont disponibles.

Les constats sont étiquetés comme signaux contextuels. Une corrélation n’est jamais formulée comme causalité certaine.


## Local Context Sentinel

La v3.1 ajoute l’Explore API v2.1 de Clermont Auvergne Métropole comme source prioritaire. Le moteur contrôle la santé de l’API, découvre les jeux de données pertinents, vérifie les jeux structurants (stationnement, adresses publiques, axes de voie) et conserve les pages officielles de travaux en fallback.

Une panne d’API ne bloque pas Geo Intelligence. Elle réduit seulement la confiance des explications externes et est visible dans le panneau « Sources publiques & API ».

Le stationnement public peut fournir un signal de pression urbaine. Il est affiché et historisé comme contexte, mais n’est jamais présenté seul comme cause d’une évolution commerciale.
