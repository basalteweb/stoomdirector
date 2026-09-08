window.AU = window.AU || {};

AU.analytics = (() => {
  const U = () => AU.util;

  function sortedSignatureLines(lines) {
    return lines.map(l => [
      l.articleCode, l.qty, Number(l.saleTTC || 0).toFixed(4), Number(l.saleHT || 0).toFixed(4),
      Number(l.margin || 0).toFixed(4), l.designation, l.vendor, l.discount, l.discountPct, l.purchaseHT, l.isReturn,
      l.clientNameKey,l.clientEmailKey,l.clientPhoneKey,l.clientAddressKey,l.clientPostal,l.clientCityKey,l.rayon,l.famille,l.sousFamille
    ].join('~')).sort();
  }

  function transactionSignature(lines) {
    if (!lines.length) return '';
    const f = lines[0];
    return [
      f.transactionKey,
      f.clientEmailKey,
      f.clientPhoneKey,
      f.clientNameKey,
      ...sortedSignatureLines(lines)
    ].join('|');
  }

  function mergeSalesDatasets(datasets) {
    const accepted = [];
    const duplicateTransactions = [];
    const conflicts = [];
    const byKey = new Map();

    for (const ds of datasets) {
      const groups = U().groupBy(ds.normalized || [], x => x.transactionKey);
      for (const [key, lines] of groups) {
        const signature = transactionSignature(lines);
        if (!byKey.has(key)) {
          byKey.set(key, { signature, lines, source: ds.fileName });
          for (const line of lines) accepted.push({ ...line });
          continue;
        }
        const prev = byKey.get(key);
        if (prev.signature === signature) {
          duplicateTransactions.push({ key, keptSource: prev.source, ignoredSource: ds.fileName, lineCount: lines.length });
        } else {
          conflicts.push({ key, sourceA: prev.source, sourceB: ds.fileName, signatureA: prev.signature, signatureB: signature });
        }
      }
    }

    accepted.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0) || U().sortFrench(a.transactionKey, b.transactionKey));
    return { sales: accepted, duplicateTransactions, conflicts };
  }

  function buildClientIndexes(clients) {
    const byCode = new Map(clients.map(c => [c.codeClient, c]));
    const email = U().uniqueIndex(clients, c => c.emailKey);
    const phone = U().uniqueIndex(clients, c => c.phoneKey);
    const name = U().uniqueIndex(clients, c => c.nameKey);
    const namePostal = U().uniqueIndex(clients, c => c.nameKey && c.postal ? `${c.nameKey}|${c.postal}` : '');
    const nameAddress = U().uniqueIndex(clients, c => c.nameKey && c.addressKey ? `${c.nameKey}|${c.addressKey}` : '');
    const namePostalCity = U().uniqueIndex(clients, c => c.nameKey && (c.postal || c.cityKey) ? `${c.nameKey}|${c.postal}|${c.cityKey}` : '');
    return { byCode, email, phone, name, namePostal, nameAddress, namePostalCity };
  }

  function resolveUnique(index, key) {
    if (!key) return null;
    return index.unique.get(key) || null;
  }

  function matchTransactionToClient(lines, indexes) {
    const f = lines[0] || {};
    const evidence = [];
    const strong = [];

    const emailClient = resolveUnique(indexes.email, f.clientEmailKey);
    if (emailClient) { strong.push(emailClient); evidence.push('e-mail exact et unique'); }
    const phoneClient = resolveUnique(indexes.phone, f.clientPhoneKey);
    if (phoneClient) { strong.push(phoneClient); evidence.push('téléphone exact et unique'); }
    const addrClient = resolveUnique(indexes.nameAddress, f.clientNameKey && f.clientAddressKey ? `${f.clientNameKey}|${f.clientAddressKey}` : '');
    if (addrClient) { strong.push(addrClient); evidence.push('nom + adresse exacts'); }
    const npClient = resolveUnique(indexes.namePostal, f.clientNameKey && f.clientPostal ? `${f.clientNameKey}|${f.clientPostal}` : '');
    if (npClient) { strong.push(npClient); evidence.push('nom + code postal exacts'); }
    const npcClient = resolveUnique(indexes.namePostalCity, f.clientNameKey && (f.clientPostal || f.clientCityKey) ? `${f.clientNameKey}|${f.clientPostal}|${f.clientCityKey}` : '');
    if (npcClient) { strong.push(npcClient); evidence.push('nom + localisation exacts'); }

    const strongCodes = [...new Set(strong.map(c => c.codeClient))];
    if (strongCodes.length > 1) {
      return { client: null, quality: 'conflict', confidence: 0, evidence, reason: 'Identifiants forts contradictoires.' };
    }
    if (strongCodes.length === 1) {
      const client = indexes.byCode.get(strongCodes[0]);
      return { client, quality: 'certified', confidence: 1, evidence: [...new Set(evidence)], reason: '' };
    }

    const nameClient = resolveUnique(indexes.name, f.clientNameKey);
    if (nameClient) {
      return { client: nameClient, quality: 'probable', confidence: 0.72, evidence: ['nom exact et unique uniquement'], reason: 'Aucun identifiant fort disponible dans la vente.' };
    }

    if (!f.clientNameKey && !f.clientPhoneKey && !f.clientEmailKey) {
      return { client: null, quality: 'anonymous', confidence: 0, evidence: [], reason: 'Vente sans identité client exploitable.' };
    }
    return { client: null, quality: 'unmatched', confidence: 0, evidence: [], reason: 'Aucune fiche client unique ne correspond sans ambiguïté.' };
  }

  function attachClientMatches(sales, clients) {
    const indexes = buildClientIndexes(clients);
    const txGroups = U().groupBy(sales, x => x.transactionKey);
    const txMatches = new Map();
    for (const [key, lines] of txGroups) txMatches.set(key, matchTransactionToClient(lines, indexes));
    for (const line of sales) {
      const match = txMatches.get(line.transactionKey);
      line.clientCode = match?.client?.codeClient || '';
      line.clientMatchQuality = match?.quality || 'unmatched';
      line.clientMatchConfidence = match?.confidence || 0;
      line.clientMatchEvidence = match?.evidence || [];
      line.clientMatchReason = match?.reason || '';
    }
    return { txMatches, indexes };
  }

  function buildCatalogueIndexes(catalogue) {
    const exact = new Map(catalogue.map(c => [c.articleCode, c]));
    const looseMulti = U().indexByMulti(catalogue, c => c.articleCodeLoose);
    const looseUnique = new Map();
    const looseAmbiguous = new Map();
    for (const [k, vals] of looseMulti) {
      if (vals.length === 1) looseUnique.set(k, vals[0]);
      else looseAmbiguous.set(k, vals);
    }
    return { exact, looseUnique, looseAmbiguous };
  }

  function attachCatalogueMatches(sales, catalogue) {
    const indexes = buildCatalogueIndexes(catalogue);
    for (const line of sales) {
      let item = indexes.exact.get(line.articleCode) || null;
      let quality = item ? 'exact' : 'missing';
      if (!item && line.articleCodeLoose && !indexes.looseAmbiguous.has(line.articleCodeLoose)) {
        item = indexes.looseUnique.get(line.articleCodeLoose) || null;
        if (item) quality = 'normalized';
      }
      line.catalogueItem = item;
      line.catalogueMatchQuality = quality;
      line.effectiveRayon = line.rayon || item?.rayon || '';
      line.effectiveFamille = line.famille || item?.famille || '';
      line.effectiveSousFamille = line.sousFamille || item?.sousFamille || '';
    }
    return indexes;
  }

  function buildTransactions(sales) {
    const groups = U().groupBy(sales, x => x.transactionKey);
    const txs = [];
    for (const [key, lines] of groups) {
      const f = lines[0];
      const ttc = U().sum(lines.map(x => x.saleTTC));
      const ht = U().sum(lines.map(x => x.saleHT));
      const margin = U().sum(lines.map(x => x.margin));
      const qty = U().sum(lines.map(x => x.qty));
      const discount = U().sum(lines.map(x => x.discount));
      txs.push({
        key, date: f.date, dateKey: f.dateKey, saleNo: f.saleNo, ticket: f.ticket, vendor: f.vendor,
        clientCode: f.clientCode, clientName: f.clientName, clientCity: f.clientCity, clientPostal: f.clientPostal, clientMatchQuality: f.clientMatchQuality,
        clientMatchConfidence: f.clientMatchConfidence, clientMatchEvidence: f.clientMatchEvidence,
        clientMatchReason: f.clientMatchReason, ttc, ht, margin, qty, discount,
        hasReturn: lines.some(x => x.isReturn), lines,
        rayons: [...new Set(lines.map(x => x.effectiveRayon).filter(Boolean))],
        period: f.period
      });
    }
    txs.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
    return txs;
  }

  function getDateRangeFromSales(sales) {
    const dates = sales.map(s => s.date).filter(Boolean);
    if (!dates.length) return { min: null, max: null };
    let min = dates[0], max = dates[0];
    for (const d of dates) { if (d < min) min = d; if (d > max) max = d; }
    return { min, max };
  }

  function aggregateSimpleTransactions(txs) {
    const ttc = U().sum(txs.map(t => t.ttc));
    const ht = U().sum(txs.map(t => t.ht));
    const margin = U().sum(txs.map(t => t.margin));
    const qty = U().sum(txs.map(t => t.qty));
    const clients = new Set(txs.map(t => t.clientCode).filter(Boolean));
    const activeDays = new Set(txs.map(t => t.dateKey).filter(Boolean));
    return {
      caTTC: ttc, caHT: ht, margin, qty, tickets: txs.length, clients: clients.size,
      avgBasket: txs.length ? ttc / txs.length : 0,
      marginRate: ht ? margin / ht : null,
      activeDays: activeDays.size,
      avgPerActiveDay: activeDays.size ? ttc / activeDays.size : 0
    };
  }

  function transactionsInRange(transactions, from, to) {
    const f = from ? U().startOfDay(from) : null;
    const t = to ? U().endOfDay(to) : null;
    return transactions.filter(x => U().inRange(x.date, f, t));
  }

  function periodSummary(transactions, from, to) {
    return aggregateSimpleTransactions(transactionsInRange(transactions, from, to));
  }

  function groupSpend(lines, keyFn, labelFn) {
    const map = new Map();
    for (const l of lines) {
      const key = keyFn(l);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { key, label: labelFn(l), ca: 0, qty: 0, margin: 0, tickets: new Set(), days: new Set() });
      const a = map.get(key);
      a.ca += l.saleTTC;
      a.qty += l.qty;
      a.margin += l.margin;
      a.tickets.add(l.transactionKey);
      if (l.dateKey) a.days.add(l.dateKey);
    }
    return [...map.values()].map(a => ({ ...a, tickets: a.tickets.size, days: a.days.size })).sort((a, b) => b.ca - a.ca);
  }

  function buildCustomerProfiles(clients, transactions, sales, referenceDate, catalogueIndex) {
    const txByClient = U().groupBy(transactions.filter(t => t.clientCode), t => t.clientCode);
    const salesByClient = U().groupBy(sales.filter(s => s.clientCode), s => s.clientCode);
    const profiles = [];

    for (const client of clients) {
      const txs = (txByClient.get(client.codeClient) || []).slice().sort((a, b) => a.date - b.date);
      const lines = salesByClient.get(client.codeClient) || [];
      const visitDayMap = new Map();
      for (const tx of txs.filter(t => t.ttc > 0)) {
        if (!visitDayMap.has(tx.dateKey)) visitDayMap.set(tx.dateKey, { date: U().startOfDay(tx.date), ttc: 0, tickets: 0, lines: [] });
        const v = visitDayMap.get(tx.dateKey);
        v.ttc += tx.ttc;
        v.tickets += 1;
        v.lines.push(...tx.lines);
      }
      const visits = [...visitDayMap.values()].sort((a, b) => a.date - b.date);
      const intervals = [];
      for (let i = 1; i < visits.length; i++) intervals.push(U().daysBetween(visits[i - 1].date, visits[i].date));
      const medianInterval = U().median(intervals.filter(x => x > 0));
      const meanInterval = U().mean(intervals.filter(x => x > 0));
      const firstVisit = visits[0]?.date || null;
      const lastVisit = visits.at(-1)?.date || null;
      const daysSinceLast = lastVisit && referenceDate ? U().daysBetween(lastVisit, referenceDate) : null;
      const expectedNext = lastVisit && medianInterval ? U().addDays(lastVisit, medianInterval) : null;
      const overdueRatio = medianInterval && daysSinceLast !== null ? daysSinceLast / Math.max(1, medianInterval) : null;
      const totalSpend = U().sum(txs.map(t => t.ttc));
      const totalMargin = U().sum(txs.map(t => t.margin));
      const avgBasket = txs.length ? totalSpend / txs.length : 0;
      const avgVisit = visits.length ? totalSpend / visits.length : 0;
      const matchQualities = new Set(txs.map(t => t.clientMatchQuality));
      const identityQuality = !txs.length ? 'no-sales' : (matchQualities.has('probable') ? 'partial' : 'certified');

      let risk = { key: 'insufficient', label: 'Historique insuffisant', score: 0, severity: 0 };
      if (visits.length >= 3 && medianInterval) {
        if (overdueRatio < 1.25) risk = { key: 'active', label: 'Actif', score: U().clamp(overdueRatio / 1.25 * 25, 0, 25), severity: 0 };
        else if (overdueRatio < 1.75) risk = { key: 'watch', label: 'À surveiller', score: 40 + (overdueRatio - 1.25) * 25, severity: 1 };
        else if (overdueRatio < 2.5) risk = { key: 'risk', label: 'Risque', score: 60 + (overdueRatio - 1.75) * 20, severity: 2 };
        else risk = { key: 'high', label: 'Risque élevé', score: U().clamp(78 + (overdueRatio - 2.5) * 8, 78, 100), severity: 3 };
      } else if (visits.length === 1 && daysSinceLast !== null) {
        risk = { key: 'new', label: '1 seule visite', score: 0, severity: 0 };
      } else if (visits.length === 2 && medianInterval) {
        risk = { key: overdueRatio >= 2 ? 'watch' : 'insufficient', label: overdueRatio >= 2 ? 'À surveiller' : 'Historique court', score: overdueRatio >= 2 ? 45 : 10, severity: overdueRatio >= 2 ? 1 : 0 };
      }

      const topProducts = groupSpend(lines.filter(l => !l.isReturn), l => l.articleCode, l => l.designation).slice(0, 8);
      const topRayons = groupSpend(lines.filter(l => !l.isReturn), l => l.effectiveRayon || 'NON CLASSE', l => l.effectiveRayon || 'Non classé').slice(0, 6);
      const equipment = lines.filter(l => l.qty > 0 && l.effectiveRayon === 'MATERIEL' && AU.EQUIPMENT_FAMILIES.has(U().normText(l.effectiveFamille)))
        .map(l => ({ date: l.date, articleCode: l.articleCode, designation: l.designation, family: l.effectiveFamille, qty: l.qty, ttc: l.saleTTC }));
      const consumables = lines.filter(l => l.qty > 0 && l.effectiveRayon === 'MATERIEL' && AU.CONSUMABLE_FAMILIES.has(U().normText(l.effectiveFamille)))
        .map(l => ({ date: l.date, articleCode: l.articleCode, designation: l.designation, family: l.effectiveFamille, qty: l.qty, ttc: l.saleTTC }));

      const recentVisits = visits.slice(-3);
      const previousVisits = visits.slice(-6, -3);
      const recentAvgVisit = U().mean(recentVisits.map(v => v.ttc));
      const previousAvgVisit = U().mean(previousVisits.map(v => v.ttc));
      const basketChange = previousAvgVisit !== null && previousAvgVisit !== 0 ? (recentAvgVisit - previousAvgVisit) / Math.abs(previousAvgVisit) : null;
      const recentIntervals = intervals.slice(-3);
      const previousIntervals = intervals.slice(-6, -3);
      const recentIntervalAvg = U().mean(recentIntervals);
      const previousIntervalAvg = U().mean(previousIntervals);
      const frequencyChange = previousIntervalAvg && recentIntervalAvg ? (recentIntervalAvg - previousIntervalAvg) / previousIntervalAvg : null;

      const positiveLines = lines.filter(l => l.qty > 0 && !l.isReturn);
      const discountedSpend = U().sum(positiveLines.filter(l => l.discount > 0 || l.discountPct > 0).map(l => l.saleTTC));
      const positiveSpend = U().sum(positiveLines.map(l => l.saleTTC));
      const promoShare = positiveSpend ? discountedSpend / positiveSpend : 0;

      const signals = [];
      const favorite = topProducts[0];
      if (favorite) {
        const currentItem = catalogueIndex.exact.get(favorite.key) || catalogueIndex.looseUnique.get(U().looseArticleCode(favorite.key)) || null;
        if (!currentItem) {
          signals.push({ strength: 'fort', type: 'catalogue', text: `La référence la plus achetée (« ${favorite.label} ») n’existe plus dans le catalogue actuel.`, quality: 'fact' });
        } else if (currentItem.stock <= 0) {
          signals.push({ strength: 'moyen', type: 'stock', text: `La référence favorite est actuellement à stock ${currentItem.stock}. Cela peut compliquer une revisite, sans prouver la cause d’une absence passée.`, quality: 'signal' });
        }
      }
      if (frequencyChange !== null && frequencyChange > 0.35) {
        signals.push({ strength: 'moyen', type: 'frequency', text: `L’intervalle récent entre visites a augmenté de ${Math.round(frequencyChange * 100)} % par rapport aux visites précédentes.`, quality: 'calculated' });
      }
      if (basketChange !== null && basketChange < -0.25) {
        signals.push({ strength: 'moyen', type: 'basket', text: `Le montant moyen des 3 dernières visites est en baisse de ${Math.round(Math.abs(basketChange) * 100)} %.`, quality: 'calculated' });
      }
      const lastTx = txs.at(-1);
      if (lastTx?.hasReturn && daysSinceLast > 30) {
        signals.push({ strength: 'faible', type: 'return', text: 'La dernière journée d’achat contient un retour et aucune revisite récente n’est observée.', quality: 'signal' });
      }
      if (promoShare > 0.5 && positiveSpend > 0) {
        signals.push({ strength: 'faible', type: 'promo', text: `${Math.round(promoShare * 100)} % de ses achats positifs sont associés à une remise : forte sensibilité promotionnelle possible.`, quality: 'signal' });
      }

      const activeSpanDays = firstVisit && lastVisit ? Math.max(30, U().daysBetween(firstVisit, lastVisit) + 1) : 30;
      const estimatedMonthlyValue = totalSpend / activeSpanDays * 30;

      profiles.push({
        client, txs, lines, visits, visitCount: visits.length, transactionCount: txs.length,
        firstVisit, lastVisit, daysSinceLast, medianInterval, meanInterval, expectedNext, overdueRatio,
        totalSpend, totalMargin, avgBasket, avgVisit, identityQuality, risk, topProducts, topRayons,
        equipment, consumables, basketChange, frequencyChange, promoShare, signals, estimatedMonthlyValue
      });
    }

    profiles.sort((a, b) => b.totalSpend - a.totalSpend);
    return profiles;
  }

  function buildProductProfiles(sales, transactions, catalogue, referenceDate) {
    const byCode = U().groupBy(sales, x => x.catalogueItem?.articleCode || x.articleCode || `ROW-${x._row}`);
    const txByKey = new Map(transactions.map(t => [t.key, t]));
    const catalogueExact = new Map(catalogue.map(c => [c.articleCode, c]));
    const products = [];
    const historyStart = getDateRangeFromSales(sales).min;
    const refEnd = U().endOfDay(referenceDate);
    const last30Start = U().startOfDay(U().addDays(referenceDate, -29));
    const prev30Start = U().startOfDay(U().addDays(referenceDate, -59));
    const prev30End = U().endOfDay(U().addDays(referenceDate, -30));
    const last90Start = U().startOfDay(U().addDays(referenceDate, -89));

    for (const [code, lines] of byCode) {
      const f = lines[0];
      const current = f.catalogueItem || catalogueExact.get(code) || null;
      const positive = lines.filter(l => l.qty > 0 && !l.isReturn);
      const ticketSet = new Set(lines.map(l => l.transactionKey));
      const clientSet = new Set(lines.map(l => l.clientCode).filter(Boolean));
      const clientDays = new Map();
      for (const l of positive) {
        if (!l.clientCode) continue;
        if (!clientDays.has(l.clientCode)) clientDays.set(l.clientCode, new Set());
        clientDays.get(l.clientCode).add(l.dateKey);
      }
      const repeatClients = [...clientDays.values()].filter(s => s.size >= 2).length;
      const ca = U().sum(lines.map(l => l.saleTTC));
      const margin = U().sum(lines.map(l => l.margin));
      const ht = U().sum(lines.map(l => l.saleHT));
      const qty = U().sum(lines.map(l => l.qty));
      const sale30 = U().sum(lines.filter(l => U().inRange(l.date, last30Start, refEnd)).map(l => l.saleTTC));
      const prev30 = U().sum(lines.filter(l => U().inRange(l.date, prev30Start, prev30End)).map(l => l.saleTTC));
      const qty30 = U().sum(lines.filter(l => l.qty > 0 && U().inRange(l.date, last30Start, refEnd)).map(l => l.qty));
      const qty90 = U().sum(lines.filter(l => l.qty > 0 && U().inRange(l.date, last90Start, refEnd)).map(l => l.qty));
      const observedDays = Math.max(1, Math.min(30, U().daysBetween(historyStart, referenceDate) + 1));
      const velocity30 = qty30 / observedDays;
      const stock = current ? current.stock : null;
      const coverageDays = current && velocity30 > 0 ? stock / velocity30 : null;
      let stockStatus = 'unknown';
      if (current) {
        if (stock < 0) stockStatus = 'negative';
        else if (stock === 0) stockStatus = 'out';
        else if (velocity30 > 0 && coverageDays < 7) stockStatus = 'critical';
        else if (velocity30 > 0 && coverageDays < 21) stockStatus = 'low';
        else if (qty90 <= 0 && stock > 0) stockStatus = 'dormant';
        else stockStatus = 'ok';
      }
      const unitPrices = positive.filter(l => l.qty).map(l => l.saleTTC / l.qty).filter(Number.isFinite);
      const dates = lines.map(l => l.date).filter(Boolean).sort((a, b) => a - b);
      const rayon = f.effectiveRayon || current?.rayon || '';
      const famille = f.effectiveFamille || current?.famille || '';
      products.push({
        code, designation: f.designation || current?.designation || code, rayon, famille,
        sousFamille: f.effectiveSousFamille || current?.sousFamille || '', current,
        catalogueMatch: current ? f.catalogueMatchQuality : 'missing', ca, ht, margin, qty,
        marginRate: ht ? margin / ht : null, tickets: ticketSet.size, clients: clientSet.size,
        repeatClients, repeatRate: clientSet.size ? repeatClients / clientSet.size : null,
        avgUnitPrice: U().mean(unitPrices), firstSale: dates[0] || null, lastSale: dates.at(-1) || null,
        sale30, prev30, trend30: U().pctChange(sale30, prev30), qty30, qty90, velocity30,
        stock, coverageDays, stockStatus, supplier: current?.supplier || '', currentPrice: current?.saleTTC ?? null
      });
    }
    const represented = new Set(products.map(p => p.current?.articleCode).filter(Boolean));
    for (const item of catalogue) {
      if (represented.has(item.articleCode)) continue;
      products.push({code:item.articleCode, designation:item.designation, rayon:item.rayon, famille:item.famille,
        sousFamille:item.sousFamille, current:item, catalogueMatch:'exact', ca:0, ht:0, margin:0, qty:0,
        marginRate:null, tickets:0, clients:0, repeatClients:0, repeatRate:null, avgUnitPrice:null,
        firstSale:null, lastSale:null, sale30:0, prev30:0, trend30:null, qty30:0, qty90:0, velocity30:0,
        stock:item.stock, coverageDays:null, stockStatus:item.stock<0?'negative':item.stock===0?'out':'dormant',
        supplier:item.supplier, currentPrice:item.saleTTC});
    }
    products.sort((a, b) => b.ca - a.ca);
    return products;
  }

  function buildRayonProfiles(sales, referenceDate) {
    const by = U().groupBy(sales, x => x.effectiveRayon || 'NON CLASSE');
    const refEnd = U().endOfDay(referenceDate);
    const last30Start = U().startOfDay(U().addDays(referenceDate, -29));
    const prev30Start = U().startOfDay(U().addDays(referenceDate, -59));
    const prev30End = U().endOfDay(U().addDays(referenceDate, -30));
    const rows = [];
    for (const [rayon, lines] of by) {
      const ca = U().sum(lines.map(l => l.saleTTC));
      const ht = U().sum(lines.map(l => l.saleHT));
      const margin = U().sum(lines.map(l => l.margin));
      const tickets = new Set(lines.map(l => l.transactionKey));
      const clients = new Set(lines.map(l => l.clientCode).filter(Boolean));
      const products = new Set(lines.map(l => l.articleCode).filter(Boolean));
      const ca30 = U().sum(lines.filter(l => U().inRange(l.date, last30Start, refEnd)).map(l => l.saleTTC));
      const prev30 = U().sum(lines.filter(l => U().inRange(l.date, prev30Start, prev30End)).map(l => l.saleTTC));
      rows.push({
        rayon: rayon === 'NON CLASSE' ? 'Non classé' : rayon,
        ca, ht, margin, marginRate: ht ? margin / ht : null,
        qty: U().sum(lines.map(l => l.qty)), tickets: tickets.size, clients: clients.size, products: products.size,
        ca30, prev30, trend30: U().pctChange(ca30, prev30)
      });
    }
    rows.sort((a, b) => b.ca - a.ca);
    return rows;
  }

  function buildFamilyProfiles(sales) {
    const by = U().groupBy(sales, x => `${x.effectiveRayon || 'NON CLASSE'}|${x.effectiveFamille || 'NON CLASSEE'}`);
    const rows = [];
    for (const [, lines] of by) {
      const f = lines[0];
      const ht = U().sum(lines.map(l => l.saleHT));
      const margin = U().sum(lines.map(l => l.margin));
      rows.push({
        rayon: f.effectiveRayon || 'Non classé', famille: f.effectiveFamille || 'Non classée',
        ca: U().sum(lines.map(l => l.saleTTC)), ht, margin, marginRate: ht ? margin / ht : null,
        qty: U().sum(lines.map(l => l.qty)), tickets: new Set(lines.map(l => l.transactionKey)).size,
        clients: new Set(lines.map(l => l.clientCode).filter(Boolean)).size,
        products: new Set(lines.map(l => l.articleCode).filter(Boolean)).size
      });
    }
    rows.sort((a, b) => b.ca - a.ca);
    return rows;
  }

  function buildDailyProfiles(transactions) {
    const by = U().groupBy(transactions, t => t.dateKey);
    const rows = [];
    for (const [key, txs] of by) {
      const date = txs[0].date;
      const meta = txs[0].period || U().periodMeta(date);
      rows.push({ date, dateKey: key, ...aggregateSimpleTransactions(txs), ...meta });
    }
    rows.sort((a, b) => a.date - b.date);
    return rows;
  }

  function buildHolidayComparison(daily) {
    const school = daily.filter(d => d.isSchoolHoliday);
    const normal = daily.filter(d => !d.isSchoolHoliday);
    const aggregateDays = rows => ({
      activeDays: rows.length,
      ca: U().sum(rows.map(r => r.caTTC)),
      tickets: U().sum(rows.map(r => r.tickets)),
      clientsApprox: U().sum(rows.map(r => r.clients)),
      avgCaDay: rows.length ? U().sum(rows.map(r => r.caTTC)) / rows.length : 0,
      avgTicketsDay: rows.length ? U().sum(rows.map(r => r.tickets)) / rows.length : 0,
      avgBasket: U().sum(rows.map(r => r.tickets)) ? U().sum(rows.map(r => r.caTTC)) / U().sum(rows.map(r => r.tickets)) : 0
    });
    const s = aggregateDays(school);
    const n = aggregateDays(normal);
    return { school: s, normal: n, caDayDelta: U().pctChange(s.avgCaDay, n.avgCaDay), basketDelta: U().pctChange(s.avgBasket, n.avgBasket) };
  }

  function monthDiff(a, b) {
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  }

  function buildCohorts(customers, referenceDate, maxOffset = 6) {
    const eligible = customers.filter(c => c.firstVisit);
    const byCohort = U().groupBy(eligible, c => U().monthKey(c.firstVisit));
    const rows = [];
    for (const [cohort, members] of byCohort) {
      const cohortDate = new Date(Number(cohort.slice(0,4)), Number(cohort.slice(5,7)) - 1, 1);
      const retention = [];
      for (let offset = 0; offset <= maxOffset; offset++) {
        let retained = 0;
        for (const c of members) {
          const months = new Set(c.visits.map(v => U().monthKey(v.date)));
          const target = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + offset, 1);
          if (months.has(U().monthKey(target))) retained++;
        }
        const targetMonth = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + offset, 1);
        const referenceMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
        const observed = targetMonth <= referenceMonth;
        retention.push({ offset, retained: observed ? retained : null, rate: observed && members.length ? retained / members.length : null, complete: targetMonth < referenceMonth });
      }
      rows.push({
        cohort, size: members.length,
        totalSpend: U().sum(members.map(c => c.totalSpend)),
        avgSpend: members.length ? U().sum(members.map(c => c.totalSpend)) / members.length : 0,
        retention
      });
    }
    rows.sort((a, b) => a.cohort.localeCompare(b.cohort));
    return rows;
  }

  function buildVendorProfiles(transactions) {
    const by = U().groupBy(transactions, t => t.vendor || 'NON RENSEIGNE');
    const rows = [];
    for (const [vendor, txs] of by) {
      const agg = aggregateSimpleTransactions(txs);
      const discount = U().sum(txs.map(t => t.discount));
      const discountedTickets = txs.filter(t => t.discount > 0).length;
      rows.push({
        vendor: vendor === 'NON RENSEIGNE' ? 'Non renseigné' : vendor,
        ...agg,
        discount,
        discountedTickets,
        discountedShare: txs.length ? discountedTickets / txs.length : 0
      });
    }
    rows.sort((a, b) => b.caTTC - a.caTTC);
    return rows;
  }

  function buildGeography(transactions) {
    const matched = transactions.filter(t => t.clientCode && (t.clientCity || t.clientPostal));
    const by = U().groupBy(matched, t => `${t.clientPostal || ''}|${t.clientCity || 'Non renseignée'}`);
    const rows = [];
    for (const [key, txs] of by) {
      const [postal, city] = key.split('|');
      const agg = aggregateSimpleTransactions(txs);
      rows.push({ postal, city, ...agg });
    }
    rows.sort((a, b) => b.caTTC - a.caTTC);
    return rows;
  }

  function buildDiscountAnalysis(transactions) {
    const discounted = transactions.filter(t => t.discount > 0);
    const fullPrice = transactions.filter(t => !(t.discount > 0));
    return {
      discounted: aggregateSimpleTransactions(discounted),
      fullPrice: aggregateSimpleTransactions(fullPrice),
      discountAmount: U().sum(discounted.map(t => t.discount)),
      discountedShare: transactions.length ? discounted.length / transactions.length : 0
    };
  }

  function buildAssociations(transactions, maxProducts = 160, minPairCount = 4) {
    const txItems = [];
    const frequency = new Map();
    for (const tx of transactions) {
      const items = [...new Set(tx.lines.filter(l => l.qty > 0 && !l.isReturn && l.articleCode).map(l => l.articleCode))];
      txItems.push(items);
      for (const item of items) frequency.set(item, (frequency.get(item) || 0) + 1);
    }
    const eligible = new Set([...frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxProducts).map(x => x[0]));
    const pairs = new Map();
    for (const items0 of txItems) {
      const items = items0.filter(x => eligible.has(x)).sort();
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const key = `${items[i]}|||${items[j]}`;
          pairs.set(key, (pairs.get(key) || 0) + 1);
        }
      }
    }
    const N = transactions.length || 1;
    const results = [];
    for (const [key, count] of pairs) {
      if (count < minPairCount) continue;
      const [a, b] = key.split('|||');
      const fa = frequency.get(a) || 0;
      const fb = frequency.get(b) || 0;
      const confAB = fa ? count / fa : 0;
      const confBA = fb ? count / fb : 0;
      const lift = fb ? confAB / (fb / N) : 0;
      results.push({ a, b, count, support: count / N, confidenceAB: confAB, confidenceBA: confBA, lift, score: lift * Math.sqrt(count) });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 80);
  }

  function buildQuality(model, salesMerge, imports) {
    const txs = model.transactions;
    const matchCounts = { certified: 0, probable: 0, anonymous: 0, unmatched: 0, conflict: 0 };
    for (const tx of txs) matchCounts[tx.clientMatchQuality] = (matchCounts[tx.clientMatchQuality] || 0) + 1;
    const catalogCounts = { exact: 0, normalized: 0, missing: 0 };
    let missingCatalogCA = 0;
    let missingCategoryLines = 0;
    for (const l of model.sales) {
      catalogCounts[l.catalogueMatchQuality] = (catalogCounts[l.catalogueMatchQuality] || 0) + 1;
      if (l.catalogueMatchQuality === 'missing') missingCatalogCA += l.saleTTC;
      if (!l.effectiveRayon) missingCategoryLines++;
    }
    const totalTx = txs.length || 1;
    const totalLines = model.sales.length || 1;
    const clientCertifiedCoverage = matchCounts.certified / totalTx;
    const clientAnyCoverage = (matchCounts.certified + matchCounts.probable) / totalTx;
    const catalogueCoverage = (catalogCounts.exact + catalogCounts.normalized) / totalLines;
    const saleImports = Array.isArray(imports.ventes) ? imports.ventes : (imports.ventes ? [imports.ventes] : []);
    let financial = null;
    if (saleImports.length) {
      let checked = 0, mismatches = 0;
      for (const imp of saleImports) {
        checked += imp?.report?.metrics?.financialChecked || 0;
        mismatches += imp?.report?.metrics?.financialMismatch || 0;
      }
      financial = checked ? 1 - mismatches / checked : null;
    }
    const blocking = [];
    if (salesMerge.conflicts.length) blocking.push(`${salesMerge.conflicts.length} conflit(s) de transaction entre fichiers Ventes.`);
    if (matchCounts.conflict) blocking.push(`${matchCounts.conflict} transaction(s) avec identifiants clients contradictoires.`);
    return {
      matchCounts, catalogCounts, clientCertifiedCoverage, clientAnyCoverage, catalogueCoverage,
      financialIntegrity: financial, missingCatalogCA, missingCategoryLines,
      duplicateTransactionsIgnored: salesMerge.duplicateTransactions.length,
      transactionConflicts: salesMerge.conflicts.length,
      blocking,
      analysisAllowed: blocking.length === 0,
      status: blocking.length ? 'blocked' : (clientCertifiedCoverage === 1 && catalogueCoverage === 1 && !missingCategoryLines ? 'certified' : 'partial')
    };
  }

  function buildInsights(model) {
    const insights = [];
    const ref = model.range.max;
    if (!ref) return insights;
    const currentStart = U().startOfDay(U().addDays(ref, -29));
    const prevStart = U().startOfDay(U().addDays(ref, -59));
    const prevEnd = U().endOfDay(U().addDays(ref, -30));
    const current = periodSummary(model.transactions, currentStart, ref);
    const previous = periodSummary(model.transactions, prevStart, prevEnd);
    const delta = U().pctChange(current.caTTC, previous.caTTC);
    if (delta !== null) {
      insights.push({
        level: Math.abs(delta) >= 0.15 ? 'important' : 'info',
        title: `CA sur 30 jours ${delta >= 0 ? 'en hausse' : 'en baisse'} de ${Math.abs(delta * 100).toFixed(1)} %`,
        detail: `${U().money(current.caTTC)} contre ${U().money(previous.caTTC)} sur les 30 jours précédents.`,
        quality: 'calculated'
      });
    }

    const growing = model.rayons.filter(r => r.prev30 > 100 && r.trend30 !== null).sort((a, b) => b.trend30 - a.trend30)[0];
    const falling = model.rayons.filter(r => r.prev30 > 100 && r.trend30 !== null).sort((a, b) => a.trend30 - b.trend30)[0];
    if (growing && growing.trend30 > 0.08) insights.push({ level: 'positive', title: `Rayon moteur : ${growing.rayon}`, detail: `+${(growing.trend30 * 100).toFixed(1)} % de CA sur les 30 derniers jours vs les 30 précédents.`, quality: 'calculated' });
    if (falling && falling.trend30 < -0.08) insights.push({ level: 'warning', title: `Rayon à surveiller : ${falling.rayon}`, detail: `${(falling.trend30 * 100).toFixed(1)} % de CA sur les 30 derniers jours vs les 30 précédents.`, quality: 'calculated' });

    const highRisk = model.customers.filter(c => c.risk.key === 'high' && c.totalSpend > 0).sort((a, b) => b.estimatedMonthlyValue - a.estimatedMonthlyValue);
    if (highRisk.length) {
      insights.push({ level: 'warning', title: `${highRisk.length} client(s) réguliers à risque élevé`, detail: `Valeur mensuelle historique estimée des 10 premiers : ${U().money(U().sum(highRisk.slice(0, 10).map(c => c.estimatedMonthlyValue)))}.`, quality: 'estimate' });
    }

    const stockCritical = model.products.filter(p => ['negative', 'out', 'critical'].includes(p.stockStatus) && p.qty30 > 0);
    if (stockCritical.length) insights.push({ level: 'warning', title: `${stockCritical.length} référence(s) actives sous tension de stock`, detail: 'Stock négatif, nul ou couverture calculée inférieure à 7 jours pour des références vendues récemment.', quality: 'calculated' });

    if (model.quality.catalogCounts.missing) {
      insights.push({ level: 'quality', title: `${model.quality.catalogCounts.missing} ligne(s) de vente sans référence catalogue actuelle`, detail: `${U().money(model.quality.missingCatalogCA)} de CA historique sont concernés. Les catégories ne sont jamais inventées si elles manquent aussi dans l’export Ventes.`, quality: 'fact' });
    }

    const hol = model.holidayComparison;
    if (hol.school.activeDays >= 3 && hol.normal.activeDays >= 3 && hol.caDayDelta !== null) {
      insights.push({
        level: 'info',
        title: `Vacances scolaires Zone A : ${hol.caDayDelta >= 0 ? '+' : ''}${(hol.caDayDelta * 100).toFixed(1)} % de CA par jour actif`,
        detail: `${U().money(hol.school.avgCaDay)} / jour actif en vacances contre ${U().money(hol.normal.avgCaDay)} hors vacances sur la période chargée.`,
        quality: 'calculated'
      });
    }
    return insights;
  }

  function buildModel({ clientsImport, salesImports, catalogueImport }) {
    if (!clientsImport?.ok || !catalogueImport?.ok || !salesImports?.length || salesImports.some(x => !x.ok)) {
      throw new Error('Les trois sources doivent être validées avant le croisement.');
    }
    const salesMerge = mergeSalesDatasets(salesImports);
    const clients = clientsImport.normalized.slice();
    const catalogue = catalogueImport.normalized.slice();
    const sales = salesMerge.sales;
    const range = getDateRangeFromSales(sales);
    const clientAttachment = attachClientMatches(sales, clients);
    const catalogueIndexes = attachCatalogueMatches(sales, catalogue);
    const transactions = buildTransactions(sales);

    const model = {
      clients, catalogue, sales, transactions, range,
      clientsByCode: clientAttachment.indexes.byCode,
      catalogueIndexes,
      salesMerge,
      imports: { clients: clientsImport, ventes: salesImports, catalogue: catalogueImport }
    };
    model.customers = buildCustomerProfiles(clients, transactions, sales, range.max, catalogueIndexes);
    model.products = buildProductProfiles(sales, transactions, catalogue, range.max);
    model.rayons = buildRayonProfiles(sales, range.max);
    model.families = buildFamilyProfiles(sales);
    model.daily = buildDailyProfiles(transactions);
    model.holidayComparison = buildHolidayComparison(model.daily);
    model.associations = buildAssociations(transactions);
    model.cohorts = buildCohorts(model.customers, range.max);
    model.vendors = buildVendorProfiles(transactions);
    model.geography = buildGeography(transactions);
    model.discountAnalysis = buildDiscountAnalysis(transactions);
    model.productByCode = new Map(model.products.map(p => [p.code, p]));
    for (const line of sales) { const canonical = line.catalogueItem?.articleCode; if(canonical && model.productByCode.has(canonical)) model.productByCode.set(line.articleCode,model.productByCode.get(canonical)); }
    model.customerByCode = new Map(model.customers.map(c => [c.client.codeClient, c]));
    model.quality = buildQuality(model, salesMerge, model.imports);
    model.overview = aggregateSimpleTransactions(transactions);
    const provided = (field, flag) => sales.every(l => l[flag] === true || (l[flag] === undefined && salesImports.every(i => (i.report?.columns || []).includes(field))));
    model.financialAvailability = {ht:provided('Vente HT','htAvailable'), margin:provided('Marge','marginAvailable'), discount:salesImports.every(i=>(i.report?.columns||[]).includes('Remise'))};
    if(!model.financialAvailability.margin) {
      model.overview.margin=null;model.overview.marginRate=null;
      for(const p of model.products){p.margin=null;p.marginRate=null;}
      for(const c of model.customers)c.totalMargin=null;
      for(const r of model.rayons){r.margin=null;r.marginRate=null;}
    }
    if(!model.financialAvailability.ht){model.overview.caHT=null;model.overview.marginRate=null;for(const p of model.products){p.ht=null;p.marginRate=null;}}
    model.geoIntelligence = AU.geo?.analyze ? AU.geo.analyze(model) : null;
    model.intelligence = AU.intelligence?.analyze ? AU.intelligence.analyze(model) : null;
    model.autopilot = AU.autopilot?.run ? AU.autopilot.run(model) : null;
    model.insights = buildInsights(model);
    return model;
  }

  function periodComparison(model, fromA, toA, fromB, toB) {
    const A = periodSummary(model.transactions, fromA, toA);
    const B = periodSummary(model.transactions, fromB, toB);
    const deltas = {};
    for (const k of ['caTTC', 'caHT', 'margin', 'qty', 'tickets', 'clients', 'avgBasket', 'avgPerActiveDay']) deltas[k] = U().pctChange(A[k], B[k]);
    return { A, B, deltas };
  }

  return {
    mergeSalesDatasets, buildModel, periodSummary, periodComparison, transactionsInRange
  };
})();
