# Sécurité et confidentialité — Analysis Power 5.0

## Données TGM

Les fichiers Clients, Ventes et Catalogue sont lus localement dans le navigateur. Ils ne sont pas téléversés vers Basalte-Web, GitHub ni les sources publiques.

Le `.gitignore` bloque notamment CSV, XLS, XLSX, ODS et ZIP afin de réduire le risque d’envoi accidentel d’une extraction.

## Adresse du commerce

Seule l’adresse du **point de vente** peut être transmise au service public Géoplateforme/BAN pour géocodage. Le profil est ensuite sauvegardé localement dans le navigateur.

Le collecteur GitHub Actions utilise l’adresse placée volontairement dans `config/store.json`.

## Adresses clients

Aucune adresse client n’est envoyée à Géoplateforme, aux APIs publiques ou à GitHub. La classification géographique des clients reste dans le navigateur.

## Sources publiques

Le Local Context Sentinel collecte uniquement des données publiques : travaux/voirie, agenda, mobilité, stationnement et météo selon disponibilité. Les données sont validées avant publication dans `data/public-context.json`.

Une panne externe ne doit jamais bloquer l’analyse TGM locale.

## Causalité

Une source externe n’est pas une preuve automatique. Le moteur conserve deux espaces distincts :

- **restitution utilisateur** : uniquement causes franchissant les seuils de pertinence ;
- **audit technique** : hypothèses testées mais rejetées.

Les textes officiels utilisés comme preuves sont conservés séparément de l’interprétation Analysis.

## Stockage local

IndexedDB peut conserver une session importée et des snapshots synthétiques sur le poste utilisé. Le bouton **Effacer les données locales** supprime ce stockage applicatif.

## Déploiement

Ne jamais versionner de vraies extractions TGM dans un dépôt public. `config/store.json` contient une adresse de commerce non secrète mais doit être adapté au point de vente déployé.
