# Le guide quotidien de Stoom Director

Version 6.0.0 — préparée pour Arnaud BLANC, direction du magasin Stoom.

## Installer la nouvelle version

Le ZIP contient le logiciel entier. Extraire son contenu et remplacer les fichiers de l’application à son emplacement habituel. Conserver l’adresse du site et utiliser le même navigateur pour retrouver les données de la version précédente. La base locale existante conserve son nom et son format compatible.

Ne pas supprimer les données du navigateur lors de la mise à jour. Si des exports TGM d’origine sont disponibles, les conserver également. À l’ouverture, vérifier « 6.0.0 DIRECTOR » dans la navigation. Si une ancienne interface apparaît, recharger la page après la mise à jour.

Une installation à une nouvelle adresse possède une mémoire distincte. Pour déplacer les données depuis Director, exporter une sauvegarde complète puis la restaurer à la nouvelle adresse.

## Premier démarrage

1. Cliquer sur **Importer / actualiser**.
2. Renseigner la date réelle de la base clients, puis sélectionner `Clients.xlsx`.
3. Sélectionner un ou plusieurs fichiers `Ventes.csv`.
4. Renseigner la date réelle du relevé de stock, puis sélectionner `Catalogue.xlsx`.
5. Cliquer sur **Valider et mettre à jour**.
6. Dans **Réglages & mémoire**, choisir HT ou TTC, saisir l’objectif mensuel et les jours d’ouverture.

Les noms avec suffixe numérique, comme `Ventes (3).csv`, sont acceptés. Les fichiers Excel doivent être au format XLSX, et non XLS. Un fichier placé dans la bonne zone avec un autre nom fait l’objet d’un contrôle de contenu et d’un avertissement.

La date du stock est essentielle : la date de téléchargement d’un fichier ne prouve pas la date de son contenu. Renseigner la bonne date **avant de sélectionner le fichier**. Si la date est changée ensuite, sélectionner à nouveau le fichier.

## Actualiser sans perdre l’historique

| Situation | Comportement |
| --- | --- |
| Janvier existe, on ajoute février | Janvier est conservé et février est ajouté. |
| Janvier est importé une nouvelle fois | Les tickets strictement identiques sont ignorés. |
| Un fichier contient janvier, février et mars, mais les deux premiers mois existent | Seuls les nouveaux tickets sont conservés dans le nouvel export actif. |
| Un ticket connu présente un montant ou un vendeur différent | L’import est refusé et la mémoire validée reste intacte. |
| Le même nom de fichier est utilisé pour un autre mois | Le contenu et les identifiants sont contrôlés ; le nom seul n’est pas utilisé pour dédupliquer. |
| Un ancien stock est importé avec sa vraie date | Il est archivé sans remplacer un stock courant plus récent. |
| Un ancien export clients est ajouté | Les fiches plus récentes restent prioritaires ; les clients historiques manquants peuvent compléter la base. |
| Une sauvegarde locale échoue | La nouvelle mise à jour n’est pas annoncée comme appliquée ; la précédente est conservée. |
| Un autre onglet a ajouté des ventes | L’onglet ancien doit recharger l’historique avant de pouvoir l’actualiser. |

Les fichiers sélectionnés sont d’abord placés en attente. **Valider et mettre à jour** est le point où les données sont contrôlées, enregistrées et intégrées. Fermer la fenêtre d’import ne les applique pas. **Annuler les fichiers en attente** revient à la mémoire déjà validée.

En cas de ticket contradictoire, vérifier le numéro signalé et l’export source. Le logiciel ne choisit pas arbitrairement lequel a raison. Cette version ne comporte pas d’outil pour forcer une correction de ticket déjà enregistré ; une correction historique volontaire doit être préparée avec les exports sources cohérents et une sauvegarde préalable.

Le journal indique chaque validation, les fichiers reçus, les tickets ajoutés, les doublons ignorés, le total après mise à jour et les dates extrêmes. La vue mensuelle indique les tickets réellement observés : elle ne transforme pas une absence d’export en preuve d’absence de vente.

## Le rituel d’ouverture

- Vérifier **Ventes au…** et **Stock daté du…**. Les analyses ne peuvent pas connaître les ventes postérieures au dernier import.
- Lire le CA, le nombre de tickets d’achat, le panier et la marge.
- Vérifier l’objectif du mois et les jours d’ouverture restants.
- Ouvrir les actions prioritaires, notamment le stock sous tension et les clients réguliers en retard.
- Affecter une action en notant son responsable ou sa décision dans le plan d’action.

Le dernier jour importé peut être une journée partielle. Les comparaisons du cockpit incluent ce jour ; la notice affiche ce risque. Certains diagnostics historiques emploient leur propre fenêtre et peuvent exclure une journée détectée comme possiblement incomplète : lire les dates du diagnostic.

## Ce que signifient les indicateurs

| Indicateur | Définition |
| --- | --- |
| CA net | Somme des montants de vente importés, retours compris selon les signes de la source. |
| Tickets d’achat | Tickets dont le total TTC est strictement positif. |
| Total tickets | Tous les tickets uniques, incluant avoirs et retours. |
| Panier d’achat | Montant des tickets d’achat divisé par leur nombre, dans la base HT ou TTC choisie. |
| Marge commerciale | Somme du champ Marge de TGM ; ce n’est pas le bénéfice net après loyer, salaires ou charges. |
| Taux de marge affiché | Marge commerciale divisée par CA HT. |
| Clients en retard | Comparaison du dernier achat connu au rythme d’achat observé de chaque client, à la date des données. |
| Couverture de stock | Quantité en stock divisée par demande moyenne quotidienne observée. |

Une donnée HT ou marge absente n’est pas interprétée comme une performance de zéro. Les montants de marge partiels restent non disponibles dans le cockpit. L’audit indique les colonnes et avertissements des sources.

Le cockpit compare des jours de semaine identiques : la période précédente est décalée d’un nombre entier de semaines. Le choix annuel correspond à **52 semaines avant**, pas à une comparaison stricte par date anniversaire. La comparaison est indisponible si son début précède l’historique disponible. Les jours fériés ou le contexte commercial peuvent encore différer.

L’objectif suppose que les journées d’ouverture antérieures à la date des données ont été réalisées et que la dernière journée importée est terminée. Si le début du mois manque, le rythme à atteindre n’est pas présenté comme exploitable. Configurer les fermetures exceptionnelles, y compris les jours fériés où le magasin sera fermé.

## Préparer les commandes

1. Actualiser les ventes et le catalogue.
2. Ouvrir **Préparer le réassort** et filtrer par fournisseur.
3. Contrôler les stocks négatifs : aucune quantité automatique n’est calculée pour ces références.
4. Renseigner le lot réel de chaque référence. Le logiciel n’invente pas un conditionnement fournisseur.
5. Saisir les unités déjà en commande, puis vérifier les quantités proposées.
6. Exporter la sélection en CSV pour préparer la commande fournisseur.

La proposition utilise les 28 derniers jours, ou le nombre de jours réellement observables si l’historique est plus court. Elle exclut les lignes de retour de la demande positive. Elle vise au moins le délai de livraison plus la sécurité, et respecte le lot supérieur.

Les propositions restent à valider : un historique incomplet, un lancement récent, une fermeture ou une rupture passée peut fausser le rythme apparent. Les quantités « en commande » sont des saisies manuelles persistantes : **les remettre à zéro à réception** et les revoir après chaque actualisation de stock. Une hausse du stock ne permet pas de distinguer automatiquement livraison, correction ou transfert.

Une référence en stock sans vente sur la fenêtre reste visible. Elle n’est pas automatiquement considérée comme invendable. Les prix de vente du catalogue ne sont pas utilisés comme coûts d’achat : aucun faux budget d’achat n’est affiché.

## Piloter l’équipe

Dans **Équipe & performance**, sélectionner la période puis un vendeur. Les chiffres proviennent du même ensemble de tickets que le cockpit.

La vue présente le CA net, les achats, le panier, la marge, les remises, les retours, les quantités, le détail par date, jour de semaine, heure et rayon. Le CSV exporte le détail quotidien avec le nom du vendeur.

Pour les jours forts et faibles, le logiciel compare les paniers des jours de semaine comptant au moins dix tickets d’achat. Il ne déduit pas un problème de compétence d’une journée isolée.

Le repère équipe utilise les autres vendeurs sur les mêmes jours de semaine et, si les heures sont disponibles, sur des blocs de trois heures. Un bloc n’est utilisé qu’avec au moins cinq tickets de chaque côté. Le repère ne s’affiche qu’à partir de vingt achats comparables du vendeur.

Ce rapprochement réduit certains écarts de créneau ; il ne corrige pas le mix produits, les profils clients, les objectifs individuels ou le planning. Sans heures travaillées, il n’y a pas de CA par heure travaillée. Sans comptage des visiteurs, il n’y a pas de taux de conversion.

Un retour est attribué au vendeur inscrit sur son ticket de retour. Cela ne prouve pas que ce vendeur a réalisé la vente d’origine. Un ticket portant des vendeurs différents sur ses lignes est refusé, pour éviter une attribution arbitraire.

Lorsque tous les tickets sont horodatés à minuit, les heures ne sont pas présentées comme exploitables. Si un export mélange des tickets réellement horodatés et des tickets sans heure, vérifier la tranche « 00 h » : elle peut contenir des heures manquantes.

## Fermer la journée et conserver la mémoire

- Marquer les actions traitées et laisser une note sur les décisions.
- Les actions automatiques reviennent si le problème persiste un autre jour. Les actions ajoutées manuellement restent traitées jusqu’à leur réouverture.
- Exporter une sauvegarde complète après les mises à jour importantes et régulièrement en fin de journée.
- Conserver le fichier JSON dans un emplacement privé. Il contient les données du magasin, y compris celles des clients.

La restauration vérifie la structure du fichier, reconstitue les dates et recalcule les analyses avant le remplacement. Une confirmation indique le nombre de tickets et la période. La restauration remplace la mémoire du navigateur ; elle ne fusionne pas deux sauvegardes.

La mémoire n’est pas synchronisée entre appareils. Utiliser de préférence un seul onglet actif pour modifier les actions et réglages. La protection contre un onglet obsolète concerne les mises à jour des ventes ; les notes et réglages ne constituent pas un outil de collaboration simultanée.

## Ce qui reste à valider en magasin

Cette livraison comporte des tests automatisés avec données synthétiques, des vérifications de génération des écrans et de sauvegarde transactionnelle simulée. Elle n’a pas été testée dans un navigateur avec les exports réels du magasin.

À la première utilisation, comparer un mois connu au total TGM, contrôler un ticket de vente et un retour, puis vérifier une référence de stock et les chiffres d’un vendeur. Toute différence doit être résolue avant d’utiliser les chiffres concernés pour une décision importante.

Les analyses de contexte local sont conservées, avec leurs données et leur collecteur existants. Leur fraîcheur et leur disponibilité dépendent de la collecte. Elles ne prouvent pas seules qu’un chantier ou un événement a causé une baisse.
