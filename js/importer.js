window.AU = window.AU || {};

AU.importer = (() => {
  const U = () => AU.util;

  function canonicalHeaders(row) {
    const out = {};
    for (const [key, value] of Object.entries(row || {})) {
      const clean = U().cleanText(key);
      if (clean) out[clean] = value;
    }
    return out;
  }

  function validateColumns(type, rows, parseErrors = []) {
    const rule = AU.FILE_RULES[type];
    const columns = rows.length ? Object.keys(rows[0]).map(U().cleanText) : [];
    const missingRequired = rule.required.filter(c => !columns.includes(c));
    const missingRecommended = rule.recommended.filter(c => !columns.includes(c));
    const errors = [];
    const warnings = [];

    if (!rows.length) errors.push('Le fichier ne contient aucune ligne exploitable.');
    if (missingRequired.length) errors.push(`Colonnes obligatoires manquantes : ${missingRequired.join(', ')}.`);
    if (missingRecommended.length) warnings.push(`Colonnes recommandées absentes : ${missingRecommended.join(', ')}.`);
    if (parseErrors.length) {
      errors.push(`${parseErrors.length} ligne(s) CSV mal formée(s) : colonnes décalées ou guillemets non fermés. Réexporter le fichier pour éviter des chiffres erronés.`);
    }

    return { columns, missingRequired, missingRecommended, errors, warnings };
  }

  function validateRows(type, rows, report) {
    const errors = report.errors;
    const warnings = report.warnings;
    const metrics = {};
    const numericRequired = type === 'ventes' ? ['Quantite','Vente TTC'] : type === 'catalogue' ? ['Stock'] : [];
    for (const field of numericRequired) {
      const bad = rows.filter(r => U().toNullableNumber(r[field]) === null).length;
      if (bad) errors.push(`${bad} valeur(s) absente(s) ou invalide(s) dans « ${field} ».`);
    }
    if (type === 'ventes') {
      const noId = rows.filter(r => !U().cleanText(r.Ticket) && !U().cleanText(r['Num. vente'])).length;
      if (noId) errors.push(`${noId} ligne(s) sans identifiant de ticket ou numéro de vente.`);
      for (const field of ['Vente HT','Marge','Achat HT']) {
        const invalid = rows.filter(r => U().cleanText(r[field]) && U().toNullableNumber(r[field]) === null).length;
        if (invalid) errors.push(`${invalid} nombre(s) invalide(s) dans « ${field} ».`);
      }
    }

    if (type === 'clients') {
      const codes = rows.map(r => U().cleanText(r['Code client'])).filter(Boolean);
      const unique = new Set(codes);
      metrics.nonEmptyCodes = codes.length;
      metrics.uniqueCodes = unique.size;
      metrics.duplicateCodes = codes.length - unique.size;
      metrics.emailCoverage = rows.length ? rows.filter(r => U().normEmail(r['E-mail'])).length / rows.length : 0;
      metrics.phoneCoverage = rows.length ? rows.filter(r => U().normPhone(r['Telephone'])).length / rows.length : 0;
      if (codes.length !== rows.length) errors.push(`${rows.length - codes.length} fiche(s) client sans Code client.`);
      if (metrics.duplicateCodes > 0) errors.push(`${metrics.duplicateCodes} Code(s) client dupliqué(s). Le croisement est bloqué.`);
    }

    if (type === 'ventes') {
      let invalidDates = 0;
      let invalidArticle = 0;
      let financialMismatch = 0;
      let financialChecked = 0;
      for (const r of rows) {
        if (!U().parseTgmDate(r.Date)) invalidDates++;
        if (!U().normArticleCode(r['Code article'])) invalidArticle++;
        const ht = U().toNullableNumber(r['Vente HT']);
        const cost = U().toNullableNumber(r['Achat HT']);
        const margin = U().toNullableNumber(r.Marge);
        if (ht !== null && cost !== null && margin !== null) {
          financialChecked++;
          if (Math.abs((ht - cost) - margin) > 0.03) financialMismatch++;
        }
      }
      metrics.invalidDates = invalidDates;
      metrics.invalidArticleCodes = invalidArticle;
      metrics.financialChecked = financialChecked;
      metrics.financialMismatch = financialMismatch;
      metrics.financialIntegrity = financialChecked ? 1 - financialMismatch / financialChecked : null;
      if (invalidDates > 0) errors.push(`${invalidDates} ligne(s) de vente avec date invalide.`);
      if (invalidArticle > 0) errors.push(`${invalidArticle} ligne(s) de vente sans Code article.`);
      if (financialMismatch > 0) warnings.push(`${financialMismatch} ligne(s) ont une différence > 0,03 € entre Vente HT - Achat HT et Marge.`);
    }

    if (type === 'catalogue') {
      const codes = rows.map(r => U().normArticleCode(r['Code article'])).filter(Boolean);
      const unique = new Set(codes);
      metrics.nonEmptyCodes = codes.length;
      metrics.uniqueCodes = unique.size;
      metrics.duplicateCodes = codes.length - unique.size;
      metrics.zeroStock = rows.filter(r => U().toNumber(r.Stock) === 0).length;
      metrics.negativeStock = rows.filter(r => U().toNumber(r.Stock) < 0).length;
      if (codes.length !== rows.length) errors.push(`${rows.length - codes.length} article(s) sans Code article.`);
      if (metrics.duplicateCodes > 0) errors.push(`${metrics.duplicateCodes} Code(s) article dupliqué(s) dans le catalogue.`);
      if (metrics.negativeStock > 0) warnings.push(`${metrics.negativeStock} référence(s) avec stock négatif.`);
    }

    return metrics;
  }

  async function parseExcel(file, onProgress) {
    const ext = U().cleanText(file.name).toLowerCase().split('.').pop();
    if (ext === 'xlsx' && AU.xlsxLite?.parseFile) {
      const parsed = await AU.xlsxLite.parseFile(file, onProgress);
      return { ...parsed, rows: (parsed.rows || []).map(canonicalHeaders) };
    }
    // Legacy .xls can still be supported if a host page deliberately provides SheetJS,
    // but Analysis Ultimate itself no longer depends on a remote CDN.
    if (window.XLSX) {
      onProgress?.(10, 'Lecture du classeur XLS…');
      const buffer = await file.arrayBuffer();
      onProgress?.(45, 'Décodage Excel…');
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, dense: false });
      if (!workbook.SheetNames.length) throw new Error('Le classeur ne contient aucune feuille.');
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: false, blankrows: false });
      onProgress?.(90, 'Validation des colonnes…');
      return { rows: rows.map(canonicalHeaders), sheetName: workbook.SheetNames[0], parseErrors: [] };
    }
    throw new Error('Le format .xls ancien n’est pas pris en charge en mode 100 % local. Exportez ce fichier TGM en .xlsx.');
  }

  async function parseCsv(file, onProgress) {
    if (!AU.csv?.parseFile) throw new Error('Le moteur CSV local n’est pas chargé.');
    const parsed = await AU.csv.parseFile(file, onProgress);
    onProgress?.(92, 'Validation du CSV…');
    return { rows: (parsed.rows || []).map(canonicalHeaders), sheetName: null, parseErrors: parsed.parseErrors || [] };
  }

  function normalizeClient(r, idx) {
    return {
      _row: idx + 2,
      codeClient: U().cleanText(r['Code client']),
      identifiant: U().cleanText(r.Identifiant),
      civilite: U().cleanText(r['Etat civil']),
      name: U().cleanText(r['Nom prenom']),
      nameKey: U().normText(r['Nom prenom']),
      address1: U().cleanText(r['Adresse 1']),
      address2: U().cleanText(r['Adresse 2']),
      address3: U().cleanText(r['Adresse 3']),
      addressKey: U().normText(r['Adresse 1']),
      postal: U().normPostal(r['Code postal']),
      city: U().cleanText(r.Ville),
      cityKey: U().normText(r.Ville),
      country: U().cleanText(r.Pays),
      phone: U().cleanText(r.Telephone),
      phoneKey: U().normPhone(r.Telephone),
      email: U().cleanText(r['E-mail']),
      emailKey: U().normEmail(r['E-mail']),
      marketingConsent: U().cleanText(r['Comm. commerciale']),
      nonCommercialConsent: U().cleanText(r['Comm. non commerciale']),
      birthday: U().cleanText(r.Anniversaire),
      age: U().toNullableNumber(r.Age),
      profession: U().cleanText(r.Profession),
      alert: U().cleanText(r.Alerte),
      createdAt: U().parseTgmDate(r['Date creation']),
      creationStore: U().cleanText(r['Creation sur'])
    };
  }

  function normalizeSale(r, idx) {
    const date = U().parseTgmDate(r.Date);
    const articleCode = U().normArticleCode(r['Code article']);
    return {
      _row: idx + 2,
      date,
      dateKey: U().dateKey(date),
      saleNo: U().cleanText(r['Num. vente']),
      ticket: U().cleanText(r.Ticket),
      vendor: U().cleanText(r.Vendeur),
      clientType: U().cleanText(r['Type de client']),
      clientName: U().cleanText(r.Client),
      clientNameKey: U().normText(r.Client),
      clientAddress: U().cleanText(r['Adresse 1']),
      clientAddressKey: U().normText(r['Adresse 1']),
      clientPostal: U().normPostal(r['Code postal']),
      clientCity: U().cleanText(r.Ville),
      clientCityKey: U().normText(r.Ville),
      clientPhone: U().cleanText(r.Telephone),
      clientPhoneKey: U().normPhone(r.Telephone),
      clientEmail: U().cleanText(r['E-mail']),
      clientEmailKey: U().normEmail(r['E-mail']),
      articleCode,
      articleCodeLoose: U().looseArticleCode(articleCode),
      designation: U().cleanText(r.Designation),
      designationComplete: U().cleanText(r['Designation complete']),
      rayon: U().cleanText(r.Rayon),
      famille: U().cleanText(r.Famille),
      sousFamille: U().cleanText(r['Sous-famille']),
      isReturn: /oui/i.test(U().cleanText(r.Retour)) || U().toNumber(r.Quantite) < 0,
      qty: U().toNumber(r.Quantite),
      purchaseHT: U().toNumber(r['Achat HT']),
      margin: U().toNumber(r.Marge),
      saleHT: U().toNumber(r['Vente HT']),
      htAvailable: U().toNullableNumber(r['Vente HT']) !== null,
      marginAvailable: U().toNullableNumber(r.Marge) !== null,
      saleTTC: U().toNumber(r['Vente TTC']),
      discountPct: U().toNumber(r['% Remise']) / 100,
      discount: U().toNumber(r.Remise),
      comment: U().cleanText(r.Commentaire),
      invoice: U().cleanText(r.Facture),
      catalogSource: U().cleanText(r['Catalogue(s)']),
      period: U().periodMeta(date),
      transactionKey: ''
    };
  }

  function normalizeCatalogue(r, idx) {
    const articleCode = U().normArticleCode(r['Code article']);
    return {
      _row: idx + 2,
      articleCode,
      articleCodeLoose: U().looseArticleCode(articleCode),
      designation: U().cleanText(r.Designation),
      year: U().toNullableNumber(r.Annee),
      rayon: U().cleanText(r.Rayon),
      famille: U().cleanText(r.Famille),
      sousFamille: U().cleanText(r['Sous-famille']),
      type: U().cleanText(r.Type),
      supplier: U().cleanText(r.Fournisseur),
      stock: U().toNumber(r.Stock),
      saleHT: U().toNumber(r['Vente HT']),
      vat: U().toNumber(r.TVA),
      saleTTC: U().toNumber(r['Vente TTC']),
      createdAt: U().parseTgmDate(r['Date de creation']),
      modifiedAt: U().parseTgmDate(r['Derniere modification']),
      catalogSource: U().cleanText(r['Catalogue(s)'])
    };
  }

  function assignTransactionKeys(sales) {
    // TGM's Ticket is preferred; Num. vente + timestamp is a deterministic fallback.
    for (const line of sales) {
      const core = line.ticket || line.saleNo || 'SANS-ID';
      line.transactionKey = `${core}|${line.date ? line.date.getTime() : ''}`;
    }
  }

  function dateRange(rows, accessor) {
    const dates = rows.map(accessor).filter(d => d instanceof Date && !Number.isNaN(d));
    if (!dates.length) return { min: null, max: null };
    let min = dates[0], max = dates[0];
    for (const d of dates) {
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return { min, max };
  }

  async function parseFile(type, file, onProgress) {
    if (!file) throw new Error('Aucun fichier sélectionné.');
    const rule = AU.FILE_RULES[type];
    if (!rule) throw new Error('Type de fichier inconnu.');
    const ext = U().cleanText(file.name).toLowerCase().split('.').pop();
    if (!rule.extensions.includes(ext)) throw new Error(`${rule.label} doit être au format ${rule.extensions.join(' / ').toUpperCase()}.`);

    onProgress?.(2, `Ouverture de ${file.name}…`);
    const parsed = type === 'ventes' ? await parseCsv(file, onProgress) : await parseExcel(file, onProgress);
    const baseReport = validateColumns(type, parsed.rows, parsed.parseErrors);
    if (!U().filenameMatches(file.name, type)) {
      baseReport.warnings.unshift(`Nom inattendu : « ${file.name} ». Le fichier a été placé manuellement dans la zone ${rule.label}, son contenu est donc contrôlé avant acceptation.`);
    }
    const metrics = validateRows(type, parsed.rows, baseReport);
    if (baseReport.errors.length) {
      return {
        ok: false, type, fileName: file.name, fileSize: file.size, rowCount: parsed.rows.length,
        sheetName: parsed.sheetName, report: { ...baseReport, metrics }, rows: null, normalized: null
      };
    }

    onProgress?.(96, 'Normalisation des données…');
    let normalized;
    if (type === 'clients') normalized = parsed.rows.map(normalizeClient);
    else if (type === 'ventes') {
      normalized = parsed.rows.map(normalizeSale);
      assignTransactionKeys(normalized);
      for (const [key,lines] of U().groupBy(normalized,l=>l.transactionKey)) {
        if (new Set(lines.map(l=>l.vendor).filter(Boolean)).size > 1) baseReport.errors.push(`Plusieurs vendeurs sur le ticket ${key.split('|')[0]} : attribution à vérifier.`);
        for (const identity of ['clientNameKey','clientEmailKey','clientPhoneKey']) {
          if (new Set(lines.map(l=>l[identity]).filter(Boolean)).size > 1) baseReport.errors.push(`Identités différentes sur le ticket ${key.split('|')[0]}.`);
        }
      }
      const range = dateRange(normalized, x => x.date);
      metrics.minDate = range.min;
      metrics.maxDate = range.max;
      metrics.transactionCount = new Set(normalized.map(x => x.transactionKey)).size;
      metrics.totalTTC = U().sum(normalized.map(x => x.saleTTC));
      metrics.totalHT = U().sum(normalized.map(x => x.saleHT));
      metrics.totalMargin = U().sum(normalized.map(x => x.margin));
      metrics.returnLines = normalized.filter(x => x.isReturn).length;
    } else normalized = parsed.rows.map(normalizeCatalogue);

    onProgress?.(100, 'Fichier validé.');
    return {
      ok: baseReport.errors.length === 0, type, fileName: file.name, fileSize: file.size, rowCount: parsed.rows.length,
      sheetName: parsed.sheetName, report: { ...baseReport, metrics }, rows: null, normalized,
      importedAt: new Date(), sourceLastModified: file.lastModified ? new Date(file.lastModified) : null
    };
  }

  return { parseFile };
})();
