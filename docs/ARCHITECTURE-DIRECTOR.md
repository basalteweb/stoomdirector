# Architecture de Director 6.0

- `app.js` pilote une mémoire validée et un ensemble d’imports en attente. L’ajout est compacté au niveau du ticket ; le nom du fichier n’est pas une clé d’unicité.
- `analytics.js` construit un nouveau modèle sur une copie des lignes importées, avec rattachement clients/catalogue, règles d’identité, profils et contrôles de cohérence.
- `director.js` apporte les agrégations opérationnelles, le cockpit, les règles de commande, les actions, l’équipe et la vue de mémoire.
- `ui.js` reste le routeur des vues historiques et des fiches de détail. Les nouvelles vues réutilisent le même modèle et les mêmes fiches.
- `storage.js` utilise IndexedDB version 2, compatible avec la base existante. L’état des imports et du journal est enregistré dans la même transaction. La révision protège les imports contre les mises à jour provenant d’un onglet obsolète.
- Les relevés de stock sont identifiés par date d’observation et empreinte des couples code/stock, indépendamment du nom du fichier.
- La sauvegarde JSON contient imports normalisés, état Director, profil du commerce, relevés de stock et historiques d’analyse. Le modèle dérivé est recalculé à la restauration.
- Le moteur contextuel et les collecteurs publics existants sont conservés. Leurs requêtes de lecture côté application disposent d’un délai maximal.
- Le service worker restreint son cache aux ressources publiques de cette application et fait correspondre les URL d’assets versionnées aux clés précachées.

La persistance des réglages et notes n’est pas un système d’édition collaborative multiutilisateur. La sauvegarde locale ne remplace pas une copie exportée.
