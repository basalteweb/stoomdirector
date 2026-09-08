# Dictionnaire de données et règles de calcul

## 1. Clients

Clé primaire attendue : `Code client`.

Champs exploités : identité, nom, adresse, code postal, ville, téléphone, e-mail, consentements, anniversaire, âge, profession, alerte, date de création et point de création.

### Normalisation d'identité

- E-mail : minuscules, espaces supprimés.
- Téléphone : ponctuation supprimée et formats France `+33`, `0033`, `33` ramenés vers un format commençant par `0` quand cela est déterministe.
- Nom / ville / adresse : casse et accents neutralisés pour les comparaisons, sans modifier la valeur affichée.
- Code postal : chaîne de 5 chiffres quand une valeur exploitable existe.

### Rattachement d'une transaction à une fiche client

Ordre logique :

- e-mail exact et unique ;
- téléphone exact et unique ;
- nom + adresse exacts et uniques ;
- nom + code postal exacts et uniques ;
- nom + localisation exacte et unique ;
- à défaut, nom exact et unique = correspondance **probable** ;
- identifiants forts contradictoires = **conflit bloquant**.

Le logiciel ne fait pas de rapprochement flou par ressemblance orthographique dans la version 1.0, afin d'éviter les faux positifs.

## 2. Ventes

Clé de transaction interne : `Ticket` (ou `Num. vente` en repli) + horodatage exact.

Chaque ligne conserve notamment : vendeur, identité client de la vente, Code article, désignation, rayon, famille, sous-famille, retour, quantité, achat HT, marge, vente HT/TTC, remise, facture et ticket.

### Contrôle financier

Quand les champs existent, contrôle :

`Vente HT - Achat HT = Marge`

Une différence supérieure à 0,03 € sur une ligne est signalée.

### Visite client

Pour l'analyse de revisite, plusieurs tickets du même client le même jour sont regroupés en un **jour de visite**. Les transactions restent séparées pour le CA et les tickets.

## 3. Catalogue / stock

Clé primaire : `Code article`.

Le catalogue représente un **snapshot courant**, pas l'historique des stocks. Chaque nouvel import validé peut être mémorisé localement comme snapshot IndexedDB afin de permettre des analyses temporelles ultérieures.

### Rapprochement article

1. Code article exact.
2. À défaut, comparaison sans zéros initiaux uniquement si elle conduit à une seule référence catalogue.
3. Sinon : référence historique non rattachée.

## 4. Risque de non-revisite

Le rythme normal est principalement fondé sur la médiane des intervalles entre jours de visite.

Pour un historique d'au moins trois visites :

- < 1,25 × l'intervalle médian : actif ;
- 1,25 à < 1,75 × : à surveiller ;
- 1,75 à < 2,5 × : risque ;
- ≥ 2,5 × : risque élevé.

Ce score est une **mesure comportementale**, pas la preuve qu'un client est définitivement perdu.

## 5. Stock

Vitesse 30 jours : quantité positive vendue sur les 30 derniers jours / 30 jours calendaires.

Couverture : stock courant / vitesse 30 jours.

Statuts :

- stock < 0 : anomalie stock négatif ;
- stock = 0 : rupture courante ;
- couverture < 7 jours : critique ;
- couverture < 21 jours : faible ;
- aucune vente positive sur 90 jours avec stock > 0 : dormant ;
- sinon : OK.

## 6. Associations de panier

Calcul sur la présence d'un article dans un ticket positif :

- support = tickets contenant A et B / tickets ;
- confiance A→B = tickets contenant A et B / tickets contenant A ;
- lift = confiance A→B / fréquence de B.

Un lift > 1 montre une association statistique, pas une causalité.

## 7. Vacances scolaires

Clermont-Ferrand est classé selon les périodes Zone A intégrées dans `js/constants.js`. L'analyse compare notamment le CA par **jour actif**, afin d'éviter de comparer naïvement des périodes de longueurs différentes.
