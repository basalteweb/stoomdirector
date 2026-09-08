window.AU = window.AU || {};

AU.intelligence = (() => {
  const U = () => AU.util;
  const DAY = 86400000;

  function safeDiv(a, b) { return b ? a / b : null; }
  function abs(x) { return Math.abs(Number(x) || 0); }
  function round1(x) { return Math.round((Number(x) || 0) * 10) / 10; }
  function pct(x) { return x === null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)} %`; }
  function dateKey(d) { return d ? U().dateKey(d) : ''; }
  function dateRangeLabel(a, b) { return `${U().formatDate(a)} → ${U().formatDate(b)}`; }

  function windowEnding(ref, days, offsetDays = 0) {
    const end = U().endOfDay(U().addDays(ref, -offsetDays));
    const start = U().startOfDay(U().addDays(ref, -(offsetDays + days - 1)));
    return { start, end, days, label: dateRangeLabel(start, end) };
  }

  function detectReferenceBoundary(model) {
    const max = model.range.max;
    if (!max) return { referenceDate: null, partialLastDay: false, lastMinute: null, typicalLastMinute: null };
    const byDay = U().groupBy(model.transactions.filter(t=>t.date), t=>t.dateKey);
    const dailyLastMinutes = [];
    for (const [key, txs] of byDay) {
      const latest = txs.reduce((m,t)=>!m || t.date>m ? t.date : m, null);
      if (!latest) continue;
      dailyLastMinutes.push({ key, date: U().startOfDay(latest), minute: latest.getHours()*60+latest.getMinutes() });
    }
    dailyLastMinutes.sort((a,b)=>a.date-b.date);
    const lastKey = U().dateKey(max);
    const last = dailyLastMinutes.find(x=>x.key===lastKey);
    const history = dailyLastMinutes.filter(x=>x.key!==lastKey && U().daysBetween(x.date,max)<=60).slice(-35).map(x=>x.minute);
    const typical = U().median(history);
    const partial = Boolean(last && typical !== null && history.length>=10 && last.minute < typical-120);
    const referenceDate = partial ? U().endOfDay(U().addDays(U().startOfDay(max),-1)) : max;
    return { referenceDate, partialLastDay:partial, lastMinute:last?.minute ?? null, typicalLastMinute:typical };
  }

  function comparisonDays(model, referenceDate) {
    if (!referenceDate || !model.range.min) return 30;
    const available = Math.max(1, U().daysBetween(model.range.min, referenceDate)+1);
    if (available >= 60) return 30;
    if (available >= 28) return Math.max(10, Math.floor(available/2));
    if (available >= 14) return 7;
    return Math.max(3, Math.floor(available/2));
  }

  function txIn(model, w) { return model.transactions.filter(t => U().inRange(t.date, w.start, w.end)); }
  function linesIn(model, w) { return model.sales.filter(l => U().inRange(l.date, w.start, w.end)); }

  function aggregateTx(txs) {
    const caTTC = U().sum(txs.map(t => t.ttc));
    const caHT = U().sum(txs.map(t => t.ht));
    const margin = U().sum(txs.map(t => t.margin));
    const tickets = txs.length;
    const clients = new Set(txs.map(t => t.clientCode).filter(Boolean)).size;
    const qty = U().sum(txs.map(t => t.qty));
    const discount = U().sum(txs.map(t => t.discount));
    const discountedTickets = txs.filter(t => t.discount > 0).length;
    const activeDays = new Set(txs.map(t => t.dateKey).filter(Boolean)).size;
    return {
      caTTC, caHT, margin, tickets, clients, qty, discount, discountedTickets, activeDays,
      avgBasket: tickets ? caTTC / tickets : 0,
      marginRate: caHT ? margin / caHT : null,
      discountedShare: tickets ? discountedTickets / tickets : 0,
      caPerActiveDay: activeDays ? caTTC / activeDays : 0
    };
  }

  function aggregateLines(lines) {
    const tickets = new Set(lines.map(l => l.transactionKey));
    const clients = new Set(lines.map(l => l.clientCode).filter(Boolean));
    const caTTC = U().sum(lines.map(l => l.saleTTC));
    const caHT = U().sum(lines.map(l => l.saleHT));
    const margin = U().sum(lines.map(l => l.margin));
    const qty = U().sum(lines.map(l => l.qty));
    return {
      caTTC, caHT, margin, qty, tickets: tickets.size, clients: clients.size,
      marginRate: caHT ? margin / caHT : null
    };
  }

  function groupDelta(currentLines, previousLines, keyFn, labelFn) {
    const cur = U().groupBy(currentLines, keyFn);
    const prev = U().groupBy(previousLines, keyFn);
    const keys = new Set([...cur.keys(), ...prev.keys()]);
    const rows = [];
    for (const key of keys) {
      if (!key) continue;
      const aLines = cur.get(key) || [];
      const bLines = prev.get(key) || [];
      const A = aggregateLines(aLines);
      const B = aggregateLines(bLines);
      const sample = aLines[0] || bLines[0];
      const delta = A.caTTC - B.caTTC;
      rows.push({
        key,
        label: labelFn(sample, key),
        current: A,
        previous: B,
        delta,
        trend: U().pctChange(A.caTTC, B.caTTC)
      });
    }
    return rows.sort((a, b) => abs(b.delta) - abs(a.delta));
  }

  function severityRank(level) {
    return { critical: 5, warning: 4, opportunity: 3, positive: 2, info: 1, quality: 0 }[level] ?? 1;
  }

  function confLabel(score) {
    if (score >= 90) return 'Très forte';
    if (score >= 75) return 'Forte';
    if (score >= 55) return 'Moyenne';
    return 'Faible';
  }

  function finding(input) {
    const confidence = U().clamp(Math.round(input.confidence ?? 100), 0, 100);
    const impactAmount = Number(input.impactAmount || 0);
    const score = (severityRank(input.level) * 30) + Math.min(35, abs(impactAmount) / 100) + confidence / 10;
    return {
      id: input.id,
      category: input.category || 'general',
      level: input.level || 'info',
      title: input.title,
      summary: input.summary || '',
      explanation: input.explanation || '',
      impactAmount,
      impactLabel: input.impactLabel || '',
      confidence,
      confidenceLabel: confLabel(confidence),
      quality: input.quality || 'calculated',
      facts: input.facts || [],
      hypotheses: input.hypotheses || [],
      actions: input.actions || [],
      entities: input.entities || [],
      score
    };
  }

  function trafficBasketDiagnosis(current, previous) {
    const totalDelta = current.caTTC - previous.caTTC;
    const trafficEffect = (current.tickets - previous.tickets) * previous.avgBasket;
    const basketEffect = current.tickets * (current.avgBasket - previous.avgBasket);
    const residual = totalDelta - trafficEffect - basketEffect;
    const trafficShare = totalDelta ? trafficEffect / totalDelta : null;
    const basketShare = totalDelta ? basketEffect / totalDelta : null;
    return { totalDelta, trafficEffect, basketEffect, residual, trafficShare, basketShare };
  }

  function customerPeriodMovement(model, currentWindow, previousWindow) {
    const curTx = txIn(model, currentWindow).filter(t => t.clientCode);
    const prevTx = txIn(model, previousWindow).filter(t => t.clientCode);
    const curSet = new Set(curTx.map(t => t.clientCode));
    const prevSet = new Set(prevTx.map(t => t.clientCode));
    const retained = new Set([...curSet].filter(x => prevSet.has(x)));
    const incoming = new Set([...curSet].filter(x => !prevSet.has(x)));
    const absent = new Set([...prevSet].filter(x => !curSet.has(x)));
    const caFor = (txs, set) => U().sum(txs.filter(t => set.has(t.clientCode)).map(t => t.ttc));
    return {
      currentClients: curSet.size,
      previousClients: prevSet.size,
      retained: retained.size,
      incoming: incoming.size,
      absent: absent.size,
      retentionRate: prevSet.size ? retained.size / prevSet.size : null,
      incomingCA: caFor(curTx, incoming),
      absentPreviousCA: caFor(prevTx, absent),
      retainedCurrentCA: caFor(curTx, retained),
      retainedPreviousCA: caFor(prevTx, retained),
      incomingCodes: incoming,
      absentCodes: absent,
      retainedCodes: retained
    };
  }

  function discountPeriod(txs) {
    const a = aggregateTx(txs);
    return { share: a.discountedShare, amount: a.discount, tickets: a.discountedTickets, marginRate: a.marginRate, avgBasket: a.avgBasket };
  }

  function productPeriodRows(model, currentLines, previousLines) {
    const rows = groupDelta(currentLines, previousLines, l => l.articleCode, (l, k) => l?.designation || k);
    const curBy = U().groupBy(currentLines.filter(l => l.qty > 0 && !l.isReturn), l => l.articleCode);
    const prevBy = U().groupBy(previousLines.filter(l => l.qty > 0 && !l.isReturn), l => l.articleCode);
    const unitPrice = lines => {
      if (!lines?.length) return null;
      const qty = U().sum(lines.map(l => l.qty));
      return qty ? U().sum(lines.map(l => l.saleTTC)) / qty : null;
    };
    for (const r of rows) {
      const p = model.productByCode.get(r.key);
      r.product = p || null;
      r.currentUnitPrice = unitPrice(curBy.get(r.key));
      r.previousUnitPrice = unitPrice(prevBy.get(r.key));
      r.priceDelta = r.currentUnitPrice !== null && r.previousUnitPrice ? (r.currentUnitPrice - r.previousUnitPrice) / abs(r.previousUnitPrice) : null;
    }
    return rows;
  }

  function migrationForDecliningProduct(model, productRow, currentWindow, previousWindow) {
    const code = productRow.key;
    const product = productRow.product;
    if (!product?.famille) return null;
    const prevBuyers = new Set(model.sales.filter(l => l.articleCode === code && l.clientCode && l.qty > 0 && U().inRange(l.date, previousWindow.start, previousWindow.end)).map(l => l.clientCode));
    if (prevBuyers.size < 4) return null;
    const currentAltLines = model.sales.filter(l => l.clientCode && prevBuyers.has(l.clientCode) && l.articleCode !== code && l.qty > 0 && !l.isReturn && l.effectiveFamille === product.famille && U().inRange(l.date, currentWindow.start, currentWindow.end));
    const buyersOnAlt = new Set(currentAltLines.map(l => l.clientCode));
    if (!buyersOnAlt.size) return null;
    const byAlt = U().groupBy(currentAltLines, l => l.articleCode);
    const alternatives = [...byAlt.entries()].map(([alt, lines]) => ({
      code: alt,
      designation: lines[0]?.designation || alt,
      clients: new Set(lines.map(l => l.clientCode)).size,
      ca: U().sum(lines.map(l => l.saleTTC))
    })).sort((a, b) => b.clients - a.clients || b.ca - a.ca);
    return { prevBuyers: prevBuyers.size, migrated: buyersOnAlt.size, rate: buyersOnAlt.size / prevBuyers.size, alternatives };
  }

  function buildAnomalies(model, ref) {
    const findings = [];
    const daily = model.daily.filter(d => d.date <= ref);
    const recent = daily.slice(-10);
    for (const day of recent) {
      const weekday = day.date.getDay();
      const historical = daily.filter(d => d.date < day.date && d.date.getDay() === weekday && U().daysBetween(d.date, day.date) <= 120).slice(-12);
      if (historical.length < 5) continue;
      const values = historical.map(d => d.caTTC);
      const med = U().median(values);
      if (!med || med < 100) continue;
      const deviations = values.map(v => abs(v - med));
      const mad = U().median(deviations) || 1;
      const robustZ = 0.6745 * (day.caTTC - med) / mad;
      const deviation = (day.caTTC - med) / med;
      if (abs(robustZ) >= 2.8 && abs(deviation) >= 0.25) {
        findings.push(finding({
          id: `anomaly-${day.dateKey}`,
          category: 'anomaly',
          level: deviation < 0 ? 'warning' : 'positive',
          title: `${deviation < 0 ? 'Cette journée a été nettement plus faible que d’habitude' : 'Cette journée a été exceptionnellement forte'} · ${U().formatDate(day.date)}`,
          summary: `${U().money(day.caTTC)} ce jour-là contre environ ${U().money(med)} habituellement pour un ${String(day.period?.weekdayName || 'jour comparable').toLowerCase()}.`,
          explanation: 'Power compare cette journée aux mêmes jours de la semaine récents pour éviter une comparaison trompeuse.',
          impactAmount: day.caTTC - med,
          confidence: Math.min(98, 75 + abs(robustZ) * 4),
          quality: 'calculated',
          facts: [`${historical.length} journées du même type ont servi de référence.`, `Écart de CA : ${U().money(day.caTTC-med)} par rapport au niveau habituel.`],
          actions: deviation < 0 ? ['Regarder les produits, clients et éventuelles perturbations propres à cette date.'] : ['Identifier les produits et clients qui ont porté cette journée pour voir ce qui peut être reproduit.']
        }));
      }
    }
    return findings;
  }

  function buildCoreFindings(model, currentWindow, previousWindow) {
    const findings = [];
    const currentTx = txIn(model, currentWindow);
    const previousTx = txIn(model, previousWindow);
    const currentLines = linesIn(model, currentWindow);
    const previousLines = linesIn(model, previousWindow);
    const current = aggregateTx(currentTx);
    const previous = aggregateTx(previousTx);
    const caDelta = U().pctChange(current.caTTC, previous.caTTC);
    const marginDelta = U().pctChange(current.margin, previous.margin);
    const ticketDelta = U().pctChange(current.tickets, previous.tickets);
    const basketDelta = U().pctChange(current.avgBasket, previous.avgBasket);
    const decomposition = trafficBasketDiagnosis(current, previous);

    if (caDelta !== null) {
      const down = caDelta < 0;
      const level = down ? (caDelta <= -0.15 ? 'critical' : caDelta <= -0.06 ? 'warning' : 'info') : (caDelta >= 0.08 ? 'positive' : 'info');
      const dominant = abs(decomposition.trafficEffect) >= abs(decomposition.basketEffect) ? 'visites' : 'panier';
      const mainReason = dominant==='visites'
        ? (down ? 'La baisse vient surtout de moins de passages en magasin.' : 'La hausse vient surtout de davantage de passages en magasin.')
        : (down ? 'La baisse vient surtout d’un panier moyen plus faible.' : 'La hausse vient surtout d’un panier moyen plus élevé.');
      findings.push(finding({
        id: 'turnover-main', category: 'turnover', level,
        title: `Le chiffre d’affaires ${down ? 'baisse' : 'progresse'} de ${abs(caDelta * 100).toFixed(1)} %`,
        summary: `${U().money(current.caTTC)} contre ${U().money(previous.caTTC)} sur la période précédente. ${mainReason}`,
        explanation: `Power vérifie séparément le nombre de passages et le panier moyen pour savoir lequel explique le plus le changement de chiffre d’affaires.`,
        impactAmount: current.caTTC - previous.caTTC,
        confidence: 100,
        quality: 'calculated',
        facts: [
          `Tickets : ${U().integer(current.tickets)} maintenant contre ${U().integer(previous.tickets)} auparavant (${pct(ticketDelta)}).`,
          `Panier moyen : ${U().money(current.avgBasket)} maintenant contre ${U().money(previous.avgBasket)} auparavant (${pct(basketDelta)}).`,
          `${Math.abs(decomposition.trafficEffect)>=Math.abs(decomposition.basketEffect)?'Le nombre de passages pèse le plus dans le changement observé.':'Le panier moyen pèse le plus dans le changement observé.'}`
        ],
        actions: down ? [dominant === 'visites' ? 'Commencer par identifier quels clients, jours ou zones expliquent la baisse de passages.' : 'Commencer par identifier les rayons, familles ou quantités qui font baisser le panier.'] : ['Identifier ce qui porte la hausse et sécuriser les produits concernés.']
      }));
    }

    if (marginDelta !== null) {
      const rateDelta = current.marginRate !== null && previous.marginRate !== null ? current.marginRate - previous.marginRate : null;
      if (abs(marginDelta) >= 0.05 || (rateDelta !== null && abs(rateDelta) >= 0.02)) {
        findings.push(finding({
          id: 'margin-main', category: 'margin', level: marginDelta < -0.07 ? 'warning' : marginDelta > 0.07 ? 'positive' : 'info',
          title: `La marge ${marginDelta >= 0 ? 'progresse' : 'baisse'} de ${abs(marginDelta * 100).toFixed(1)} %`,
          summary: `${U().money(current.margin)} de marge maintenant contre ${U().money(previous.margin)} auparavant.${rateDelta === null ? '' : rateDelta < -0.01 ? ' La rentabilité par euro vendu baisse également.' : rateDelta > 0.01 ? ' La rentabilité par euro vendu s’améliore également.' : ' La rentabilité par euro vendu reste proche.'}`,
          explanation: 'Power vérifie si la marge change seulement parce que le chiffre d’affaires change, ou si les remises et le mix produits réduisent aussi la rentabilité.',
          impactAmount: current.margin - previous.margin,
          confidence: 100, quality: 'calculated',
          facts: [`Marge : ${U().money(current.margin)} maintenant contre ${U().money(previous.margin)} auparavant.`, rateDelta===null?'Le pourcentage de marge n’est pas comparable avec les données disponibles.':`Part de marge : ${U().percent(current.marginRate)} maintenant contre ${U().percent(previous.marginRate)} auparavant.`],
          actions: marginDelta < 0 ? ['Regarder en priorité les familles en baisse, les remises et les produits dont la marge se dégrade.'] : []
        }));
      }
    }

    const rayonRows = groupDelta(currentLines, previousLines, l => l.effectiveRayon || 'NON CLASSE', (l, k) => l?.effectiveRayon || (k === 'NON CLASSE' ? 'Non classé' : k));
    const totalDelta = current.caTTC - previous.caTTC;
    const relevantRayons = rayonRows.filter(r => abs(r.delta) >= Math.max(100, abs(totalDelta) * 0.08)).slice(0, 6);
    for (const r of relevantRayons) {
      findings.push(finding({
        id: `rayon-${U().normText(r.key).replace(/\s+/g,'-')}`,
        category: 'rayon',
        level: r.delta < 0 ? 'warning' : 'positive',
        title: `${r.label} ${r.delta < 0 ? 'recule' : 'progresse'}`,
        summary: `${U().money(Math.abs(r.delta))} de CA ${r.delta < 0 ? 'en moins' : 'en plus'} : ${U().money(r.current.caTTC)} maintenant contre ${U().money(r.previous.caTTC)} auparavant (${pct(r.trend)}).${totalDelta<0&&r.delta<0 ? ` Cette baisse représente environ ${Math.min(100,Math.round(Math.abs(r.delta/totalDelta)*100))} % du recul total du magasin.` : totalDelta<0&&r.delta>0 ? ' Ce rayon compense une partie de la baisse observée ailleurs.' : ''}`,
        explanation: 'Power compare ce rayon sur deux périodes de même durée et descend ensuite dans les familles et produits pour trouver ce qui change réellement.',
        impactAmount: r.delta, confidence: 100, quality: 'calculated',
        facts: [`Tickets : ${r.current.tickets} vs ${r.previous.tickets}.`, `Clients identifiés : ${r.current.clients} vs ${r.previous.clients}.`, `Marge : ${U().money(r.current.margin)} vs ${U().money(r.previous.margin)}.`],
        actions: r.delta < 0 ? [`Descendre dans les familles et produits de ${r.label} pour isoler les références responsables.`] : [`Sécuriser le stock des références motrices de ${r.label}.`],
        entities: [{ type: 'rayon', key: r.key, label: r.label }]
      }));
    }

    const familyRows = groupDelta(currentLines, previousLines, l => `${l.effectiveRayon || 'NON CLASSE'}|${l.effectiveFamille || 'NON CLASSEE'}`, (l) => `${l?.effectiveRayon || 'Non classé'} · ${l?.effectiveFamille || 'Non classée'}`);
    const familyDrivers = familyRows.filter(r => abs(r.delta) >= Math.max(80, abs(totalDelta) * 0.06)).slice(0, 8);
    for (const r of familyDrivers) {
      if (findings.some(f => f.title.startsWith(r.label))) continue;
      findings.push(finding({
        id: `family-${U().normText(r.key).replace(/\W+/g,'-')}`, category: 'family',
        level: r.delta < 0 ? 'warning' : 'positive',
        title: `${r.label} ${r.delta < 0 ? 'recule' : 'progresse'}`,
        summary: `${U().money(Math.abs(r.delta))} de CA ${r.delta<0?'en moins':'en plus'} que sur la période précédente (${pct(r.trend)}).`,
        impactAmount: r.delta, confidence: 100, quality: 'calculated',
        facts: [`CA actuel : ${U().money(r.current.caTTC)}.`, `CA précédent : ${U().money(r.previous.caTTC)}.`, `Quantités : ${U().number(r.current.qty)} vs ${U().number(r.previous.qty)}.`],
        actions: r.delta < 0 ? ['Analyser les références, le stock, les prix et les clients ayant quitté ou réduit cette famille.'] : ['Capitaliser sur les références responsables de la croissance.']
      }));
    }

    const productRows = productPeriodRows(model, currentLines, previousLines);
    const negatives = productRows.filter(r => r.delta < -Math.max(40, abs(totalDelta) * 0.025) && r.previous.caTTC >= 80).sort((a,b)=>a.delta-b.delta).slice(0,10);
    const positives = productRows.filter(r => r.delta > Math.max(40, abs(totalDelta) * 0.025)).sort((a,b)=>b.delta-a.delta).slice(0,8);

    for (const r of negatives.slice(0, 6)) {
      const p = r.product;
      const stockSignal = p && ['negative','out','critical'].includes(p.stockStatus);
      const priceVolume = r.priceDelta !== null && r.priceDelta > 0.04 && r.current.qty < r.previous.qty * 0.8;
      const migration = migrationForDecliningProduct(model, r, currentWindow, previousWindow);
      const hypotheses = [];
      let confidence = 100;
      let quality = 'calculated';
      if (stockSignal) { hypotheses.push(`Stock actuel ${p.stock ?? 'inconnu'} (${p.stockStatus}) : facteur possible, sans preuve de rupture sur toute la période.`); confidence = Math.min(confidence, 78); quality = 'signal'; }
      if (priceVolume) { hypotheses.push(`Prix unitaire moyen ${pct(r.priceDelta)} alors que la quantité recule : sensibilité prix possible.`); confidence = Math.min(confidence, 72); quality = 'signal'; }
      if (migration && migration.rate >= 0.25) { hypotheses.push(`${migration.migrated}/${migration.prevBuyers} acheteurs précédents ont acheté une autre référence de la même famille ; migration possible vers ${migration.alternatives[0]?.designation || 'une alternative'}.`); confidence = Math.min(confidence, 82); quality = 'signal'; }
      findings.push(finding({
        id: `product-decline-${r.key}`, category: 'product', level: r.delta < -250 ? 'warning' : 'info',
        title: `${r.label} se vend moins qu’avant`,
        summary: `Cette référence réalise ${U().money(Math.abs(r.delta))} de CA ${r.delta<0?'en moins':'en plus'} que sur la période précédente.`,
        explanation: hypotheses.length ? 'La baisse est certaine. Power a trouvé quelques éléments à vérifier, mais ne les présentera comme cause que s’ils sont suffisamment solides.' : 'La baisse est certaine, mais Power ne trouve pas encore de cause assez solide pour l’expliquer. Il vaut mieux le dire clairement que proposer une fausse raison.',
        impactAmount: r.delta, confidence, quality,
        facts: [`Quantité vendue : ${U().number(r.current.qty)} maintenant contre ${U().number(r.previous.qty)} auparavant.`, `Clients acheteurs : ${r.current.clients} maintenant contre ${r.previous.clients} auparavant.`, p ? `Stock actuel : ${p.stock === null ? 'non disponible' : p.stock}.` : 'Cette référence n’est plus présente dans le catalogue actuel.'],
        hypotheses,
        actions: [stockSignal ? 'Vérifier immédiatement si ce produit a réellement été en rupture et sécuriser le stock.' : 'Voir quels clients l’achetaient avant, ce qu’ils achètent maintenant et vérifier prix et disponibilité.'],
        entities: [{ type: 'product', key: r.key, label: r.label }]
      }));
    }

    for (const r of positives.slice(0, 4)) {
      const p = r.product;
      findings.push(finding({
        id: `product-growth-${r.key}`, category: 'product', level: 'opportunity',
        title: `${r.label} progresse fortement`,
        summary: `+${U().money(r.delta)} de CA par rapport aux ${previousWindow.days} jours précédents (${pct(r.trend)}).`,
        impactAmount: r.delta, confidence: 100, quality: 'calculated',
        facts: [`CA actuel : ${U().money(r.current.caTTC)}.`, `Quantité actuelle : ${U().number(r.current.qty)}.`, p?.stock !== null && p?.stock !== undefined ? `Stock actuel : ${p.stock}.` : 'Stock actuel non rattaché.'],
        actions: [p && ['out','critical','low'].includes(p.stockStatus) ? 'Ce produit progresse mais son stock devient faible : vérifier la prochaine commande en priorité.' : 'Préserver sa disponibilité et regarder quels clients le rachètent.'],
        entities: [{ type: 'product', key: r.key, label: r.label }]
      }));
    }

    const movement = customerPeriodMovement(model, currentWindow, previousWindow);
    const retainedDelta = movement.retainedCurrentCA - movement.retainedPreviousCA;
    if (movement.previousClients >= 20) {
      const level = movement.retentionRate !== null && movement.retentionRate < 0.65 ? 'warning' : 'info';
      findings.push(finding({
        id: 'customer-movement', category: 'customer', level,
        title: `${movement.absent} clients vus auparavant ne sont pas revenus récemment`,
        summary: `${movement.retained} clients sont revenus sur les deux périodes, tandis que ${movement.incoming} nouveaux ou réactivés apparaissent récemment.`,
        explanation: 'Ces clients ne sont pas forcément perdus. Power vérifie ensuite leur rythme habituel pour distinguer un simple retard d’une vraie baisse de fidélité.',
        impactAmount: movement.incomingCA - movement.absentPreviousCA,
        confidence: 100, quality: 'calculated',
        facts: [`CA précédent des clients absents actuellement : ${U().money(movement.absentPreviousCA)}.`, `CA actuel des clients entrants : ${U().money(movement.incomingCA)}.`, `Évolution du CA des clients retenus : ${U().money(retainedDelta)}.`],
        actions: ['Ouvrir la liste des clients en retard sur leur habitude et commencer par ceux qui comptent le plus dans le chiffre d’affaires.']
      }));
    }

    const highRisk = model.customers.filter(c => c.risk.key === 'high' && c.totalSpend > 0).sort((a,b)=>b.estimatedMonthlyValue-a.estimatedMonthlyValue);
    if (highRisk.length) {
      const withSignals = highRisk.filter(c => c.signals.length);
      const atRiskMonthly = U().sum(highRisk.map(c => c.estimatedMonthlyValue));
      findings.push(finding({
        id: 'high-risk-customers', category: 'customer', level: highRisk.length >= 25 ? 'warning' : 'info',
        title: `${highRisk.length} clients réguliers tardent fortement à revenir`,
        summary: `Ces clients représentaient environ ${U().money(atRiskMonthly)} par mois dans leur rythme habituel. Pour ${withSignals.length} d’entre eux, Power a repéré un changement concret à vérifier.`,
        explanation: 'Power compare chaque client à son propre rythme d’achat. Un client n’est signalé que s’il tarde nettement plus que d’habitude.',
        impactAmount: -atRiskMonthly, confidence: 90, quality: 'estimate',
        facts: highRisk.slice(0,5).map(c => `${c.client.name} : dernière visite ${U().formatDate(c.lastVisit)} · environ ${U().money(c.estimatedMonthlyValue)}/mois historiquement.`),
        actions: ['Commencer par les clients à forte valeur : vérifier leurs produits habituels, leur disponibilité et préparer une relance adaptée si elle est autorisée.']
      }));
    }

    const currentDiscount = discountPeriod(currentTx);
    const previousDiscount = discountPeriod(previousTx);
    const discountShareDelta = currentDiscount.share - previousDiscount.share;
    const marginRateDelta = currentDiscount.marginRate !== null && previousDiscount.marginRate !== null ? currentDiscount.marginRate - previousDiscount.marginRate : null;
    if (abs(discountShareDelta) >= 0.05 || (marginRateDelta !== null && marginRateDelta < -0.015)) {
      const warning = discountShareDelta > 0.05 && marginRateDelta !== null && marginRateDelta < 0;
      findings.push(finding({
        id: 'discount-shift', category: 'discount', level: warning ? 'warning' : 'info',
        title: `Part des tickets remisés : ${U().percent(currentDiscount.share)} (${discountShareDelta >= 0 ? '+' : ''}${(discountShareDelta*100).toFixed(1)} pt)`,
        summary: `${currentDiscount.tickets} tickets remisés sur la période actuelle contre ${previousDiscount.tickets}.`,
        explanation: warning ? 'La hausse de la part remisée coïncide avec une baisse du taux de marge. C’est une association à surveiller, pas une preuve unique de causalité.' : 'Le moteur surveille les changements de politique de remise et leur coïncidence avec panier et marge.',
        impactAmount: currentDiscount.amount - previousDiscount.amount,
        confidence: warning ? 75 : 100, quality: warning ? 'signal' : 'calculated',
        facts: [`Remises € : ${U().money(currentDiscount.amount)} vs ${U().money(previousDiscount.amount)}.`, marginRateDelta === null ? 'Taux de marge non comparable.' : `Écart taux de marge : ${marginRateDelta >= 0 ? '+' : ''}${(marginRateDelta*100).toFixed(1)} pt.`],
        actions: warning ? ['Identifier les rayons et vendeurs concentrant la hausse de remise avant de modifier la politique commerciale.'] : []
      }));
    }

    const stockRisks = model.products.filter(p => p.qty30 > 0 && ['negative','out','critical','low'].includes(p.stockStatus)).sort((a,b)=>b.qty30-a.qty30);
    if (stockRisks.length) {
      const out = stockRisks.filter(p => ['negative','out'].includes(p.stockStatus));
      const predictedNeed21 = stockRisks.reduce((s,p)=>s + Math.max(0, p.velocity30 * 21 - Math.max(0,p.stock || 0)),0);
      findings.push(finding({
        id: 'stock-risk', category: 'stock', level: out.length ? 'warning' : 'info',
        title: `${stockRisks.length} références risquent de manquer`,
        summary: `${out.length} sont déjà à stock nul ou négatif. Les ventes récentes montrent qu’un réassort doit être vérifié rapidement.`,
        explanation: 'Power regarde ce qui se vend réellement et le stock restant. Il signale les références qui peuvent devenir bloquantes, sans supposer les commandes fournisseur déjà en cours.',
        confidence: 82, quality: 'estimate',
        facts: stockRisks.slice(0,6).map(p => `${p.designation} : stock ${p.stock} · ${p.coverageDays === null ? 'durée inconnue' : `environ ${Math.round(p.coverageDays)} jours au rythme actuel`} · ${U().number(p.qty30)} unités vendues sur 30 jours.`),
        actions: ['Traiter d’abord les références déjà à zéro ou négatives qui continuent d’être demandées.']
      }));
    }

    const dueSoon = model.customers.filter(c => c.expectedNext && c.risk.key !== 'high' && c.visitCount >= 3 && c.expectedNext >= U().addDays(model.range.max,-2) && c.expectedNext <= U().addDays(model.range.max,7));
    if (dueSoon.length >= 5) {
      findings.push(finding({
        id: 'revisit-soon', category: 'customer', level: 'opportunity',
        title: `${dueSoon.length} clients réguliers devraient bientôt revenir`,
        summary: `Ces clients représentent habituellement environ ${U().money(U().sum(dueSoon.map(c=>c.estimatedMonthlyValue)))} par mois lorsqu’ils suivent leur rythme normal.`,
        explanation: 'Ces clients approchent simplement de leur rythme habituel de retour. Ce n’est pas une certitude, mais une liste utile pour préparer le stock et l’accueil.',
        confidence: 72, quality: 'estimate',
        facts: dueSoon.sort((a,b)=>b.estimatedMonthlyValue-a.estimatedMonthlyValue).slice(0,5).map(c=>`${c.client.name} · revisite attendue vers ${U().formatDate(c.expectedNext)}.`),
        actions: ['Vérifier que leurs produits habituels sont disponibles et utiliser la liste pour anticiper les prochains passages.']
      }));
    }

    const schoolCurrentDays = model.daily.filter(d => U().inRange(d.date,currentWindow.start,currentWindow.end) && d.isSchoolHoliday).length;
    const schoolPrevDays = model.daily.filter(d => U().inRange(d.date,previousWindow.start,previousWindow.end) && d.isSchoolHoliday).length;
    const activeCur = current.activeDays || 1, activePrev = previous.activeDays || 1;
    const curShare = schoolCurrentDays / activeCur, prevShare = schoolPrevDays / activePrev;
    if (abs(curShare - prevShare) >= 0.2 && model.holidayComparison.school.activeDays >= 5 && model.holidayComparison.normal.activeDays >= 20) {
      const effect = model.holidayComparison.caDayDelta;
      findings.push(finding({
        id: 'calendar-mix', category: 'calendar', level: 'info',
        title: 'Les vacances scolaires rendent la comparaison moins directe',
        summary: `${Math.round(curShare*100)} % des jours actifs récents sont classés vacances Zone A contre ${Math.round(prevShare*100)} % précédemment. Sur tout l’historique chargé, l’écart vacances/hors vacances est de ${pct(effect)} de CA par jour actif.`,
        explanation: 'Les deux périodes ne sont pas composées des mêmes types de journées. Power en tient compte pour éviter d’accuser à tort un produit, une équipe ou un événement extérieur.',
        confidence: 65, quality: 'signal',
        facts: [`Vacances Zone A : ${U().money(model.holidayComparison.school.avgCaDay)}/jour actif.`, `Hors vacances : ${U().money(model.holidayComparison.normal.avgCaDay)}/jour actif.`],
        actions: ['Comparer aussi à la même période de l’année précédente dès que l’historique le permet.']
      }));
    }

    // Jours de semaine responsables des écarts de fréquentation/CA.
    const weekdayNames = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    const groupTx = (txs, keyFn) => {
      const by = U().groupBy(txs, keyFn);
      const out = new Map();
      for (const [k, rows] of by) out.set(k, aggregateTx(rows));
      return out;
    };
    const curWeek = groupTx(currentTx, t => t.date?.getDay());
    const prevWeek = groupTx(previousTx, t => t.date?.getDay());
    const weekRows = [...new Set([...curWeek.keys(), ...prevWeek.keys()])].map(k => {
      const A = curWeek.get(k) || aggregateTx([]), B = prevWeek.get(k) || aggregateTx([]);
      const avgA = A.activeDays ? A.caTTC / A.activeDays : 0;
      const avgB = B.activeDays ? B.caTTC / B.activeDays : 0;
      const deltaAvg = avgA - avgB;
      const equivalentImpact = deltaAvg * Math.max(1, A.activeDays);
      return { k, A, B, avgA, avgB, deltaAvg, equivalentImpact };
    }).sort((a,b)=>abs(b.equivalentImpact)-abs(a.equivalentImpact));
    const topWeek = weekRows[0];
    if (topWeek && topWeek.A.activeDays >= 3 && topWeek.B.activeDays >= 3 && abs(topWeek.equivalentImpact) >= Math.max(180, abs(totalDelta)*0.12)) {
      findings.push(finding({
        id:`weekday-${topWeek.k}`, category:'traffic', level:topWeek.deltaAvg<0?'warning':'positive',
        title:`Les ${weekdayNames[topWeek.k].toLowerCase()}s ${topWeek.deltaAvg<0?'rapportent nettement moins qu’avant':'progressent nettement'}`,
        summary:`En moyenne ${U().money(topWeek.avgA)} par ${weekdayNames[topWeek.k].toLowerCase()} maintenant contre ${U().money(topWeek.avgB)} auparavant (${pct(U().pctChange(topWeek.avgA,topWeek.avgB))}).`,
        explanation:'Power compare la moyenne d’un même jour de semaine pour éviter qu’un mois avec plus de samedis ou de lundis fausse la lecture.',
        impactAmount:topWeek.equivalentImpact, confidence:100, quality:'calculated',
        facts:[`${topWeek.A.activeDays} ${weekdayNames[topWeek.k].toLowerCase()}(s) récents vs ${topWeek.B.activeDays} précédemment.`,`Tickets cumulés : ${topWeek.A.tickets} vs ${topWeek.B.tickets}.`,`Panier : ${U().money(topWeek.A.avgBasket)} vs ${U().money(topWeek.B.avgBasket)}.`],
        actions:[topWeek.deltaAvg<0?`Examiner ce qui a changé spécifiquement les ${weekdayNames[topWeek.k].toLowerCase()}s : trafic, horaires, présence vendeur, travaux ou assortiment.`:`Identifier ce qui rend les ${weekdayNames[topWeek.k].toLowerCase()}s plus performants.`]
      }));
    }

    // Contribution brute vendeur. Elle est volontairement non normalisée sans planning.
    const curVendor = groupTx(currentTx, t => t.vendor || 'Non renseigné');
    const prevVendor = groupTx(previousTx, t => t.vendor || 'Non renseigné');
    const vendorRows = [...new Set([...curVendor.keys(),...prevVendor.keys()])].map(k=>{
      const A=curVendor.get(k)||aggregateTx([]),B=prevVendor.get(k)||aggregateTx([]); return {k,A,B,delta:A.caTTC-B.caTTC};
    }).sort((a,b)=>abs(b.delta)-abs(a.delta));
    const vendor = vendorRows[0];
    if (vendor && vendor.k !== 'Non renseigné' && abs(vendor.delta) >= Math.max(300,abs(totalDelta)*0.2)) {
      findings.push(finding({
        id:`vendor-${U().normText(vendor.k).replace(/\W+/g,'-')}`, category:'vendor', level:'info',
        title:`Les ventes enregistrées sous ${vendor.k} ${vendor.delta<0?'baissent':'progressent'}`,
        summary:`${U().money(vendor.A.caTTC)} de CA maintenant contre ${U().money(vendor.B.caTTC)} auparavant, soit ${U().money(Math.abs(vendor.delta))} ${vendor.delta<0?'en moins':'en plus'}.`,
        explanation:'Cette comparaison ne juge pas le vendeur : Power ne connaît pas ses heures travaillées ni ses créneaux. Elle sert seulement à repérer un changement à rapprocher du planning.',
        impactAmount:vendor.delta, confidence:100, quality:'calculated',
        facts:[`Tickets : ${vendor.A.tickets} vs ${vendor.B.tickets}.`,`Panier : ${U().money(vendor.A.avgBasket)} vs ${U().money(vendor.B.avgBasket)}.`],
        actions:['Ne pas conclure sur la performance du vendeur sans rapprocher ces données de son temps de présence.']
      }));
    }

    // Retours : surveille un changement pouvant dégrader CA et satisfaction.
    const returnAgg = lines => {
      const r = lines.filter(l=>l.isReturn || l.qty<0);
      return { lines:r.length, amount:U().sum(r.map(l=>abs(l.saleTTC))), tickets:new Set(r.map(l=>l.transactionKey)).size };
    };
    const retA=returnAgg(currentLines), retB=returnAgg(previousLines);
    if (retA.lines >= 3 && (retA.amount > retB.amount*1.5 || retA.lines > retB.lines*1.5) && retA.amount-retB.amount > 60) {
      findings.push(finding({
        id:'returns-rise', category:'returns', level:'warning',
        title:'Il y a nettement plus de retours produits qu’avant',
        summary:`${retA.lines} ligne(s) de retour pour ${U().money(retA.amount)} de valeur absolue contre ${retB.lines} et ${U().money(retB.amount)} précédemment.`,
        explanation:'Power voit que les retours augmentent, mais il ne peut pas connaître leur motif. Il faut regarder quelles références sont concernées.',
        impactAmount:-(retA.amount-retB.amount), confidence:100, quality:'calculated',
        facts:[`${retA.tickets} ticket(s) concernés actuellement.`,`${retB.tickets} ticket(s) précédemment.`],
        actions:['Ouvrir les références les plus retournées et vérifier s’il s’agit d’un défaut, d’une erreur de conseil ou d’une incompatibilité.']
      }));
    }

    // Opportunités de vente croisée sur associations réellement surreprésentées.
    const assoc = model.associations.find(a=>a.count>=5 && a.lift>=1.6 && a.confidenceAB>=0.12);
    if (assoc) {
      const pa=model.productByCode.get(assoc.a), pb=model.productByCode.get(assoc.b);
      findings.push(finding({
        id:`association-${assoc.a}-${assoc.b}`, category:'basket', level:'opportunity',
        title:`Ces deux produits sont souvent achetés ensemble`,
        summary:`${pa?.designation||assoc.a} et ${pb?.designation||assoc.b} apparaissent ensemble dans ${assoc.count} tickets, nettement plus souvent que la moyenne.`,
        explanation:'Les clients qui achètent l’un prennent souvent l’autre aussi. C’est une bonne piste de conseil croisé quand elle correspond réellement au besoin du client.',
        confidence:Math.min(95,65+assoc.count*2), quality:'calculated',
        facts:[`Support : ${U().percent(assoc.support)} des tickets.`,`Confiance A→B : ${U().percent(assoc.confidenceAB)}.`,`Confiance B→A : ${U().percent(assoc.confidenceBA)}.`],
        actions:['Tester la recommandation de l’autre produit lorsque cela a du sens pour le client.']
      }));
    }

    return { findings, current, previous, currentTx, previousTx, currentLines, previousLines, decomposition, rayonRows, familyRows, productRows, movement, windowDays: currentWindow.days };
  }

  function buildHealth(model, core) {
    let score = 72;
    const caDelta = U().pctChange(core.current.caTTC, core.previous.caTTC);
    const marginDelta = model.financialAvailability?.margin === false ? null : U().pctChange(core.current.margin, core.previous.margin);
    if (caDelta !== null) score += U().clamp(caDelta * 80, -22, 16);
    if (marginDelta !== null) score += U().clamp(marginDelta * 35, -10, 8);
    const riskValue = U().sum(model.customers.filter(c=>c.risk.key==='high').map(c=>c.estimatedMonthlyValue));
    const monthlyBase = Math.max(1, core.current.caTTC);
    score -= U().clamp(riskValue / monthlyBase * 18, 0, 15);
    const stockBad = model.products.filter(p=>p.qty30>0 && ['negative','out','critical'].includes(p.stockStatus)).length;
    score -= Math.min(12, stockBad * 0.7);
    score -= (1 - model.quality.clientCertifiedCoverage) * 10;
    score -= (1 - model.quality.catalogueCoverage) * 8;
    score = Math.round(U().clamp(score, 0, 100));
    let status = 'ALERTE';
    if (score >= 78) status = 'FAVORABLE';
    else if (score >= 60) status = 'SOUS SURVEILLANCE';
    else if (score >= 45) status = 'ATTENTION';
    return { score, status };
  }

  function buildExecutiveBrief(model, core, findings, health) {
    const sorted = findings.filter(f=>f.category!=='quality').sort((a,b)=>b.score-a.score);
    const primary = findings.find(f=>f.id==='turnover-main');
    const negative = sorted.filter(f=>['critical','warning'].includes(f.level) && f.id!=='turnover-main').slice(0,3);
    const opportunities = sorted.filter(f=>['opportunity','positive'].includes(f.level)).slice(0,2);
    const lines = [];
    const caDelta = U().pctChange(core.current.caTTC, core.previous.caTTC);
    const marginDelta = model.financialAvailability?.margin === false ? null : U().pctChange(core.current.margin, core.previous.margin);
    lines.push(`Situation ${health.status.toLowerCase()} : ${caDelta === null ? 'CA non comparable' : `CA ${pct(caDelta)}`} et ${marginDelta === null ? 'marge non comparable' : `marge ${pct(marginDelta)}`} sur les ${core.windowDays} derniers jours par rapport aux ${core.windowDays} précédents.`);
    if (primary) lines.push(`${primary.title}. ${primary.summary}`);
    for (const f of negative) lines.push(`${f.title}. ${f.summary}`);
    for (const f of opportunities) lines.push(`Opportunité — ${f.title}. ${f.summary}`);
    return lines.slice(0,6);
  }

  function buildActions(findings) {
    const rows = [];
    for (const f of findings.sort((a,b)=>b.score-a.score)) {
      for (const action of f.actions || []) {
        if (!action) continue;
        const key = U().normText(action);
        if (rows.some(x=>U().normText(x.action)===key)) continue;
        rows.push({ action, sourceId: f.id, sourceTitle: f.title, level: f.level, confidence: f.confidence, category: f.category, impactAmount: f.impactAmount });
        if (rows.length >= 12) return rows;
      }
    }
    return rows;
  }

  function buildWatchlists(model) {
    const highRisk = model.customers.filter(c=>c.risk.key==='high').sort((a,b)=>b.estimatedMonthlyValue-a.estimatedMonthlyValue);
    const dueSoon = model.customers.filter(c=>c.expectedNext && c.visitCount>=3 && c.expectedNext >= U().addDays(model.range.max,-2) && c.expectedNext <= U().addDays(model.range.max,7)).sort((a,b)=>b.estimatedMonthlyValue-a.estimatedMonthlyValue);
    const stock = model.products.filter(p=>p.qty30>0 && ['negative','out','critical','low'].includes(p.stockStatus)).sort((a,b)=>{
      const ca = a.sale30 || 0, cb = b.sale30 || 0; return cb-ca;
    });
    const dormant = model.products.filter(p=>p.stockStatus==='dormant').sort((a,b)=>(b.stock||0)-(a.stock||0));
    return { highRisk, dueSoon, stock, dormant };
  }

  function analyze(model) {
    const boundary = detectReferenceBoundary(model);
    const ref = boundary.referenceDate;
    if (!ref) return { findings: [], actions: [], brief: [], health: { score: 0, status: 'SANS DONNÉES' }, windows: null, watchlists: {} };
    const days = comparisonDays(model, ref);
    const currentWindow = windowEnding(ref, days, 0);
    const previousWindow = windowEnding(ref, days, days);
    const core = buildCoreFindings(model, currentWindow, previousWindow);
    const anomalies = buildAnomalies(model, ref);
    const findings = [...core.findings, ...anomalies].filter(f=>!((model.financialAvailability?.margin===false&&['margin','discount'].includes(f.category))||(model.financialAvailability?.discount===false&&f.category==='discount')));
    if (boundary.partialLastDay) {
      findings.push(finding({
        id:'partial-last-day', category:'quality', level:'quality',
        title:'La dernière journée pourrait être partielle : exclue du diagnostic comparatif automatique',
        summary:`Dernière transaction à ${String(Math.floor(boundary.lastMinute/60)).padStart(2,'0')}:${String(boundary.lastMinute%60).padStart(2,'0')} alors que l’heure médiane de dernière transaction récente est autour de ${String(Math.floor(boundary.typicalLastMinute/60)).padStart(2,'0')}:${String(boundary.typicalLastMinute%60).padStart(2,'0')}.`,
        explanation:'Le fichier semble avoir été exporté avant la fin habituelle de la journée. Power l’écarte de la comparaison principale pour ne pas afficher une fausse baisse.',
        confidence:85, quality:'estimate', facts:[`Date de référence retenue : ${U().formatDate(ref)}.`], actions:[]
      }));
    }

    if (model.quality.catalogCounts.missing || model.quality.clientCertifiedCoverage < 1) {
      findings.push(finding({
        id: 'quality-coverage', category: 'quality', level: 'quality',
        title: 'Certaines analyses restent volontairement prudentes',
        summary: 'Quelques ventes ou articles ne peuvent pas être reliés avec une certitude suffisante. Power préfère limiter l’explication plutôt que deviner.',
        explanation: 'Les totaux de vente restent utilisables, mais les conclusions sur un client ou un produit sont volontairement moins précises lorsque le lien n’est pas sûr.',
        confidence: 100, quality: 'fact',
        facts: [`${model.quality.matchCounts.probable} ticket(s) client demandent une vérification.`, `${model.quality.catalogCounts.missing} ligne(s) concernent un article absent du catalogue actuel.`],
        actions: []
      }));
    }

    if (model.geoIntelligence?.findings?.length) {
      findings.push(...model.geoIntelligence.findings.map(g => finding(g)));
    }
    // Les données publiques restent disponibles pour le moteur causal et la vue Local Intelligence.
    // Elles ne créent plus d'alertes commerciales toutes seules : un chantier, une météo ou un événement
    // n'apparaît dans le cockpit que s'il explique réellement un problème métier déjà détecté.
    findings.sort((a,b)=>b.score-a.score);
    const health = buildHealth(model, core);
    const brief = buildExecutiveBrief(model, core, findings, health);
    const actions = buildActions(findings);
    const watchlists = buildWatchlists(model);
    return {
      generatedAt: new Date(),
      referenceDate: ref,
      boundary,
      windows: { current: currentWindow, previous: previousWindow },
      metrics: { current: core.current, previous: core.previous, decomposition: core.decomposition, movement: core.movement },
      drivers: { rayons: core.rayonRows, families: core.familyRows, products: core.productRows },
      health, brief, findings, actions, watchlists
    };
  }

  function findingText(f) {
    const facts = (f.facts || []).slice(0,4);
    const hypotheses = (f.hypotheses || []).slice(0,3);
    return {
      title: f.title,
      text: f.summary,
      bullets: [...facts, ...hypotheses, ...(f.causal?.tested && ['strong','moderate'].includes(f.causal.status) ? [`Cause retenue : ${f.causal.retainedCauses?.[0]?.label||f.causal.label}. ${f.causal.summary}`] : [])],
      confidence: f.confidence>=90?'Très élevée':f.confidence>=75?'Élevée':f.confidence>=55?'Moyenne':'À confirmer',
      quality: f.quality
    };
  }

  function topByCategory(intel, category, levels = null, limit = 5) {
    return intel.findings.filter(f=>f.category===category && (!levels || levels.includes(f.level))).slice(0,limit);
  }

  function answerQuestion(model, rawQuery) {
    const intel = model.intelligence || analyze(model);
    const q = U().normText(rawQuery || '');
    const has = (...words) => words.some(w => q.includes(U().normText(w)));
    const make = (title, intro, fs, extra = []) => ({ title, intro, items: fs.map(findingText), extra, generated: true });

    // Exact client lookup when the query contains the normalized full name.
    const client = model.customers.find(c => c.client.nameKey && q.includes(c.client.nameKey));
    if (client) {
      const favorite = client.topProducts[0];
      const facts = [
        `${client.visitCount} jour(s) de visite, ${client.transactionCount} ticket(s), ${U().money(client.totalSpend)} de CA cumulé.`,
        `Dernière visite : ${U().formatDate(client.lastVisit)}${client.daysSinceLast !== null ? `, il y a ${client.daysSinceLast} jours` : ''}.`,
        client.medianInterval ? `Habituellement, ce client revient environ tous les ${Math.round(client.medianInterval)} jours.` : 'Pas encore assez d’historique pour connaître son rythme habituel.',
        favorite ? `Produit le plus acheté : ${favorite.label} (${U().money(favorite.ca)} sur l’historique).` : 'Aucun produit préféré suffisamment clair.'
      ];
      return { title: `${client.client.name}`, intro: `Situation actuelle : ${client.risk.label}.`, items: [{ title: 'Ce qu’il faut retenir', text: client.signals.length ? client.signals.map(s=>s.text).join(' ') : 'Rien d’inhabituel n’a été clairement détecté dans son comportement d’achat.', bullets: facts, confidence: client.identityQuality === 'certified' ? 'Fiche fiable' : 'À interpréter avec prudence', quality: client.identityQuality }], extra: [] };
    }

    if (has('ticket', 'visite', 'frequentation', 'fréquentation')) {
      const f = intel.findings.find(x=>x.id==='turnover-main');
      const traffic = intel.findings.filter(x=>x.category==='traffic').slice(0,5);
      const cur=intel.metrics.current, prev=intel.metrics.previous;
      return make('Pourquoi les visites bougent ?', `${U().integer(cur.tickets)} passages sur la période actuelle contre ${U().integer(prev.tickets)} auparavant.`, [f,...traffic].filter(Boolean), [`Variation tickets : ${pct(U().pctChange(cur.tickets,prev.tickets))}.`, `Action prioritaire : ${f?.actions?.[0]||'Identifier les jours, zones et clients qui expliquent le mouvement.'}`]);
    }
    if (has('panier moyen', 'panier')) {
      const f = intel.findings.find(x=>x.id==='turnover-main');
      const basketFs=intel.findings.filter(x=>['basket','product','rayon','family'].includes(x.category)).slice(0,6);
      const cur=intel.metrics.current, prev=intel.metrics.previous;
      return make('Pourquoi le panier moyen bouge ?', `${U().money(cur.avgBasket)} actuellement contre ${U().money(prev.avgBasket)} auparavant.`, [f,...basketFs].filter(Boolean), [`Variation panier : ${pct(U().pctChange(cur.avgBasket,prev.avgBasket))}.`, `Action prioritaire : ${f?.actions?.[0]||'Examiner mix produits, quantités, prix et associations de panier.'}`]);
    }
    if (has('ca', 'chiffre affaires', 'chiffre d affaires', 'ca baisse', 'ca diminue') || (has('baisse','chute') && !has('client','produit','stock','marge'))) {
      const order = ['turnover','rayon','family','customer','product','traffic','discount','calendar'];
      const fs = [];
      for (const cat of order) {
        for (const f of intel.findings.filter(x=>x.category===cat && ['critical','warning','info'].includes(x.level))) {
          if (f.id==='high-risk-customers' && fs.length<4) continue;
          fs.push(f);
          if (fs.length>=8) break;
        }
        if (fs.length>=8) break;
      }
      return make('Pourquoi le CA bouge ?', `Power compare la période récente à la période précédente de même durée.`, fs, [`Le nombre de passages représente environ ${U().money(Math.abs(intel.metrics.decomposition.trafficEffect))} ${intel.metrics.decomposition.trafficEffect<0?'de baisse':'de hausse'} de CA.`, `Le panier moyen représente environ ${U().money(Math.abs(intel.metrics.decomposition.basketEffect))} ${intel.metrics.decomposition.basketEffect<0?'de baisse':'de hausse'} de CA.`]);
    }
    if (has('client', 'perdre', 'perdu', 'risque', 'revenir', 'revient')) {
      const fs = topByCategory(intel, 'customer', null, 6);
      const top = intel.watchlists.highRisk.slice(0,8).map(c=>`${c.client.name} · très en retard par rapport à son rythme habituel · environ ${U().money(c.estimatedMonthlyValue)}/mois historiquement`);
      return make('Clients à surveiller', 'Power compare chaque client à son propre rythme d’achat pour éviter les faux signaux.', fs, top);
    }
    if (has('travaux', 'chantier', 'circulation', 'acces', 'accès', 'mobilite', 'mobilité', 'cause externe', 'contexte clermont', 't2c', 'parking', 'stationnement', 'evenement', 'événement', 'meteo', 'météo', 'cvelo', 'c.vélo', 'zelt')) {
      if (AU.causalContext?.answer) return AU.causalContext.answer(model);
    }
    if (has('zone', 'secteur', 'geograph', 'géograph', 'autour', 'commerce', 'local', 'proximite', 'proximité', 'brezet', 'brézet', 'clermont est')) {
      const g = model.geoIntelligence;
      if (!g) return make('Analyse géographique', 'Le moteur géographique n’est pas disponible.', []);
      const fs = intel.findings.filter(f=>f.category==='geo').slice(0,8);
      const top = g.zones.slice(0,10).map(z=>`${z.name} · CA ${z.caDelta===null?'non comparable':`${z.caDelta<0?'en baisse':'en hausse'} de ${Math.abs(z.caDelta*100).toFixed(1)} %`} · visites ${z.visitsDelta===null?'non comparables':`${z.visitsDelta<0?'en baisse':'en hausse'} de ${Math.abs(z.visitsDelta*100).toFixed(1)} %`}`);
      return make('Autour du commerce', `Power suit les zones d’origine des clients et cherche si certaines se dégradent nettement.`, fs, top);
    }
    if (has('stock', 'rupture', 'commander', 'reappro', 'réappro')) {
      const fs = topByCategory(intel, 'stock', null, 5).concat(intel.findings.filter(f=>f.category==='product' && f.hypotheses.some(h=>U().normText(h).includes('stock'))).slice(0,4));
      const top = intel.watchlists.stock.slice(0,10).map(p=>`${p.designation} · stock ${p.stock} · ${p.coverageDays===null?'autonomie inconnue':`environ ${p.coverageDays.toFixed(0)} jour(s) au rythme actuel`} · ${U().number(p.qty30)} unités vendues sur 30 jours`);
      return make('Stock à sécuriser', 'Commence par les références qui se vendent encore mais dont le stock risque de bloquer les ventes.', fs, top);
    }
    if (has('produit', 'reference', 'référence', 'article', 'moteur')) {
      const fs = intel.findings.filter(f=>f.category==='product').slice(0,8);
      return make('Produits moteurs et produits en décrochage', 'Le classement combine impact en euros, variation et signaux stock/prix/migration.', fs);
    }
    if (has('rayon', 'famille', 'categorie', 'catégorie')) {
      const fs = intel.findings.filter(f=>['rayon','family'].includes(f.category)).slice(0,8);
      return make('Rayons et familles', 'Les contributions sont calculées sur deux fenêtres de 30 jours de même longueur.', fs);
    }
    if (has('marge', 'rentabilite', 'rentabilité')) return make('Diagnostic marge', 'Analyse du montant de marge et du taux de marge.', topByCategory(intel,'margin',null,6).concat(topByCategory(intel,'discount',null,4)));
    if (has('vacance', 'scolaire', 'conge', 'congé', 'zone a', 'calendrier')) return make('Impact calendrier', 'Comparaison vacances scolaires Zone A / hors vacances, avec prudence causale.', topByCategory(intel,'calendar',null,6), [`Historique : ${U().money(model.holidayComparison.school.avgCaDay)}/jour actif en vacances vs ${U().money(model.holidayComparison.normal.avgCaDay)}/jour hors vacances.`]);
    if (has('remise', 'promo', 'promotion')) return make('Remises et promotions', 'Le moteur observe part de tickets remisés, montants et coïncidence avec la marge.', topByCategory(intel,'discount',null,6));
    if (has('anomalie', 'bizarre', 'inhabituel', 'exception')) return make('Anomalies détectées', 'Comparaison robuste avec les mêmes jours de semaine récents.', topByCategory(intel,'anomaly',null,10));
    if (has('action', 'priorite', 'priorité', 'faire', 'recommand')) {
      return { title: 'Actions prioritaires', intro: 'Actions générées à partir des diagnostics les mieux classés.', items: [], extra: intel.actions.slice(0,10).map(a=>`${a.action} — lié à : ${a.sourceTitle}.`) };
    }

    return make('Brief Analysis Power', intel.brief[0] || 'Analyse automatique terminée.', intel.findings.slice(0,7), intel.actions.slice(0,5).map(a=>`Action : ${a.action}`));
  }

  return { analyze, answerQuestion };
})();
