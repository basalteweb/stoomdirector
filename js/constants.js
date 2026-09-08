window.AU = window.AU || {};

AU.APP = Object.freeze({
  name: 'Analysis Power',
  company: 'Basalte-Web',
  version: '6.0.0 DIRECTOR',
  dataPolicy: 'Traitement local dans le navigateur — aucune donnée client n’est envoyée par Analysis Power.'
});

AU.FILE_RULES = Object.freeze({
  clients: {
    label: 'Base clients',
    baseName: 'clients',
    extensions: ['xlsx'],
    required: ['Code client', 'Nom prenom'],
    recommended: ['Telephone', 'E-mail', 'Date creation', 'Adresse 1', 'Code postal', 'Ville'],
    description: 'Extraction TGM de la base clients.'
  },
  ventes: {
    label: 'Ventes',
    baseName: 'ventes',
    extensions: ['csv'],
    required: ['Date', 'Num. vente', 'Code article', 'Designation', 'Quantite', 'Vente TTC'],
    recommended: ['Ticket', 'Client', 'Telephone', 'E-mail', 'Rayon', 'Famille', 'Achat HT', 'Marge', 'Vente HT', 'Remise', 'Vendeur'],
    description: 'Extraction TGM des lignes de vente au format CSV.'
  },
  catalogue: {
    label: 'Catalogue / stock',
    baseName: 'catalogue',
    extensions: ['xlsx'],
    required: ['Code article', 'Designation', 'Stock'],
    recommended: ['Rayon', 'Famille', 'Sous-famille', 'Fournisseur', 'Vente TTC', 'Date de creation'],
    description: 'Extraction TGM du catalogue et du stock courant.'
  }
});

AU.QUALITY = Object.freeze({
  CERTIFIED: { key: 'certified', label: 'Certifié', short: 'CERTIFIÉ' },
  PARTIAL: { key: 'partial', label: 'Partiel', short: 'PARTIEL' },
  ESTIMATE: { key: 'estimate', label: 'Estimation', short: 'ESTIMATION' },
  ANOMALY: { key: 'anomaly', label: 'Anomalie', short: 'ANOMALIE' },
  BLOCKED: { key: 'blocked', label: 'Non calculable', short: 'BLOQUÉ' }
});

AU.EQUIPMENT_FAMILIES = new Set([
  'POD', 'KIT COMPLET', 'BOX', 'CLEAROMISEUR', 'RECONSTRUCTIBLE'
]);

AU.CONSUMABLE_FAMILIES = new Set([
  'CARTOUCHE', 'RESISTANCE'
]);

// Clermont-Ferrand relève de la zone A. Les bornes ci-dessous sont locales et
// utilisées uniquement pour classer les jours d'une extraction. Les dates sont
// intégrées comme données de référence, jamais déduites silencieusement.
AU.SCHOOL_HOLIDAYS_ZONE_A = Object.freeze([
  { name: 'Toussaint 2024', start: '2024-10-19', end: '2024-11-03' },
  { name: 'Noël 2024', start: '2024-12-21', end: '2025-01-05' },
  { name: 'Hiver 2025', start: '2025-02-22', end: '2025-03-09' },
  { name: 'Printemps 2025', start: '2025-04-19', end: '2025-05-04' },
  { name: 'Pont Ascension 2025', start: '2025-05-30', end: '2025-05-31' },
  { name: 'Été 2025', start: '2025-07-05', end: '2025-08-31' },
  { name: 'Toussaint 2025', start: '2025-10-18', end: '2025-11-02' },
  { name: 'Noël 2025', start: '2025-12-20', end: '2026-01-04' },
  { name: 'Hiver 2026', start: '2026-02-07', end: '2026-02-22' },
  { name: 'Printemps 2026', start: '2026-04-04', end: '2026-04-19' },
  { name: 'Été 2026', start: '2026-07-04', end: '2026-08-31' },
  { name: 'Toussaint 2026', start: '2026-10-17', end: '2026-11-01' },
  { name: 'Noël 2026', start: '2026-12-19', end: '2027-01-03' },
  { name: 'Hiver 2027', start: '2027-02-13', end: '2027-02-28' },
  { name: 'Printemps 2027', start: '2027-04-10', end: '2027-04-25' },
  { name: 'Pont 7 mai 2027', start: '2027-05-07', end: '2027-05-07' },
  { name: 'Été 2027', start: '2027-07-03', end: '2027-08-31' }
]);

AU.FRENCH_PUBLIC_HOLIDAYS_FIXED = Object.freeze([
  { month: 1, day: 1, name: 'Jour de l’An' },
  { month: 5, day: 1, name: 'Fête du Travail' },
  { month: 5, day: 8, name: 'Victoire 1945' },
  { month: 7, day: 14, name: 'Fête nationale' },
  { month: 8, day: 15, name: 'Assomption' },
  { month: 11, day: 1, name: 'Toussaint' },
  { month: 11, day: 11, name: 'Armistice' },
  { month: 12, day: 25, name: 'Noël' }
]);
