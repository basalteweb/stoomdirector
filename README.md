# STOOM Director — Analysis Power 6.0.0

Refonte du pilotage quotidien de Stoom, conçue par Basalte-Web à partir d’Analysis Power 5.1.0 MERCHANT.

Commencer par **GUIDE-STOOM.md**. Le dossier contient l’application complète, les moteurs historiques, les nouveaux modules de gestion, les tests et le collecteur de contexte public.

## Utilisation

1. Remplacer les fichiers de l’application actuelle par le contenu de ce dossier, en conservant son adresse de publication et son navigateur pour retrouver la mémoire locale existante.
2. Ouvrir le site et vérifier la mention **6.0.0 DIRECTOR**.
3. Importer les trois sources TGM lors du premier démarrage. Lors des mises à jour suivantes, sélectionner uniquement les sources à actualiser. Les ventes sont toujours ajoutées à l’historique validé.
4. Régler les objectifs et les règles de réassort dans **Réglages & mémoire**.
5. Exporter régulièrement une sauvegarde complète.

L’application est statique : aucune compilation front-end ni clé d’API d’IA n’est nécessaire. Elle est destinée à être servie en HTTPS, notamment à son emplacement GitHub Pages existant. L’ouverture directe de `index.html` depuis un disque n’est pas le mode de fonctionnement validé : certains navigateurs restreignent alors le stockage, les workers et la lecture du contexte.

Aucun déploiement ni modification d’un dépôt distant n’a été effectué pour cette livraison.

## Principales évolutions

- Cockpit **Ma journée**, période sélectionnable, comparaisons à jours de semaine identiques, CA HT/TTC, panier d’achat, tickets et marge.
- Objectif mensuel avec jours d’ouverture et fermetures exceptionnelles configurables.
- Imports incrémentaux, suppression des doublons exacts, refus des contradictions et préservation de la dernière analyse valide.
- Les changements de vendeur, remise ou identité sur un ticket déjà connu sont contrôlés, au même titre que les montants.
- Clients historiques conservés, stock courant protégé contre les relevés datés plus anciens et relevés de stock archivés.
- Journal des imports, vision des mois observés, sauvegarde JSON complète et restauration recalculée.
- Sauvegarde transactionnelle des imports et du journal ; refus d’un écrasement de ventes par un onglet obsolète.
- Réassort à partir de tout le catalogue, y compris les références sans vente ; lots et quantités déjà commandées modifiables par référence.
- Analyse de l’équipe par vendeur, date, jour de semaine, heure et rayon ; remises et retours distingués.
- Repère de panier de l’équipe pondéré selon les créneaux comparables, avec seuils minimums de volume.
- Plan d’action avec statut, notes, responsable libre et échéance ; recherche rapide client/produit sur ordinateur.
- Identité graphique graphite et bleu électrique, navigation regroupée, menu mobile, champs et textes agrandis, styles d’impression.
- Conservation des vues historiques : fidélisation, produits, rayons, stock, diagnostic, opportunités, contexte local, saisonnalité, associations, comparaison libre et audit.

## Confidentialité et mémoire

Les imports restent dans le navigateur. Le journal et les actions ne sont pas synchronisés entre appareils. Une sauvegarde exportée contient des données personnelles et commerciales : la garder dans un emplacement privé, jamais dans le dépôt du site.

Le navigateur doit autoriser IndexedDB. La mémoire dépend du navigateur, du profil et de l’origine du site. Le changement de navigateur ou d’adresse, la navigation privée et l’effacement des données du site peuvent empêcher sa récupération. Les sauvegardes permettent de la transporter.

Le profil du commerce peut interroger le géocodeur public pour l’adresse du magasin. Les adresses clients ne sont pas envoyées au géocodeur. Le collecteur de contexte public fourni reste séparé des imports de ventes.

## Contrôles disponibles

```text
node tests/test_director.js
node tests/test_storage.js
node tests/test_causal_context.js
node tests/test_power_causality.js
node tests/test_merchant_rules.js
python3 tests/test_public_context.py
python3 scripts/validate_public_context.py
python3 tests/check_static.py
```

Le détail des vérifications réellement exécutées est dans `TEST_REPORT.txt`.

## Limites de lecture

Le moteur est un ensemble local de calculs et de règles métier, pas un service GPT connecté. Il ne récupère pas automatiquement les nouvelles ventes de TGM et n’observe pas le magasin en temps réel. Il analyse l’état des exports validés et affiche leurs dates.

La présence de tickets entre deux dates ne démontre pas que l’export est complet. Une hausse ou une baisse n’établit pas à elle seule une cause. Les réassorts et retards clients sont des estimations. La productivité horaire, la conversion et le budget d’achat ne sont pas inventés lorsque les données nécessaires manquent.

Les connexions publiques et la chaîne de collecte antérieures sont conservées. Leur disponibilité en direct n’a pas été vérifiée dans cette livraison. Les fichiers de contexte inclus ont leur propre date et statut ; ils ne doivent pas être pris pour un flux en temps réel.
