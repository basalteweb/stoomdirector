# Analysis Power 5.1 — Règles « commerçant d'abord »

## Promesse

Un utilisateur qui connaît son commerce mais pas les statistiques doit comprendre une alerte en quelques secondes.

Chaque alerte commerciale suit le même ordre :

1. **Ce qui se passe** — une phrase claire.
2. **Pourquoi ?** — seulement une cause réellement défendable ; sinon « Cause non identifiée ».
3. **Que faire ?** — une action concrète et immédiatement exploitable.
4. **Voir les faits** — chiffres, périodes, clients/produits concernés et source officielle si nécessaire.

## Ce qui reste caché

Les éléments nécessaires au moteur mais inutiles à la décision ne sont pas affichés dans les vues commerciales : scores internes, coefficients, seuils, concentration, lift, corrélations, calculs intermédiaires et hypothèses rejetées.

Ils restent disponibles dans **Détails & audit** lorsque la traçabilité est nécessaire.

## Règle « cause ou silence »

Power ne doit jamais remplir une carte avec une explication faible simplement parce qu'une donnée existe.

- Une météo différente n'est pas automatiquement une cause.
- Un événement dans la ville n'est pas automatiquement une cause.
- Un chantier dans le même secteur n'est pas automatiquement une cause.
- Une baisse produit ne peut pas recevoir directement un chantier, la météo, un parking ou T2C comme explication.

Si aucune explication ne franchit les contrôles de preuve, l'interface affiche : **Cause non identifiée**.

## Travaux et accessibilité

Un chantier ne peut être affiché comme cause que si Power dispose au minimum :

- d'une source suffisamment fiable ;
- d'une date exploitable et cohérente avec le changement commercial ;
- d'une zone commerciale réellement concernée ;
- et soit d'un changement de fréquentation observé autour du chantier, soit d'une restriction d'accès forte, proche et géographiquement cohérente.

Lorsqu'il est retenu, Power sépare :

- le **descriptif officiel** de la source ;
- l'**interprétation Power** ;
- les faits commerciaux utilisés.

## Produits

Pour une baisse produit, Power recherche d'abord des explications métier : nombre de clients acheteurs, quantités, disponibilité, prix, migration vers une autre référence, famille/rayon. Les causes externes ne sont pas utilisées directement pour un produit isolé.

## Clients

Les termes de risque sont traduits en comportement observable :

- Dans son rythme
- Commence à tarder
- En retard
- Très en retard

Le score interne de retard n'est pas affiché dans l'interface commerciale.

## Stock

Les états techniques sont traduits en décisions :

- Stock à corriger
- Déjà épuisé
- À recommander vite
- À surveiller
- Se vend très peu
- Stock suffisant
- Stock actuel inconnu

## Principe de fiabilité

Quand Power ne sait pas, il doit le dire. Une absence d'explication est préférable à une causalité séduisante mais fausse.
