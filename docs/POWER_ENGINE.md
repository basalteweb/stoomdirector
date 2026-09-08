# Analysis Power 5.0 — Power Engine

## Contrat d’interface

Chaque diagnostic suit quatre niveaux progressifs :

1. **Constat** — ce qui mérite l’attention ;
2. **Pourquoi ?** — causes réellement retenues et logique explicative ;
3. **Solution** — actions recommandées ;
4. **Preuves** — faits, calculs, chronologie et sources.

Les niveaux 2 à 4 sont repliés par défaut pour préserver la lisibilité.

## Contrat causal

Une hypothèse externe n’est visible que si :

- le type de diagnostic est compatible avec la cause ;
- le signal propre de la cause franchit son seuil ;
- lorsqu’une cause d’accès est invoquée, la géographie commerciale converge ;
- la chronologie est exploitable ;
- l’échantillon n’est pas insuffisant.

Seuils de restitution actuels :

- travaux/accessibilité : signal propre >= 68 ;
- autres causes candidates : signal propre >= 60 ;
- statut final `strong` >= 78 ;
- statut final `moderate` >= 64.

Sans cause retenue, le score causal final est plafonné et le cockpit affiche **aucune cause suffisamment étayée**.

## Preuve officielle

Un événement public retenu peut embarquer :

- `official_description` : valeur ou extrait officiel conservé ;
- `source_record` : contexte brut utile à l’analyse ;
- `source` : URL de provenance ;
- `source_label` ;
- coordonnées et `distance_m` ;
- dates et horodatage de collecte.

L’interface présente la source officielle séparément de l’interprétation métier.

## Local Context Engine

`config/store.json` définit le magasin du collecteur planifié. Dans le navigateur, l’utilisateur peut modifier le profil ; cette modification déclenche un nouveau calcul du contexte et des causes sur l’analyse chargée.

L’édition statique conserve volontairement une séparation :

- **données TGM privées** : navigateur ;
- **contexte public** : GitHub Actions / JSON public ;
- **profil local utilisateur** : localStorage.

Pour une édition TGM multi-magasins, le même moteur doit recevoir un profil établissement depuis la plateforme TGM et un contexte public correspondant, plutôt que dépendre d’un seul `config/store.json`.

## Anti-fouillis

Les hypothèses rejetées ne sont jamais listées dans les diagnostics. Elles sont consultables dans **Audit & preuves**. Le produit montre ce que le moteur retient, pas tout ce qu’il a testé.
