window.AU = window.AU || {};

AU.ui = (() => {
  const U = () => AU.util;
  let currentModel = null;
  const arr=v=>Array.isArray(v)?v:[];
  const finite=v=>Number.isFinite(Number(v));
  const fixed=(v,d=1,fallback='—')=>finite(v)?Number(v).toFixed(d):fallback;

  function qualityPill(status, label) {
    const map = { certified: 'good', partial: 'warn', estimate: 'info', blocked: 'bad', fact: 'good', calculated: 'info', signal: 'warn' };
    return `<span class="pill ${map[status] || 'muted'}">${U().escapeHtml(label || status)}</span>`;
  }

  function riskLabel(risk) {
    return ({high:'Très en retard',risk:'En retard',watch:'Commence à tarder',active:'Dans son rythme',new:'Nouveau client',insufficient:'Pas assez d’historique'})[risk?.key] || risk?.label || 'Situation inconnue';
  }
  function riskHtml(risk) {
    return `<span class="risk ${risk.key}">${U().escapeHtml(riskLabel(risk))}</span>`;
  }

  function kpi(label, value, sub = '', cls = '', lens = null) {
    const unavailable=(/marge/i.test(label)&&currentModel?.financialAvailability?.margin===false)||(/\bHT\b/.test(label)&&currentModel?.financialAvailability?.ht===false);
    if(unavailable){value='—';sub='Donnée absente ou partielle dans les exports';}
    const lensKey=lens===false?'':(lens||label);
    return `<div class="kpi"${lensKey?` data-power-lens="${U().escapeHtml(lensKey)}"`:''}>${lensKey?'<span class="power-lens-hint">ouvrir</span>':''}<div class="kpi-label">${U().escapeHtml(label)}</div><div class="kpi-value ${cls}">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
  }

  function deltaText(delta) {
    if (delta === null || !Number.isFinite(delta)) return `<span class="delta-neutral">comparaison indisponible</span>`;
    const cls = delta > 0.001 ? 'delta-up' : delta < -0.001 ? 'delta-down' : 'delta-neutral';
    return `<span class="${cls}">${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} %</span>`;
  }

  function viewHeader(title, subtitle, actions = '') {
    return `<div class="view-header"><div><h1>${U().escapeHtml(title)}</h1><p>${subtitle}</p></div><div class="view-actions">${actions}</div></div>`;
  }

  function bars(rows, valueFn, labelFn, formatFn, limit = 8) {
    const subset = rows.slice(0, limit);
    const max = Math.max(1, ...subset.map(valueFn));
    return `<div class="bar-list">${subset.map(r => {
      const v = valueFn(r);
      const w = Math.max(1, v / max * 100);
      return `<div class="bar-row"><div class="bar-label" title="${U().escapeHtml(labelFn(r))}">${U().escapeHtml(labelFn(r))}</div><div class="bar-track"><div class="bar-fill" style="width:${w.toFixed(1)}%"></div></div><div class="bar-value">${formatFn(v)}</div></div>`;
    }).join('')}</div>`;
  }

  function sparkCanvas(id, rows, valueKey) {
    return `<canvas class="spark" id="${id}" data-spark-key="${valueKey}"></canvas><div class="axis-note"><span>${rows.length ? U().formatDate(rows[0].date) : ''}</span><span>${rows.length ? U().formatDate(rows.at(-1).date) : ''}</span></div>`;
  }

  function drawSpark(canvas, rows, valueKey) {
    if (!canvas || !rows.length) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(300, rect.width * dpr);
    canvas.height = Math.max(100, rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const w = rect.width, h = rect.height;
    const vals = rows.map(r => Number(r[valueKey]) || 0);
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(146,162,178,.18)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = h * i / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = '#4599ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    rows.forEach((r, i) => {
      const x = rows.length === 1 ? w / 2 : i / (rows.length - 1) * w;
      const y = h - 8 - ((Number(r[valueKey]) || 0) - min) / range * (h - 18);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  function intelligenceBadge(level) {
    const labels = {critical:'À TRAITER',warning:'À SURVEILLER',opportunity:'OPPORTUNITÉ',positive:'ÇA PROGRESSE',info:'À SAVOIR',quality:'QUALITÉ'};
    return `<span class="intel-badge ${level}">${labels[level] || String(level).toUpperCase()}</span>`;
  }

  function confidenceBadge(f) {
    const q=String(f.quality||'');
    const c=Number(f.confidence||0);
    if((q==='calculated'||q==='fact'||q==='certified') && c>=95) return '<span class="confidence-badge">Donnée vérifiée</span>';
    // Ne pas encombrer les cartes avec un score de confiance : seul un résultat fragile est signalé.
    if(c<70) return '<span class="confidence-badge">À confirmer</span>';
    return '';
  }

  function causalBadge(c){
    if(!AU.power?.causeVisible?.(c)) return '';
    const primary=AU.power.primaryCause(c);
    const cls=c.status==='strong'?'critical':'warning';
    return `<span class="causal-badge ${cls}">${c.status==='strong'?'Cause très probable':'Cause probable'} : ${U().escapeHtml(primary?.label||'cause identifiée')}</span>`;
  }

  function impactText(f){
    const v=Number(f.impactAmount||0); if(!v)return '';
    const amount=U().money(Math.abs(v));
    if(f.category==='margin') return `${amount} de marge ${v<0?'en moins':'en plus'}`;
    if(['turnover','rayon','family','product','geo','traffic','customer','vendor'].includes(f.category)) return `${amount} de CA ${v<0?'en moins':'en plus'}`;
    return `${amount} ${v<0?'en moins':'en plus'}`;
  }

  function causalEvidence(c){
    if(!AU.power?.causeVisible?.(c)) return '';
    const primary=AU.power.primaryCause(c);
    const chain=(c.chain||[]).slice(1).map(x=>`<li>${U().escapeHtml(x)}</li>`).join('');
    const sources=(c.retainedCauses||[]).filter(x=>x.type==='works'&&x.work).map(x=>AU.power.officialSourceCard(x.work)).join('');
    return `<div class="causal-box ${U().escapeHtml(c.status||'none')}"><div class="causal-head"><span class="power-cause-chip">${U().escapeHtml(primary?.label||'Cause retenue')}</span></div><p>${U().escapeHtml(c.summary||'')}</p>${chain?`<h4>Pourquoi cette cause est retenue</h4><ol>${chain}</ol>`:''}${sources||''}</div>`;
  }

  function findingCard(f, compact = false) {
    const facts = (f.facts || []).filter(Boolean).map(x => `<li>${U().escapeHtml(x)}</li>`).join('');
    const actions = (f.actions || []).filter(Boolean).map(x => `<li>${U().escapeHtml(x)}</li>`).join('');
    const cause=AU.power?.primaryCause?.(f.causal);
    const sourceCards=(f.causal?.retainedCauses||[]).filter(x=>x.type==='works'&&x.work).map(x=>AU.power.officialSourceCard(x.work)).join('');
    const noCause=(!cause&&f.causal?.tested)?'<div class="power-no-cause"><strong>Cause non identifiée</strong><p>Power a vérifié les explications disponibles, mais aucune n’est assez solide pour être présentée comme la raison de ce problème.</p></div>':'';
    const whyBody=`${cause?`<div class="power-retained-cause"><strong>${f.causal?.status==='strong'?'Cause très probable':'Cause probable'} · ${U().escapeHtml(cause.label)}</strong><p>${U().escapeHtml(cause.evidence||f.causal?.summary||'')}</p></div>`:''}${f.explanation ? `<p>${U().escapeHtml(f.explanation)}</p>` : ''}${noCause}`;
    const solutionBody=actions?`<ul>${actions}</ul>`:'<p>Power ne recommande pas d’action spécifique tant qu’il n’y a pas assez d’éléments fiables.</p>';
    const proofBody=`${facts?`<h4>Les faits utilisés</h4><ul>${facts}</ul>`:'<p>Aucun fait supplémentaire à afficher.</p>'}${sourceCards}`;
    const impact=impactText(f);
    return `<article class="intel-finding ${f.level}">
      <div class="intel-finding-head"><div>${intelligenceBadge(f.level)} ${confidenceBadge(f)} ${causalBadge(f.causal)}</div>${impact ? `<strong class="impact ${Number(f.impactAmount)<0?'negative':'positive'}">${U().escapeHtml(impact)}</strong>` : ''}</div>
      <h3>${U().escapeHtml(f.title)}</h3>
      <p>${U().escapeHtml(f.summary || '')}</p>
      <div class="power-finding-actions">
        <button class="power-tab-btn" data-power-tab="why">Pourquoi ?</button>
        <button class="power-tab-btn" data-power-tab="solution">Que faire ?</button>
        <button class="power-tab-btn" data-power-tab="proof">Voir les faits</button>
      </div>
      <div class="power-reveal" data-power-panel="why"><h4>Ce qui l’explique</h4>${whyBody}</div>
      <div class="power-reveal power-solution" data-power-panel="solution"><h4>À faire maintenant</h4>${solutionBody}</div>
      <div class="power-reveal power-proof" data-power-panel="proof">${proofBody}</div>
    </article>`;
  }

  function executiveHero(model) {
    const intel=model.intelligence;if(!intel)return '';
    const h=intel.health;
    const top=(intel.findings||[]).filter(f=>f.category!=='quality'&&['critical','warning','opportunity','positive'].includes(f.level)).slice(0,3);
    const profile=AU.power?.profileSummary?.(model.storeProfile)||{};
    const situation=String(h.status||'À SURVEILLER').replace('SOUS SURVEILLANCE','À SURVEILLER').replace('FAVORABLE','BONNE').replace('ATTENTION','À TRAITER');
    const tone=(h.score||0)>=78?'good':(h.score||0)>=60?'watch':(h.score||0)>=45?'warning':'critical';
    return `<section class="power-command">
      <div class="power-command-grid">
        <div class="power-situation ${tone}"><span>SITUATION</span><strong>${U().escapeHtml(situation)}</strong><small>${top.filter(f=>['critical','warning'].includes(f.level)).length} point(s) à regarder</small></div>
        <div class="power-command-copy"><span class="eyebrow">EN 30 SECONDES · CE QUI COMPTE MAINTENANT</span><h2>${top.length?'Voici ce qui mérite ton attention':'Rien d’urgent détecté'}</h2><p>${U().escapeHtml(intel.brief?.[0]||'Analyse terminée.')}</p><div class="power-context-profile"><div class="pin">⌖</div><div><strong>${U().escapeHtml(profile.label||'Adresse commerce non configurée')}</strong><span>${U().escapeHtml(profile.configured?'Le contexte local est activé pour cette adresse.':'Configure l’adresse du commerce pour vérifier automatiquement travaux, accès et événements utiles.')}</span></div></div></div>
        <div class="power-priorities">${top.length?top.map(f=>`<div class="power-priority ${f.level}"><div><strong>${U().escapeHtml(f.title)}</strong><small>${U().escapeHtml(f.actions?.[0]||f.summary||'À surveiller')}</small></div></div>`).join(''):'<div class="power-priority"><div><strong>Aucune priorité urgente</strong><small>Continue simplement le suivi normal du magasin.</small></div></div>'}</div>
      </div>
    </section>`;
  }

  function bindFindingActions(root){
    if(root.dataset.powerFindingBound==='1') return;
    root.dataset.powerFindingBound='1';
    root.addEventListener('click',e=>{
      const btn=e.target.closest('[data-power-tab]'); if(!btn)return;
      const card=btn.closest('.intel-finding'); if(!card)return;
      const key=btn.dataset.powerTab;
      const panel=card.querySelector(`[data-power-panel="${key}"]`);
      const already=panel?.classList.contains('active');
      card.querySelectorAll('.power-reveal').forEach(x=>x.classList.remove('active'));
      card.querySelectorAll('.power-tab-btn').forEach(x=>x.classList.remove('active'));
      if(panel&&!already){panel.classList.add('active');btn.classList.add('active');}
    });
  }

  function entityLens(model,raw){
    const parts=String(raw||'').split('|');
    const type=parts[0], code=parts[1], metric=parts.slice(2).join('|')||'Analyse';
    if(type==='product'){
      const p=model.productByCode?.get(code); if(!p)return null;
      const finding=(model.intelligence?.findings||[]).find(f=>(f.entities||[]).some(e=>e.type==='product'&&String(e.key)===String(code)));
      const reasons=[];
      if(p.trend30!==null) reasons.push(`Sur les 30 derniers jours, les ventes ont ${p.trend30<0?'baissé':'augmenté'} de ${Math.abs(p.trend30*100).toFixed(1)} % (${U().money(p.sale30)} contre ${U().money(p.prev30)} auparavant).`);
      if(p.stock!==null) reasons.push(`Il reste ${U().number(p.stock)} unité(s) en stock${p.coverageDays!==null?`, soit environ ${Math.max(0,p.coverageDays).toFixed(0)} jour(s) au rythme actuel`:''}.`);
      if(p.repeatRate!==null) reasons.push(`${U().percent(p.repeatRate)} des clients observés ont racheté cette référence.`);
      if(p.marginRate!==null) reasons.push(`La marge représente ${U().percent(p.marginRate)} du CA HT sur cette référence.`);
      const solutions=[];
      if(['negative','out','critical'].includes(p.stockStatus)&&p.qty30>0) solutions.push('Vérifier le réassort immédiatement : ce produit se vend encore mais le stock devient insuffisant.');
      if(p.trend30!==null&&p.trend30<=-0.10) solutions.push('Voir les anciens acheteurs de ce produit, vérifier son prix et regarder vers quelles références ils se sont déplacés.');
      if(p.trend30!==null&&p.trend30>=0.10) solutions.push('Sécuriser le stock pour ne pas casser la progression et surveiller la marge.');
      if(!solutions.length) solutions.push('Aucune action urgente : continuer simplement à suivre les ventes, le stock et les clients qui rachètent.');
      return `<span class="eyebrow">POWER LENS · PRODUIT</span><h2>${U().escapeHtml(p.designation)} · ${U().escapeHtml(metric)}</h2><p class="muted">Cette lecture concerne uniquement cette référence.</p><div class="answer-block"><h4>Ce qui se passe</h4><p>${U().money(p.ca)} de CA TTC · ${U().integer(p.tickets)} ticket(s) · ${U().number(p.qty)} unité(s) observée(s).</p></div><div class="answer-block"><h4>Pourquoi ?</h4><ul>${reasons.map(x=>`<li>${U().escapeHtml(x)}</li>`).join('')}</ul>${finding?`<p>${U().escapeHtml(finding.explanation||finding.summary||'')}</p>`:''}</div><div class="answer-block"><h4>Que faire ?</h4><ul>${solutions.map(x=>`<li>${U().escapeHtml(x)}</li>`).join('')}</ul></div><div class="answer-block"><h4>Voir les faits</h4><p>Les chiffres viennent uniquement des ventes de cette référence${p.current?' et du stock actuellement présent dans le catalogue.':'. Le produit n’est plus présent dans le catalogue actuel, donc Power ne peut pas conclure sur son stock.'}</p>${finding?.facts?.length?`<ul>${finding.facts.map(x=>`<li>${U().escapeHtml(x)}</li>`).join('')}</ul>`:''}</div>`;
    }
    if(type==='client'){
      const c=model.customerByCode?.get(code); if(!c)return null;
      const reasons=(c.signals||[]).map(x=>x.text).slice(0,6);
      if(!reasons.length){
        reasons.push(c.medianInterval?`Rythme habituel observé : environ ${Math.round(c.medianInterval)} jours entre visites.`:'Historique insuffisant pour établir un rythme de revisite robuste.');
        if(c.daysSinceLast!==null) reasons.push(`Dernière visite observée il y a ${c.daysSinceLast} jours.`);
      }
      const solutions=[];
      if(['risk','high'].includes(c.risk?.key)) solutions.push('Prioriser une relance personnalisée fondée sur l’habitude d’achat et les produits favoris observés.');
      else if(c.risk?.key==='watch') solutions.push('Surveiller la prochaine fenêtre de revisite avant de déclencher une relance.');
      else solutions.push('Aucune action urgente : conserver le client dans le suivi de revisite normal.');
      if(c.topProducts?.[0]) solutions.push(`En cas de contact, partir de son univers d’achat observé : ${c.topProducts[0].label}.`);
      return `<span class="eyebrow">POWER LENS · CLIENT</span><h2>${U().escapeHtml(c.client.name||c.client.codeClient)} · ${U().escapeHtml(metric)}</h2><p class="muted">Cette analyse concerne uniquement ce client.</p><div class="answer-block"><h4>Ce qui se passe</h4><p>${U().money(c.totalSpend)} de CA TTC cumulé · ${U().integer(c.visitCount)} visite(s) · situation : ${U().escapeHtml(riskLabel(c.risk))}.</p></div><div class="answer-block"><h4>Pourquoi ?</h4><ul>${reasons.map(x=>`<li>${U().escapeHtml(x)}</li>`).join('')}</ul></div><div class="answer-block"><h4>Que faire ?</h4><ul>${solutions.map(x=>`<li>${U().escapeHtml(x)}</li>`).join('')}</ul></div><div class="answer-block"><h4>Voir les faits</h4><p>${U().integer(c.transactionCount)} ticket(s) sont utilisés pour cette fiche.${c.lastVisit?` Dernière visite observée : ${U().formatDate(c.lastVisit)}.`:''}</p></div>`;
    }
    return null;
  }

  function powerLensContent(model,key){
    const raw=String(key||'');
    if(raw.startsWith('product|')||raw.startsWith('client|')) return entityLens(model,raw) || '<p>Analyse contextuelle indisponible.</p>';
    const k=U().normText(raw).toLowerCase();
    let q='Quelles actions sont prioritaires ?';
    if(k.includes('ca ttc')||k==='ca'||k.includes('chiffre')) q='Pourquoi mon CA bouge ?';
    else if(k.includes('ticket')||k.includes('visite')) q='Pourquoi mes tickets bougent ?';
    else if(k.includes('client')||k.includes('risque')) q='Quels clients suis-je en train de perdre ?';
    else if(k.includes('stock')||k.includes('rupture')||k.includes('couverture')) q='Que dois-je commander ?';
    else if(k.includes('marge')||k.includes('rentabil')) q='marge rentabilité';
    else if(k.includes('panier')) q='Pourquoi mon panier moyen bouge ?';
    else if(k.includes('produit')||k.includes('reference')) q='Quels produits sont moteurs ?';
    else if(k.includes('vacance')||k.includes('saison')||k.includes('calend')) q='Quel impact ont les vacances scolaires ?';
    else if(k.includes('urban')||k.includes('parking')||k.includes('t2c')||k.includes('velo')||k.includes('evenement')||k.includes('zone')) q='Que se passe-t-il autour du commerce ?';
    const answer=AU.intelligence.answerQuestion(model,q);
    return `<span class="eyebrow">POWER LENS · ${U().escapeHtml(raw)}</span><h2>${U().escapeHtml(answer.title||raw||'Analyse')}</h2><p class="muted">Power te dit ce que ce chiffre signifie et quoi faire, sans afficher les calculs techniques.</p>${renderAnswer(answer)}`;
  }

  function bindPowerLens(model,root){
    if(root.dataset.powerLensBound==='1')return;
    root.dataset.powerLensBound='1';
    root.addEventListener('click',e=>{
      const el=e.target.closest('[data-power-lens]');if(!el)return;
      const modal=document.getElementById('detailModal'),content=document.getElementById('detailContent');
      if(!modal||!content)return;content.innerHTML=powerLensContent(currentModel,el.dataset.powerLens);modal.classList.remove('hidden');
    });
  }

  function askPanel(model) {
    return `<section class="panel ask-panel"><div class="panel-title"><div><h2>Interroger Analysis Power</h2><div class="panel-sub">Power répond uniquement à partir de tes données et des faits qu’il peut vérifier.</div></div><span class="pill good">100 % local</span></div>
      <div class="ask-row"><input id="intelQuestion" class="search-input ask-input" placeholder="Ex. Pourquoi mon CA baisse ? Quels clients suis-je en train de perdre ?"><button id="intelAskBtn" class="btn btn-primary">Analyser</button></div>
      <div class="question-chips"><button data-q="Pourquoi mon CA bouge ?">Pourquoi mon CA bouge ?</button><button data-q="Quels clients suis-je en train de perdre ?">Clients à risque</button><button data-q="Que dois-je commander ?">Stock à sécuriser</button><button data-q="Quels produits sont moteurs ?">Produits moteurs</button><button data-q="Quel impact ont les vacances scolaires ?">Vacances scolaires</button><button data-q="Que se passe-t-il autour du commerce ?">Contexte local</button><button data-q="Les travaux expliquent-ils mes baisses ?">Travaux ↔ baisses</button><button data-q="Quelles actions sont prioritaires ?">Actions prioritaires</button></div>
      <div id="intelAnswer" class="intel-answer hidden"></div>
    </section>`;
  }

  function renderAnswer(answer) {
    const items = (answer.items || []).map(x => `<div class="answer-block"><h4>${U().escapeHtml(x.title)}</h4><p>${U().escapeHtml(x.text || '')}</p>${x.bullets?.length ? `<ul>${x.bullets.map(b=>`<li>${U().escapeHtml(b)}</li>`).join('')}</ul>`:''}${x.confidence?`<span class="quality-tag">Fiabilité : ${U().escapeHtml(x.confidence)}</span>`:''}</div>`).join('');
    const extra = (answer.extra || []).length ? `<div class="answer-extra"><h4>Éléments utiles</h4><ul>${answer.extra.map(x=>`<li>${U().escapeHtml(x)}</li>`).join('')}</ul></div>` : '';
    return `<div class="answer-head"><span class="eyebrow">RÉPONSE POWER</span><h3>${U().escapeHtml(answer.title || 'Analyse')}</h3><p>${U().escapeHtml(answer.intro || '')}</p></div>${items}${extra}`;
  }

  function bindAsk(model, root) {
    const input = root.querySelector('#intelQuestion');
    const btn = root.querySelector('#intelAskBtn');
    const answerRoot = root.querySelector('#intelAnswer');
    if (!input || !btn || !answerRoot) return;
    const run = q => {
      const text = q || input.value.trim();
      if (!text) return;
      input.value = text;
      const answer = AU.intelligence.answerQuestion(model, text);
      answerRoot.innerHTML = renderAnswer(answer);
      answerRoot.classList.remove('hidden');
    };
    btn.addEventListener('click', () => run());
    input.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    root.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => run(b.dataset.q)));
  }

  function dashboard(model, root) {
    const ref = model.range.max;
    const intel = model.intelligence;
    const current = intel?.metrics?.current || AU.analytics.periodSummary(model.transactions, U().addDays(ref,-29), ref);
    const prev = intel?.metrics?.previous || AU.analytics.periodSummary(model.transactions, U().addDays(ref,-59), U().addDays(ref,-30));
    const last90 = model.daily.filter(d => d.date >= U().addDays(ref, -89));
    const riskHigh = model.customers.filter(c => c.risk.key === 'high').length;
    const riskAny = model.customers.filter(c => ['watch','risk','high'].includes(c.risk.key)).length;
    const stockTension = model.products.filter(p => ['negative','out','critical'].includes(p.stockStatus) && p.qty30 > 0).length;
    const q = model.quality;
    const topFindings = intel?.findings?.filter(f=>f.category!=='quality').slice(0,5) || [];
    const windowDays = intel?.windows?.current?.days || 30;

    root.innerHTML = viewHeader('Vue générale', `Données du ${U().formatDate(model.range.min)} au ${U().formatDate(model.range.max)} · ${U().integer(model.transactions.length)} tickets analysés`, q.analysisAllowed ? '<span class="pill good">Données prêtes</span>' : '<span class="pill bad">Analyse bloquée</span>') +
      executiveHero(model) +
      autopilotStrip(model) +
      `<div class="kpi-grid section-gap">
        ${kpi(`CA TTC · ${windowDays} jours`, U().money(current.caTTC), deltaText(U().pctChange(current.caTTC, prev.caTTC)) + ` vs ${windowDays} j précédents`,'','ca')}
        ${kpi(`Tickets · ${windowDays} jours`, U().integer(current.tickets), deltaText(U().pctChange(current.tickets, prev.tickets)),'','tickets')}
        ${kpi('Panier moyen', U().money(current.avgBasket), deltaText(U().pctChange(current.avgBasket, prev.avgBasket)),'','basket')}
        ${kpi(`Marge · ${windowDays} jours`, U().money(current.margin), current.marginRate !== null ? `${U().percent(current.marginRate)} du CA HT` : '','','margin')}
        ${kpi('Clients à surveiller', U().integer(riskAny), `${riskHigh} en risque élevé`,'','customers')}
        ${kpi('Stock sous tension', U().integer(stockTension), 'références vendues récemment','','stock')}
      </div>
      <div class="grid-2">
        <section class="panel"><div class="panel-title"><div><h2>Évolution du chiffre d’affaires · 90 derniers jours</h2><div class="panel-sub">Power tient compte des jours d’ouverture pour éviter les comparaisons trompeuses.</div></div></div>${sparkCanvas('salesSpark', last90, 'caTTC')}</section>
        <section class="panel"><div class="panel-title"><div><h2>Ce qu’Analysis Power a compris</h2><div class="panel-sub">Les problèmes et opportunités les plus utiles, triés automatiquement.</div></div><button class="btn btn-small" data-go-intelligence>Tout voir</button></div><div class="intel-mini-list">${topFindings.map(f=>findingCard(f,true)).join('') || '<div class="empty-mini">Aucun signal notable.</div>'}</div></section>
      </div>
      ${askPanel(model)}
      <div class="grid-equal section-gap">
        <section class="panel"><div class="panel-title"><h2>Rayons par CA</h2><span class="panel-sub">Période complète</span></div>${bars(model.rayons, r => r.ca, r => r.rayon, U().money, 9)}</section>
        <section class="panel"><div class="panel-title"><h2>Clients qui tardent à revenir</h2><span class="panel-sub">Commence par ceux qui avaient l’habitude d’acheter régulièrement</span></div>${riskTable(model.customers.filter(c=>c.risk.key==='high').sort((a,b)=>b.estimatedMonthlyValue-a.estimatedMonthlyValue).slice(0,8))}</section>
      </div>
      <div class="grid-equal section-gap">
        <section class="panel"><div class="panel-title"><h2>Vacances scolaires Zone A</h2><span class="panel-sub">Comparaison par jour actif</span></div>${holidaySummary(model)}</section>
        <section class="panel"><div class="panel-title"><h2>Les données sont-elles fiables ?</h2><span class="panel-sub">Power signale seulement ce qui peut fausser une décision</span></div>${qualityQuick(model)}</section>
      </div>`;
    requestAnimationFrame(() => drawSpark(document.getElementById('salesSpark'), last90, 'caTTC'));
    bindClientRows(root);
    bindAsk(model, root);
    root.querySelector('[data-go-intelligence]')?.addEventListener('click', () => AU.app.switchView('intelligence'));
    root.querySelector('[data-go-autopilot]')?.addEventListener('click', () => AU.app.switchView('autopilot'));
  }

  function riskTable(rows) {
    if (!rows.length) return '<div class="empty-mini">Aucun client en risque élevé selon l’historique disponible.</div>';
    return `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Client</th><th>Dernière visite</th><th>Situation</th><th class="numeric">Valeur/mois*</th></tr></thead><tbody>${rows.map(c => `<tr data-client-code="${U().escapeHtml(c.client.codeClient)}"><td><strong>${U().escapeHtml(c.client.name)}</strong><br><span class="muted">${U().escapeHtml(c.geo?.zone || c.client.city)}</span></td><td>${U().formatDate(c.lastVisit)}</td><td>${c.risk?.key==='high'?'Très en retard':c.risk?.key==='risk'?'En retard':c.risk?.key==='watch'?'À surveiller':'Dans son rythme'}</td><td class="numeric">${U().money(c.estimatedMonthlyValue)}</td></tr>`).join('')}</tbody></table></div><div class="panel-sub" style="margin-top:7px">* estimation basée sur le rythme historique observé, pas une prévision garantie.</div>`;
  }

  function holidaySummary(model) {
    const h = model.holidayComparison;
    return `<div class="quality-grid">
      <div class="quality-card"><span>CA/jour actif · vacances</span><strong>${U().money(h.school.avgCaDay)}</strong><span>${h.school.activeDays} jours actifs</span></div>
      <div class="quality-card"><span>CA/jour actif · hors vacances</span><strong>${U().money(h.normal.avgCaDay)}</strong><span>${h.normal.activeDays} jours actifs</span></div>
      <div class="quality-card"><span>Écart CA/jour</span><strong>${h.caDayDelta === null ? '—' : `${h.caDayDelta >= 0 ? '+' : ''}${(h.caDayDelta*100).toFixed(1)} %`}</strong><span>Zone A / Clermont-Ferrand</span></div>
      <div class="quality-card"><span>Écart panier</span><strong>${h.basketDelta === null ? '—' : `${h.basketDelta >= 0 ? '+' : ''}${(h.basketDelta*100).toFixed(1)} %`}</strong><span>vacances vs hors vacances</span></div>
    </div>`;
  }

  function qualityQuick(model) {
    const q = model.quality;
    const c=q.matchCounts||{}, cat=q.catalogCounts||{};
    const clientCaution=(c.probable||0)+(c.anonymous||0);
    return `<div class="alert-list">
      <div class="alert-row ${q.transactionConflicts ? 'bad':'good'}"><span class="alert-dot"></span><div><strong>${q.transactionConflicts ? 'Certaines ventes se contredisent' : 'Les fichiers se correspondent correctement'}</strong><p>${q.transactionConflicts ? 'Power bloque volontairement l’analyse pour éviter une conclusion fausse.' : 'Aucun conflit bloquant détecté entre les fichiers importés.'}</p></div></div>
      <div class="alert-row ${clientCaution ? '':'good'}"><span class="alert-dot"></span><div><strong>${clientCaution ? `${U().integer(clientCaution)} ticket(s) demandent de la prudence côté client` : 'Les clients sont correctement reconnus'}</strong><p>${clientCaution ? 'Ces ventes restent utilisables pour le chiffre d’affaires, mais Power évite de les attribuer à tort à une personne.' : 'Aucune ambiguïté client importante détectée.'}</p></div></div>
      <div class="alert-row ${(cat.missing||0) ? '':'good'}"><span class="alert-dot"></span><div><strong>${(cat.missing||0) ? `${U().integer(cat.missing)} ligne(s) concernent un article absent du catalogue actuel` : 'Les articles sont correctement reconnus'}</strong><p>${(cat.missing||0) ? 'Power conserve l’historique de vente sans inventer de correspondance produit.' : 'Aucune référence importante ne manque dans le catalogue actuel.'}</p></div></div>
      <div class="alert-row ${q.financialIntegrity === null || q.financialIntegrity > .999 ? 'good':''}"><span class="alert-dot"></span><div><strong>${q.financialIntegrity === null ? 'Marge non vérifiable sur tous les fichiers' : q.financialIntegrity > .999 ? 'Les montants sont cohérents' : 'Certains montants demandent une vérification'}</strong><p>${q.financialIntegrity === null ? 'Power utilise uniquement les montants réellement disponibles.' : q.financialIntegrity > .999 ? 'Aucune incohérence financière importante détectée.' : 'Le détail précis est disponible dans « Détails & audit ».'}</p></div></div>
    </div>`;
  }

  function clientsView(model, root) {
    root.innerHTML = viewHeader('Clients', `${U().integer(model.clients.length)} fiches · Power compare chaque client à son propre rythme d’achat`, `<button class="btn" id="exportClients">Exporter la synthèse CSV</button>`) +
      `<section class="panel">
        <div class="table-tools"><input id="clientSearch" class="search-input" placeholder="Nom, code client, e-mail, téléphone, ville…"><select id="riskFilter" class="select-input"><option value="">Tous les statuts</option><option value="high">Très en retard</option><option value="risk">En retard</option><option value="watch">Commence à tarder</option><option value="active">Dans son rythme</option><option value="insufficient">Historique insuffisant</option><option value="no-sales">Sans vente rattachée</option></select><span id="clientCount" class="pill muted"></span></div>
        <div id="clientTable"></div>
      </section>`;
    const input = root.querySelector('#clientSearch');
    const risk = root.querySelector('#riskFilter');
    const table = root.querySelector('#clientTable');
    function draw() {
      const q = U().normText(input.value);
      const rf = risk.value;
      let rows = model.customers.filter(c => {
        if (rf === 'no-sales' && c.txs.length) return false;
        if (rf && rf !== 'no-sales' && c.risk.key !== rf) return false;
        if (!q) return true;
        const hay = U().normText([c.client.name,c.client.codeClient,c.client.email,c.client.phone,c.client.city,c.geo?.zone,c.geo?.group].join(' '));
        return hay.includes(q);
      });
      rows.sort((a,b) => (b.risk.severity-a.risk.severity) || (b.totalSpend-a.totalSpend));
      root.querySelector('#clientCount').textContent = `${U().integer(rows.length)} client(s)`;
      table.innerHTML = clientTable(rows.slice(0,300));
      bindClientRows(table);
    }
    input.addEventListener('input', draw); risk.addEventListener('change', draw); draw();
    root.querySelector('#exportClients').addEventListener('click', () => {
      const rows = model.customers.map(c => ({
        'Code client':c.client.codeClient,'Client':c.client.name,'Ville':c.client.city,'Zone':c.geo?.zone||'','Secteur travaux':c.geo?.worksSector||'','Visites':c.visitCount,'Transactions':c.transactionCount,
        'CA TTC':c.totalSpend.toFixed(2),'Marge':c.totalMargin.toFixed(2),'Panier moyen':c.avgBasket.toFixed(2),'Derniere visite':U().dateKey(c.lastVisit),
        'Intervalle median jours':c.medianInterval ?? '', 'Jours depuis derniere visite':c.daysSinceLast ?? '', 'Situation client':riskLabel(c.risk),
        'Valeur mensuelle estimee':c.estimatedMonthlyValue.toFixed(2),'Qualite rattachement':c.identityQuality
      }));
      U().downloadText('analysis-power-clients.csv', U().toCsv(rows), 'text/csv;charset=utf-8');
    });
  }

  function clientTable(rows) {
    if (!rows.length) return '<div class="empty-mini">Aucun client ne correspond aux filtres.</div>';
    return `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Client</th><th>Statut</th><th>Dernière visite</th><th class="numeric">Visites</th><th class="numeric">CA TTC</th><th class="numeric">Panier</th><th>Habitude</th><th>Produit n°1</th></tr></thead><tbody>${rows.map(c => `<tr data-client-code="${U().escapeHtml(c.client.codeClient)}"><td><strong>${U().escapeHtml(c.client.name || 'Sans nom')}</strong><br><span class="muted mono">${U().escapeHtml(c.client.codeClient)}</span> · <span class="muted">${U().escapeHtml(c.geo?.zone || c.client.city)}</span></td><td>${riskHtml(c.risk)}</td><td>${U().formatDate(c.lastVisit)}${c.daysSinceLast!==null?`<br><span class="muted">il y a ${c.daysSinceLast} j</span>`:''}</td><td class="numeric">${c.visitCount}</td><td class="numeric">${U().money(c.totalSpend)}</td><td class="numeric">${U().money(c.avgBasket)}</td><td>${c.medianInterval?`revient environ tous les ${Math.round(c.medianInterval)} j`:'rythme inconnu'}${c.risk?.key==='high'?'<br><span class="muted">très en retard</span>':c.risk?.key==='risk'?'<br><span class="muted">en retard</span>':c.risk?.key==='watch'?'<br><span class="muted">à surveiller</span>':''}</td><td class="truncate">${U().escapeHtml(c.topProducts[0]?.label || '—')}</td></tr>`).join('')}</tbody></table></div>${rows.length>=300?'<div class="panel-sub" style="margin-top:8px">Affichage limité à 300 résultats : utilisez la recherche pour cibler un client.</div>':''}`;
  }

  function bindClientRows(scope) {
    scope.querySelectorAll('[data-client-code]').forEach(tr => tr.addEventListener('click', () => showClientDetail(tr.dataset.clientCode)));
  }

  function showClientDetail(code) {
    const model = currentModel;
    const c = model?.customerByCode.get(code);
    if (!c) return;
    const modal = document.getElementById('detailModal');
    const content = document.getElementById('detailContent');
    const evidence = [...new Set(c.txs.flatMap(t=>t.clientMatchEvidence || []))];
    content.innerHTML = `<div class="profile-head"><div><span class="eyebrow">FICHE CLIENT 360°</span><h2>${U().escapeHtml(c.client.name || 'Client sans nom')}</h2><p>Code client <span class="mono">${U().escapeHtml(c.client.codeClient)}</span> · créé le ${U().formatDate(c.client.createdAt)}</p><div class="profile-contact">${c.client.phone?qualityPill('partial',c.client.phone):''}${c.client.email?qualityPill('partial',c.client.email):''}${c.client.city?qualityPill('partial',`${c.client.postal} ${c.client.city}`):''}${c.geo?.zone?qualityPill('info',c.geo.zone):''}</div></div><div>${riskHtml(c.risk)}</div></div>
      <div class="profile-kpis">${kpi('CA TTC',U().money(c.totalSpend),`${c.transactionCount} tickets`,'',`client|${c.client.codeClient}|CA TTC`)}${kpi('Visites',U().integer(c.visitCount),'jours d’achat uniques','',`client|${c.client.codeClient}|Visites`)}${kpi('Panier moyen',U().money(c.avgBasket),'','',`client|${c.client.codeClient}|Panier moyen`)}${kpi('Rythme habituel',c.medianInterval?`≈ ${Math.round(c.medianInterval)} j`:'—',c.expectedNext?`prochain retour attendu autour du ${U().formatDate(c.expectedNext)}`:'historique insuffisant','',`client|${c.client.codeClient}|Revisite`)}${kpi('Depuis dernière visite',c.daysSinceLast!==null?`${c.daysSinceLast} j`:'—',c.lastVisit?U().formatDate(c.lastVisit):'aucune vente','',`client|${c.client.codeClient}|Dernière visite`)}</div>
      <div class="grid-equal">
        <section class="panel"><h3>Ce qui a changé chez ce client</h3><div class="signal-list">${c.signals.length?c.signals.map(s=>`<div class="signal"><strong>${U().escapeHtml(s.text)}</strong></div>`).join(''):'<div class="empty-mini">Aucun signal notable calculable.</div>'}</div></section>
        <section class="panel"><h3>Fiabilité de cette fiche</h3><p class="muted">${c.identityQuality==='certified'?'Les ventes affichées correspondent clairement à ce client.':'Certaines ventes sont moins faciles à attribuer. Power les traite avec prudence et évite d’en tirer une conclusion trop précise.'}</p>${evidence.length?`<details class="merchant-detail-toggle"><summary>Voir comment Power a reconnu ce client</summary><div class="alert-list">${evidence.map(e=>`<div class="alert-row good"><span class="alert-dot"></span><div>${U().escapeHtml(e)}</div></div>`).join('')}</div></details>`:'<div class="empty-mini">Aucune vente clairement attribuée à ce client.</div>'}</section>
      </div>
      <div class="grid-equal section-gap">
        <section class="panel"><h3>Produits favoris</h3>${bars(c.topProducts,r=>Math.max(0,r.ca),r=>r.label,U().money,8)}</section>
        <section class="panel"><h3>Rayons favoris</h3>${bars(c.topRayons,r=>Math.max(0,r.ca),r=>r.label,U().money,6)}</section>
      </div>
      <section class="profile-section panel"><h3>Matériel déjà acheté</h3>${c.equipment.length?`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Matériel</th><th>Famille</th><th class="numeric">Qté</th><th class="numeric">TTC</th></tr></thead><tbody>${c.equipment.slice().sort((a,b)=>b.date-a.date).map(x=>`<tr><td>${U().formatDate(x.date)}</td><td>${U().escapeHtml(x.designation)}</td><td>${U().escapeHtml(x.family)}</td><td class="numeric">${U().number(x.qty)}</td><td class="numeric">${U().money(x.ttc)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-mini">Aucun achat classé comme POD / KIT / BOX / CLEAROMISEUR / RECONSTRUCTIBLE dans l’historique.</div>'}<div class="panel-sub" style="margin-top:7px">Power sait seulement que ce matériel a été acheté dans l’historique ; il ne suppose pas que le client l’utilise encore.</div></section>
      <section class="profile-section panel"><h3>Chronologie des visites</h3><div class="timeline">${c.visits.slice(-20).reverse().map(v=>`<div class="timeline-row"><div class="date">${U().formatDate(v.date)}</div><div>${v.lines.slice(0,4).map(l=>U().escapeHtml(l.designation)).join(' · ')}${v.lines.length>4?' …':''}</div><strong>${U().money(v.ttc)}</strong></div>`).join('')||'<div class="empty-mini">Aucune visite rattachée.</div>'}</div></section>`;
    bindPowerLens(currentModel, content);
    modal.classList.remove('hidden');
  }

  function productsView(model, root) {
    const rayons = [...new Set(model.products.map(p=>p.rayon).filter(Boolean))].sort(U().sortFrench);
    root.innerHTML = viewHeader('Produits', `${U().integer(model.products.length)} références rencontrées dans les ventes`, `<button class="btn" id="exportProducts">Exporter CSV</button>`) + `<section class="panel"><div class="table-tools"><input id="productSearch" class="search-input" placeholder="Désignation ou code article…"><select id="productRayon" class="select-input"><option value="">Tous les rayons</option>${rayons.map(r=>`<option>${U().escapeHtml(r)}</option>`).join('')}</select><span id="productCount" class="pill muted"></span></div><div id="productTable"></div></section>`;
    const search=root.querySelector('#productSearch'), rayon=root.querySelector('#productRayon'), table=root.querySelector('#productTable');
    function draw(){const q=U().normText(search.value);let rows=model.products.filter(p=>(!rayon.value||p.rayon===rayon.value)&&(!q||U().normText(`${p.designation} ${p.code}`).includes(q)));root.querySelector('#productCount').textContent=`${U().integer(rows.length)} produit(s)`;table.innerHTML=productTable(rows.slice(0,300));bindProductRows(table)}
    search.addEventListener('input',draw);rayon.addEventListener('change',draw);draw();
    root.querySelector('#exportProducts').addEventListener('click',()=>{const rows=model.products.map(p=>({'Code article':p.code,'Designation':p.designation,'Rayon':p.rayon,'Famille':p.famille,'CA TTC':p.ca.toFixed(2),'Marge':p.margin.toFixed(2),'Quantite':p.qty,'Tickets':p.tickets,'Clients':p.clients,'Clients qui rachètent':p.repeatRate??'','Stock':p.stock??'','Jours de stock estimés':p.coverageDays??'','Tendance 30j':p.trend30??''}));U().downloadText('analysis-power-produits.csv',U().toCsv(rows),'text/csv;charset=utf-8')});
  }

  function stockLabel(status){return ({negative:'Stock à corriger',out:'Épuisé',critical:'À recommander vite',low:'À surveiller',dormant:'Vend très peu',ok:'Stock suffisant',unknown:'Stock inconnu'})[status]||status}
  function stockClass(status){return ['negative','out','critical'].includes(status)?'bad':status==='low'||status==='dormant'?'warn':status==='ok'?'good':'muted'}
  function productTable(rows){if(!rows.length)return'<div class="empty-mini">Aucun produit.</div>';return`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Produit</th><th>Rayon / famille</th><th class="numeric">CA TTC</th><th class="numeric">Qté</th><th class="numeric">Clients</th><th class="numeric">Réachat</th><th class="numeric">30 j</th><th>Stock</th></tr></thead><tbody>${rows.map(p=>`<tr data-product-code="${U().escapeHtml(p.code)}"><td><strong>${U().escapeHtml(p.designation)}</strong><br><span class="mono muted">${U().escapeHtml(p.code)}</span></td><td>${U().escapeHtml(p.rayon||'Non classé')}<br><span class="muted">${U().escapeHtml(p.famille||'—')}</span></td><td class="numeric">${U().money(p.ca)}</td><td class="numeric">${U().number(p.qty)}</td><td class="numeric">${p.clients}</td><td class="numeric">${p.repeatRate!==null?U().percent(p.repeatRate):'—'}</td><td class="numeric">${p.trend30===null?'—':deltaText(p.trend30)}</td><td>${qualityPill(stockClass(p.stockStatus),p.stock===null?'Historique':`${p.stock} · ${stockLabel(p.stockStatus)}`)}</td></tr>`).join('')}</tbody></table></div>`}
  function bindProductRows(scope){scope.querySelectorAll('[data-product-code]').forEach(tr=>tr.addEventListener('click',()=>showProductDetail(tr.dataset.productCode)))}
  function showProductDetail(code){const p=currentModel?.productByCode.get(code);if(!p)return;const modal=document.getElementById('detailModal'),content=document.getElementById('detailContent');content.innerHTML=`<div class="profile-head"><div><span class="eyebrow">FICHE PRODUIT</span><h2>${U().escapeHtml(p.designation)}</h2><p class="mono">${U().escapeHtml(p.code)}</p></div><div>${qualityPill(stockClass(p.stockStatus),stockLabel(p.stockStatus))}</div></div><div class="profile-kpis">${kpi('CA TTC',U().money(p.ca),`${p.tickets} tickets`,'',`product|${p.code}|CA TTC`)}${kpi('Marge',U().money(p.margin),p.marginRate!==null?U().percent(p.marginRate):'','',`product|${p.code}|Marge`)}${kpi('Clients',U().integer(p.clients),p.repeatRate!==null?`${U().percent(p.repeatRate)} réacheteurs`:'','',`product|${p.code}|Clients`)}${kpi('Stock',p.stock===null?'—':U().number(p.stock),p.coverageDays!==null?`environ ${Math.round(Math.max(0,p.coverageDays))} jours au rythme actuel`:'durée non calculable','',`product|${p.code}|Stock`)}${kpi('Tendance 30 j',p.trend30===null?'—':`${p.trend30>=0?'+':''}${(p.trend30*100).toFixed(1)} %`,`${U().money(p.sale30)} vs ${U().money(p.prev30)}`,'',`product|${p.code}|Tendance 30 j`)}</div><div class="grid-equal"><section class="panel"><h3>Où se situe ce produit</h3><div class="alert-list"><div class="alert-row good"><span class="alert-dot"></span><div><strong>${U().escapeHtml(p.rayon||'Non classé')}</strong><p>${U().escapeHtml(p.famille||'Famille non classée')} · ${U().escapeHtml(p.sousFamille||'sans sous-famille')}</p></div></div><div class="alert-row"><span class="alert-dot"></span><div><strong>Catalogue actuel</strong><p>${p.current?`Présent · fournisseur ${U().escapeHtml(p.supplier||'non renseigné')} · prix catalogue ${U().money(p.currentPrice)}`:'Référence absente du catalogue courant.'}</p></div></div></div></section><section class="panel"><h3>Comment il se vend</h3><div class="quality-grid"><div class="quality-card"><span>Qté 30 j</span><strong>${U().number(p.qty30)}</strong></div><div class="quality-card"><span>Qté 90 j</span><strong>${U().number(p.qty90)}</strong></div><div class="quality-card"><span>Rythme récent</span><strong>≈ ${U().number(p.velocity30*30)} / mois</strong></div><div class="quality-card"><span>Prix moyen observé</span><strong>${p.avgUnitPrice!==null?U().money(p.avgUnitPrice):'—'}</strong></div></div></section></div>`;bindPowerLens(currentModel,content);modal.classList.remove('hidden')}

  function rayonsView(model, root){root.innerHTML=viewHeader('Rayons & familles','Quels univers progressent, lesquels reculent, et où agir en priorité')+`<div class="grid-equal"><section class="panel"><h2>Poids des rayons</h2>${bars(model.rayons,r=>Math.max(0,r.ca),r=>r.rayon,U().money,15)}</section><section class="panel"><h2>Tendance 30 jours</h2><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Rayon</th><th class="numeric">30 j</th><th class="numeric">30 j précédents</th><th class="numeric">Évolution</th></tr></thead><tbody>${model.rayons.map(r=>`<tr><td>${U().escapeHtml(r.rayon)}</td><td class="numeric">${U().money(r.ca30)}</td><td class="numeric">${U().money(r.prev30)}</td><td class="numeric">${r.trend30===null?'—':deltaText(r.trend30)}</td></tr>`).join('')}</tbody></table></div></section></div><section class="panel section-gap"><h2>Détail familles</h2><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Rayon</th><th>Famille</th><th class="numeric">CA TTC</th><th class="numeric">Marge</th><th class="numeric">Taux marge/HT</th><th class="numeric">Tickets</th><th class="numeric">Clients</th><th class="numeric">Produits</th></tr></thead><tbody>${model.families.map(f=>`<tr><td>${U().escapeHtml(f.rayon)}</td><td><strong>${U().escapeHtml(f.famille)}</strong></td><td class="numeric">${U().money(f.ca)}</td><td class="numeric">${U().money(f.margin)}</td><td class="numeric">${f.marginRate!==null?U().percent(f.marginRate):'—'}</td><td class="numeric">${f.tickets}</td><td class="numeric">${f.clients}</td><td class="numeric">${f.products}</td></tr>`).join('')}</tbody></table></div></section>`}

  function stockView(model, root){root.innerHTML=viewHeader('Stock','Ce qui risque de manquer, ce qui se vend très peu et ce qu’il faut vérifier en premier',`<button class="btn" id="exportStock">Exporter CSV</button>`)+`<div class="kpi-grid">${kpi('Stock à corriger',model.products.filter(p=>p.stockStatus==='negative').length,'quantité négative dans le catalogue')}${kpi('Déjà épuisés',model.products.filter(p=>p.stockStatus==='out').length,'quantité nulle dans le catalogue')}${kpi('À recommander vite',model.products.filter(p=>p.stockStatus==='critical').length,'moins d’une semaine environ au rythme actuel')}${kpi('À surveiller',model.products.filter(p=>p.stockStatus==='low').length,'moins de trois semaines environ')}${kpi('Se vendent très peu',model.products.filter(p=>p.stockStatus==='dormant').length,'aucune vente récente malgré du stock')}${kpi('Stock actuel inconnu',model.products.filter(p=>p.stock===null).length,'références historiques ou absentes du catalogue')}</div><section class="panel"><div class="table-tools"><input id="stockSearch" class="search-input" placeholder="Produit ou code…"><select id="stockFilter" class="select-input"><option value="">Tous les produits</option><option value="negative">Stock à corriger</option><option value="out">Déjà épuisé</option><option value="critical">À recommander vite</option><option value="low">À surveiller</option><option value="dormant">Se vend très peu</option><option value="ok">Stock suffisant</option><option value="unknown">Stock actuel inconnu</option></select><span id="stockCount" class="pill muted"></span></div><div id="stockTable"></div></section>`;const search=root.querySelector('#stockSearch'),filter=root.querySelector('#stockFilter'),table=root.querySelector('#stockTable');function draw(){const q=U().normText(search.value);let rows=model.products.filter(p=>(!filter.value||p.stockStatus===filter.value)&&(!q||U().normText(`${p.designation} ${p.code}`).includes(q)));rows.sort((a,b)=>{const order={negative:0,out:1,critical:2,low:3,dormant:4,ok:5,unknown:6};return(order[a.stockStatus]-order[b.stockStatus])||(b.qty30-a.qty30)});root.querySelector('#stockCount').textContent=`${rows.length} référence(s)`;table.innerHTML=productTable(rows.slice(0,300));bindProductRows(table)}search.addEventListener('input',draw);filter.addEventListener('change',draw);draw();root.querySelector('#exportStock').addEventListener('click',()=>{const rows=model.products.map(p=>({'Code article':p.code,'Designation':p.designation,'Rayon':p.rayon,'Stock':p.stock??'','Situation':stockLabel(p.stockStatus),'Ventes 30j':p.qty30,'Ventes 90j':p.qty90,'Ventes moyennes par jour':p.velocity30.toFixed(4),'Jours de stock estimés':p.coverageDays??''}));U().downloadText('analysis-power-stock.csv',U().toCsv(rows),'text/csv;charset=utf-8')})}

  function calendarView(model, root){const monthly=[...U().groupBy(model.daily,d=>d.monthKey).entries()].map(([month,days])=>({month,ca:U().sum(days.map(d=>d.caTTC)),tickets:U().sum(days.map(d=>d.tickets)),activeDays:days.length,avgDay:days.length?U().sum(days.map(d=>d.caTTC))/days.length:0,holidayDays:days.filter(d=>d.isSchoolHoliday).length})).sort((a,b)=>a.month.localeCompare(b.month));root.innerHTML=viewHeader('Périodes & vacances','Calendrier scolaire Zone A intégré pour Clermont-Ferrand ; comparaison normalisée par jours actifs')+holidaySummary(model)+`<div class="grid-equal section-gap"><section class="panel"><h2>CA mensuel</h2>${bars(monthly,m=>m.ca,m=>m.month,U().money,18)}</section><section class="panel"><h2>Mois et jours actifs</h2><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Mois</th><th class="numeric">CA</th><th class="numeric">Tickets</th><th class="numeric">Jours actifs</th><th class="numeric">CA/jour</th><th class="numeric">Jours vacances</th></tr></thead><tbody>${monthly.map(m=>`<tr><td>${m.month}</td><td class="numeric">${U().money(m.ca)}</td><td class="numeric">${m.tickets}</td><td class="numeric">${m.activeDays}</td><td class="numeric">${U().money(m.avgDay)}</td><td class="numeric">${m.holidayDays}</td></tr>`).join('')}</tbody></table></div></section></div><section class="panel section-gap"><h2>Journal quotidien</h2><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Période</th><th class="numeric">CA TTC</th><th class="numeric">Tickets</th><th class="numeric">Panier</th></tr></thead><tbody>${model.daily.slice().reverse().slice(0,250).map(d=>`<tr><td>${U().formatDate(d.date)}</td><td>${d.schoolHoliday?qualityPill('info',d.schoolHoliday):d.publicHoliday?qualityPill('warn',d.publicHoliday):'<span class="muted">Hors vacances</span>'}</td><td class="numeric">${U().money(d.caTTC)}</td><td class="numeric">${d.tickets}</td><td class="numeric">${U().money(d.avgBasket)}</td></tr>`).join('')}</tbody></table></div><div class="panel-sub" style="margin-top:8px">Les périodes scolaires ne sont classées que lorsque la date figure dans le calendrier Zone A intégré. Aucune période inconnue n’est inventée.</div></section>`}

  function associationsView(model,root){
    const name=code=>model.productByCode.get(code)?.designation||code;
    const strength=a=>a.lift>=2.2?'Très forte':a.lift>=1.6?'Forte':'À confirmer';
    root.innerHTML=viewHeader('Produits souvent achetés ensemble','Des idées de vente complémentaire basées sur les tickets réels, sans jargon statistique')+
      `<section class="panel"><div class="panel-sub" style="margin-bottom:12px">Plus le lien est fort, plus les deux produits reviennent souvent ensemble dans les mêmes paniers. À utiliser seulement quand la recommandation correspond au besoin du client.</div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Produit</th><th>Souvent acheté avec</th><th>Tickets concernés</th><th>Quand le 1er est acheté</th><th>Force du lien</th></tr></thead><tbody>${model.associations.map(a=>`<tr><td>${U().escapeHtml(name(a.a))}</td><td>${U().escapeHtml(name(a.b))}</td><td>${a.count}</td><td>${U().percent(a.confidenceAB)} prennent aussi le second</td><td><strong>${strength(a)}</strong></td></tr>`).join('')||'<tr><td colspan="5">Pas encore assez de paniers comparables pour proposer des associations fiables.</td></tr>'}</tbody></table></div><details class="merchant-detail-toggle"><summary>Voir les statistiques détaillées</summary><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Produit A</th><th>Produit B</th><th>Support</th><th>A → B</th><th>B → A</th><th>Lift</th></tr></thead><tbody>${model.associations.map(a=>`<tr><td>${U().escapeHtml(name(a.a))}</td><td>${U().escapeHtml(name(a.b))}</td><td>${U().percent(a.support)}</td><td>${U().percent(a.confidenceAB)}</td><td>${U().percent(a.confidenceBA)}</td><td>${a.lift.toFixed(2)}</td></tr>`).join('')}</tbody></table></div></details></section>`;
  }

  function compareView(model,root){const ref=U().dateKey(model.range.max),aStart=U().dateKey(U().addDays(model.range.max,-29)),bEnd=U().dateKey(U().addDays(model.range.max,-30)),bStart=U().dateKey(U().addDays(model.range.max,-59));root.innerHTML=viewHeader('Comparateur de périodes','Choisis deux périodes et vois immédiatement ce qui a progressé ou reculé')+`<section class="panel"><div class="compare-grid"><div class="compare-box"><h3>Période A</h3><div class="date-row"><input id="fromA" type="date" class="date-input" value="${aStart}"><input id="toA" type="date" class="date-input" value="${ref}"></div></div><div class="vs">VS</div><div class="compare-box"><h3>Période B</h3><div class="date-row"><input id="fromB" type="date" class="date-input" value="${bStart}"><input id="toB" type="date" class="date-input" value="${bEnd}"></div></div></div><div style="margin-top:12px"><button id="runCompare" class="btn btn-primary">Comparer</button></div><div id="compareResults"></div></section>`;function parse(id){const v=root.querySelector(id).value;return v?new Date(v+'T00:00:00'):null}function draw(){const r=AU.analytics.periodComparison(model,parse('#fromA'),parse('#toA'),parse('#fromB'),parse('#toB'));root.querySelector('#compareResults').innerHTML=`<div class="comparison-results">${comparisonCard('CA TTC',r.A.caTTC,r.B.caTTC,r.deltas.caTTC,U().money)}${comparisonCard('Tickets',r.A.tickets,r.B.tickets,r.deltas.tickets,U().integer)}${comparisonCard('Clients',r.A.clients,r.B.clients,r.deltas.clients,U().integer)}${comparisonCard('Panier moyen',r.A.avgBasket,r.B.avgBasket,r.deltas.avgBasket,U().money)}${comparisonCard('Marge',r.A.margin,r.B.margin,r.deltas.margin,U().money)}${comparisonCard('Quantités',r.A.qty,r.B.qty,r.deltas.qty,U().number)}${comparisonCard('Jours actifs',r.A.activeDays,r.B.activeDays,U().pctChange(r.A.activeDays,r.B.activeDays),U().integer)}${comparisonCard('CA / jour actif',r.A.avgPerActiveDay,r.B.avgPerActiveDay,r.deltas.avgPerActiveDay,U().money)}</div>`}root.querySelector('#runCompare').addEventListener('click',draw);draw()}
  function comparisonCard(label,a,b,d,fmt){if((/marge/i.test(label)&&currentModel?.financialAvailability?.margin===false)||(/\bHT\b/.test(label)&&currentModel?.financialAvailability?.ht===false)){a=null;b=null;d=null;}return`<div class="comparison-card"><span>${U().escapeHtml(label)}</span><strong>${fmt(a)}</strong><small>${deltaText(d)}</small><div class="panel-sub">B : ${fmt(b)}</div></div>`}

  function qualityView(model,root){const q=model.quality;const c=q.matchCounts,cat=q.catalogCounts;root.innerHTML=viewHeader('Qualité & traçabilité','Audit complet des imports et du croisement — aucune ambiguïté n’est masquée')+`<div class="quality-grid"><div class="quality-card"><span>Transactions certifiées client</span><strong>${U().percent(q.clientCertifiedCoverage)}</strong><span>${c.certified} / ${model.transactions.length}</span></div><div class="quality-card"><span>Rattachement client total</span><strong>${U().percent(q.clientAnyCoverage)}</strong><span>inclut ${c.probable} probable(s)</span></div><div class="quality-card"><span>Couverture catalogue</span><strong>${U().percent(q.catalogueCoverage)}</strong><span>${cat.missing} ligne(s) manquante(s)</span></div><div class="quality-card"><span>Intégrité financière</span><strong>${q.financialIntegrity===null?'—':U().percent(q.financialIntegrity)}</strong><span>HT − achat = marge</span></div></div><div class="grid-equal section-gap"><section class="panel"><h2>Rattachement clients</h2><div class="alert-list"><div class="alert-row good"><span class="alert-dot"></span><div><strong>${c.certified} certifiées</strong><p>Identifiant fort exact et unique ou combinaison concordante.</p></div></div><div class="alert-row"><span class="alert-dot"></span><div><strong>${c.probable} probables</strong><p>Nom exact et unique uniquement ; jamais présenté comme certifié.</p></div></div><div class="alert-row"><span class="alert-dot"></span><div><strong>${c.anonymous} anonymes</strong><p>Aucune identité exploitable dans la vente.</p></div></div><div class="alert-row ${c.conflict?'bad':''}"><span class="alert-dot"></span><div><strong>${c.conflict} conflits</strong><p>Des identifiants forts pointent vers plusieurs fiches ; l’analyse doit être bloquée si cela arrive.</p></div></div></div></section><section class="panel"><h2>Rattachement catalogue</h2><div class="alert-list"><div class="alert-row good"><span class="alert-dot"></span><div><strong>${cat.exact} lignes exactes</strong><p>Code article strictement identique.</p></div></div><div class="alert-row good"><span class="alert-dot"></span><div><strong>${cat.normalized} lignes normalisées</strong><p>Différence de zéros initiaux uniquement et correspondance catalogue unique.</p></div></div><div class="alert-row"><span class="alert-dot"></span><div><strong>${cat.missing} lignes historiques absentes</strong><p>${U().money(q.missingCatalogCA)} de CA historique concerné.</p></div></div><div class="alert-row"><span class="alert-dot"></span><div><strong>${q.missingCategoryLines} lignes sans rayon final</strong><p>Ces lignes ne sont pas attribuées artificiellement à une catégorie.</p></div></div></div></section></div><section class="panel section-gap"><h2>Imports</h2>${importAudit(model)}</section><section class="panel section-gap"><h2>Règles de confiance</h2><div class="alert-list"><div class="alert-row good"><span class="alert-dot"></span><div><strong>Certifié</strong><p>Donnée source exacte ou calcul déterministe à partir de données contrôlées.</p></div></div><div class="alert-row"><span class="alert-dot"></span><div><strong>Partiel</strong><p>Le calcul est exact sur la couverture disponible, mais une partie des données n’est pas rattachable.</p></div></div><div class="alert-row"><span class="alert-dot"></span><div><strong>Estimation / signal</strong><p>Indicateur statistique ou explication possible. Ne doit jamais être formulé comme une cause certaine.</p></div></div><div class="alert-row bad"><span class="alert-dot"></span><div><strong>Blocage</strong><p>Conflit structurel ou identifiants contradictoires : Analysis Power refuse de poursuivre silencieusement.</p></div></div></div></section>`}

  function importAudit(model){const ventes=Array.isArray(model.imports.ventes)?model.imports.ventes:[model.imports.ventes].filter(Boolean);const imports=[model.imports.clients,...ventes,model.imports.catalogue].filter(Boolean);return`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Source</th><th>Fichier</th><th class="numeric">Lignes</th><th>État</th><th>Avertissements</th></tr></thead><tbody>${imports.map(i=>`<tr><td>${U().escapeHtml(AU.FILE_RULES[i.type]?.label||i.type)}</td><td>${U().escapeHtml(i.fileName)}</td><td class="numeric">${U().integer(i.rowCount)}</td><td>${qualityPill(i.ok?'certified':'blocked',i.ok?'Validé':'Refusé')}</td><td>${U().escapeHtml((i.report?.warnings||[]).join(' · ')||'Aucun')}</td></tr>`).join('')}</tbody></table></div><div class="panel-sub" style="margin-top:8px">Chevauchements Ventes exacts ignorés : ${model.salesMerge.duplicateTransactions.length}. Conflits Ventes : ${model.salesMerge.conflicts.length}.</div>`}

  function alertsView(model, root) {
    const high = model.customers.filter(c => c.risk.key === 'high').sort((a,b)=>b.estimatedMonthlyValue-a.estimatedMonthlyValue);
    const signaled = high.filter(c => c.signals.length);
    const unavailableFavorite = high.filter(c => c.signals.some(s => s.type === 'catalogue' || s.type === 'stock'));
    const stock = model.products.filter(p => ['negative','out','critical'].includes(p.stockStatus) && p.qty30 > 0).sort((a,b)=>b.qty30-a.qty30);
    root.innerHTML = viewHeader('Opportunités','Les clients et produits sur lesquels une action concrète peut être utile maintenant') +
      `<div class="kpi-grid">${kpi('Clients très en retard',high.length,'par rapport à leur propre habitude')}${kpi('Avec une raison visible',signaled.length,'un changement concret a été repéré')}${kpi('Produit favori indisponible',unavailableFavorite.length,'catalogue absent ou stock actuel ≤ 0')}${kpi('Produits à sécuriser',stock.length,'encore vendus mais stock trop faible')}${kpi('CA habituel concerné',U().money(U().sum(high.map(c=>c.estimatedMonthlyValue))),'estimation historique')}${kpi('Clients à surveiller',model.customers.filter(c=>c.risk.key==='watch').length,'ils commencent à tarder à revenir')}</div>
      <div class="grid-2"><section class="panel"><div class="panel-title"><h2>Clients prioritaires</h2><span class="panel-sub">Commence par ceux qui achetaient le plus régulièrement</span></div>${riskTable(high.slice(0,40))}</section><section class="panel"><div class="panel-title"><h2>Ce qui a changé chez ces clients</h2><span class="panel-sub">Des faits à vérifier avant de les relancer</span></div><div class="signal-list">${signaled.slice(0,20).map(c=>`<div class="signal" data-client-code="${U().escapeHtml(c.client.codeClient)}"><strong>${U().escapeHtml(c.client.name)}</strong> · ${U().escapeHtml(c.signals[0].text)}<div class="quality-tag">Ouvrir la fiche pour comprendre</div></div>`).join('')||'<div class="empty-mini">Aucun signal exploitable.</div>'}</div></section></div>
      <section class="panel section-gap"><div class="panel-title"><h2>Produits à sécuriser</h2><span class="panel-sub">Ils se vendent encore mais le stock peut devenir trop faible</span></div>${productTable(stock.slice(0,80))}</section>`;
    bindClientRows(root); bindProductRows(root);
  }

  function fidelityView(model, root) {
    const statusCounts = ['active','watch','risk','high'].map(key => ({key,count:model.customers.filter(c=>c.risk.key===key).length}));
    root.innerHTML = viewHeader('Fidélisation & zones','Qui revient, qui commence à s’éloigner et de quelles zones viennent les clients') +
      `<div class="kpi-grid">${kpi('Clients avec achats',model.customers.filter(c=>c.visitCount>0).length)}${kpi('Dans leur rythme',statusCounts.find(x=>x.key==='active').count)}${kpi('Commencent à tarder',statusCounts.find(x=>x.key==='watch').count)}${kpi('En retard',statusCounts.find(x=>x.key==='risk').count)}${kpi('Très en retard',statusCounts.find(x=>x.key==='high').count)}${kpi('Sans achat reconnu',model.customers.filter(c=>!c.visitCount).length)}</div>
      <section class="panel"><div class="panel-title"><h2>Les clients reviennent-ils après leur premier mois d’achat ?</h2><span class="panel-sub">Premier achat visible dans l’historique importé. Le mois courant est partiel ; les mois futurs restent non calculables.</span></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Premier mois vu</th><th class="numeric">Clients</th><th class="numeric">CA cumulé</th><th class="numeric">Mois d’arrivée</th><th class="numeric">1 mois après</th><th class="numeric">2 mois après</th><th class="numeric">3 mois après</th><th class="numeric">4 mois après</th><th class="numeric">5 mois après</th><th class="numeric">6 mois après</th></tr></thead><tbody>${model.cohorts.map(c=>`<tr><td><strong>${c.cohort}</strong></td><td class="numeric">${c.size}</td><td class="numeric">${U().money(c.totalSpend)}</td>${c.retention.map(r=>`<td class="numeric">${U().percent(r.rate)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
      <div class="grid-equal section-gap"><section class="panel"><h2>Zones clientes par CA</h2>${bars(model.geography,r=>r.caTTC,r=>`${r.postal} ${r.city}`,U().money,15)}</section><section class="panel"><h2>Détail géographique</h2><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Zone</th><th class="numeric">CA</th><th class="numeric">Tickets</th><th class="numeric">Clients</th><th class="numeric">Panier</th></tr></thead><tbody>${model.geography.slice(0,80).map(g=>`<tr><td>${U().escapeHtml(`${g.postal} ${g.city}`)}</td><td class="numeric">${U().money(g.caTTC)}</td><td class="numeric">${g.tickets}</td><td class="numeric">${g.clients}</td><td class="numeric">${U().money(g.avgBasket)}</td></tr>`).join('')}</tbody></table></div><div class="panel-sub" style="margin-top:8px">Cette vue utilise uniquement les tickets reliés à un client dont la ville ou le code postal est connu.</div></section></div>`;
  }

  function salesforceView(model, root) {
    const d = model.discountAnalysis;
    root.innerHTML = viewHeader('Équipe & remises','Compare les ventes et les remises, avec une limite importante : Power ne connaît pas les heures réellement travaillées sans planning') +
      `<div class="kpi-grid">${kpi('Tickets remisés',d.discounted.tickets,`${U().percent(d.discountedShare)} des tickets`)}${kpi('Montant remises',U().money(d.discountAmount))}${kpi('Panier avec remise',U().money(d.discounted.avgBasket))}${kpi('Panier sans remise',U().money(d.fullPrice.avgBasket))}${kpi('CA avec remise',U().money(d.discounted.caTTC))}${kpi('CA sans remise',U().money(d.fullPrice.caTTC))}</div>
      <section class="panel"><div class="panel-title"><h2>Performance par vendeur</h2><span class="panel-sub">À lire avec les horaires de présence : un vendeur présent davantage d’heures aura naturellement plus de ventes</span></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Vendeur</th><th class="numeric">CA TTC</th><th class="numeric">Tickets</th><th class="numeric">Panier</th><th class="numeric">Marge</th><th class="numeric">Clients</th><th class="numeric">Tickets remisés</th><th class="numeric">Part remisée</th><th class="numeric">Remises €</th></tr></thead><tbody>${model.vendors.map(v=>`<tr><td><strong>${U().escapeHtml(v.vendor)}</strong></td><td class="numeric">${U().money(v.caTTC)}</td><td class="numeric">${v.tickets}</td><td class="numeric">${U().money(v.avgBasket)}</td><td class="numeric">${U().money(v.margin)}</td><td class="numeric">${v.clients}</td><td class="numeric">${v.discountedTickets}</td><td class="numeric">${U().percent(v.discountedShare)}</td><td class="numeric">${U().money(v.discount)}</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  function autopilotStrip(model) {
    const a=model.autopilot; const g=model.geoIntelligence;
    if(!a) return '';
    const topZone=g?.zones?.[0];
    const zoneText=topZone&&topZone.impactScore>=25?`${topZone.name} mérite une attention particulière`:'Aucune zone ne décroche fortement';
    return `<section class="autopilot-strip section-gap"><div><span class="eyebrow">ANALYSE AUTOMATIQUE TERMINÉE</span><strong>Power a tout vérifié</strong><small>${a.executed.length} contrôles effectués automatiquement après l’import</small></div><div><span>Clients par zone</span><strong>${U().escapeHtml(zoneText)}</strong><small>${topZone&&topZone.impactScore>=25?'ouvre la zone pour voir pourquoi':'situation géographique normale'}</small></div><button class="btn btn-small" data-go-autopilot>Voir les contrôles</button></section>`;
  }

  function autopilotView(model, root) {
    const a=model.autopilot;
    if(!a){root.innerHTML=viewHeader('Contrôles automatiques','Les contrôles automatiques ne sont pas disponibles pour le moment.');return;}
    const urgent=(a.recommendations||[]).filter(x=>['critical','warning'].includes(x.level)).length;
    root.innerHTML=viewHeader('Ce que Power a vérifié',`Tous les contrôles sont lancés automatiquement après l’import · ${U().formatDate(a.generatedAt)}`)+
      `<section class="autopilot-hero"><div><span class="eyebrow">ANALYSE AUTOMATIQUE</span><h2>${urgent?`${urgent} action(s) méritent ton attention`:'Aucune urgence détectée'}</h2><p>Power a contrôlé les ventes, les clients, les produits, le stock, les zones et le contexte local. Les calculs restent cachés ; seules les conclusions utiles remontent.</p></div></section>
      <div class="grid-2 section-gap"><section class="panel"><div class="panel-title"><div><h2>Ce que Power a contrôlé tout seul</h2><div class="panel-sub">Ces vérifications sont faites automatiquement après l’import.</div></div><span class="pill good">${a.executed.length} exécutées</span></div><div class="autopilot-actions">${a.executed.map(x=>`<article class="auto-action ${x.level}"><div><span class="auto-check">✓</span><strong>${U().escapeHtml(x.title)}</strong></div><p>${U().escapeHtml(x.result)}</p>${x.details?.length?`<details><summary>Voir ce que Power a trouvé</summary><ul>${x.details.map(d=>`<li>${U().escapeHtml(d)}</li>`).join('')}</ul></details>`:''}</article>`).join('')}</div></section>
      <section class="panel"><div class="panel-title"><div><h2>Ce que tu peux faire maintenant</h2><div class="panel-sub">Power prépare les priorités, mais n’envoie aucun message et ne passe aucune commande à ta place.</div></div></div><ol class="action-list">${a.recommendations.slice(0,18).map(r=>`<li><span class="action-level ${r.level}"></span><div><strong>${U().escapeHtml(r.action)}</strong><small>${U().escapeHtml(r.source)}${r.external?' · action externe préparée':''}</small></div></li>`).join('')}</ol></section></div>`;
  }

  function fmtDelta(v){return v===null||!Number.isFinite(v)?'—':`${v>=0?'+':''}${(v*100).toFixed(1)} %`;}
  function sourceHealthView(ctx){
    const s=ctx?.source; if(!s)return '<div class="empty-mini">Aucun état de synchronisation publique disponible.</div>';
    const rows=Array.isArray(currentModel?.publicContext?.source_health)?currentModel.publicContext.source_health:[];
    const badge=s.level==='good'?'stable':s.level==='watch'?'watch':'critical';
    const age=s.ageHours===null?'—':`${s.ageHours.toFixed(1)} h`;
    return `<div class="api-sentinel-head"><div><span class="eyebrow">SOURCES LOCALES</span><strong><span class="geo-score ${badge}">${s.apiOk?'SOURCES À JOUR':'SOURCE DE SECOURS UTILISÉE'}</span></strong><p>Dernière synchro ${ctx.generatedAt?U().formatDate(new Date(ctx.generatedAt)):'inconnue'} · ancienneté ${age} · ${s.ok}/${s.total} sources publiques valides.</p></div><div class="api-stat"><strong>${s.totalDatasets??'—'}</strong><span>sources publiques repérées</span></div></div>
      <div class="source-health-grid">${rows.map(r=>`<article class="source-health-card ${r.ok?'ok':'fail'}"><div><span class="source-dot"></span><strong>${U().escapeHtml(r.name||'Source')}</strong></div><p>${U().escapeHtml(r.detail||r.error||'Contrôle exécuté')}</p></article>`).join('')}</div>`;
  }
  function geoView(model, root) {
    const g=model.geoIntelligence;
    if(!g){root.innerHTML=viewHeader('Autour du commerce','La lecture géographique n’est pas disponible pour le moment.')+'<section class="panel"><div class="empty-mini">Les autres analyses restent disponibles. Relance l’analyse pour reconstruire cette vue.</div></section>';return;}
    const zones=arr(g.zones), pressure=zones.filter(z=>(Number(z.impactScore)||0)>=25);
    const ctx=model.contextCorrelation||{}, urban=ctx.urban||{}, agenda=urban.agenda||null, t2c=urban.t2c||null, parking=ctx.parking||null;
    const findings=arr(g.findings), hist=arr(model.analysisHistory), matches=arr(ctx.matches);
    const works=[]; const seen=new Set();
    for(const m of matches){for(const w of arr(m.works)){const k=w.event_id||`${w.place}|${w.text}`;if(seen.has(k))continue;seen.add(k);works.push(w);}}
    const zoneCards=zones.slice(0,12).map(z=>{
      const visitDelta=Number(z.visitsDelta); const caDelta=Number(z.caDelta);
      const bad=(z.impactScore||0)>=70, watch=(z.impactScore||0)>=25;
      const status=bad?'À TRAITER':watch?'À SURVEILLER':'STABLE';
      const cls=bad?'bad':watch?'watch':'good';
      const driver=Math.abs(Number(z.trafficEffect)||0)>=Math.abs(Number(z.basketEffect)||0)?'Le principal changement vient du nombre de passages.':'Le principal changement vient du panier moyen.';
      const visitText=Number.isFinite(visitDelta)?`Les visites ont ${visitDelta<0?'baissé':'augmenté'} de ${Math.abs(visitDelta*100).toFixed(1)} %.`:'Les visites ne sont pas comparables sur cette période.';
      const caText=Number.isFinite(caDelta)?`Le CA a ${caDelta<0?'baissé':'augmenté'} de ${Math.abs(caDelta*100).toFixed(1)} %.`:'';
      const risk=z.highRisk?` ${z.highRisk} client(s) habituel(s) de cette zone sont très en retard.`:'';
      return `<article class="merchant-zone-card"><div><h3>${U().escapeHtml(z.name||'Zone')}</h3><p>${U().escapeHtml(`${visitText} ${caText} ${driver}${risk}`)}</p></div><span class="zone-status ${cls}">${status}</span></article>`;
    }).join('');
    const worksCards=works.slice(0,8).map(w=>AU.power.officialSourceCard(w)).join('');
    root.innerHTML=viewHeader(`Autour du commerce${model.storeProfile?.city?` · ${U().escapeHtml(model.storeProfile.city)}`:''}`,'Power regarde où vivent les clients et ce qui se passe réellement autour du point de vente. Les travaux et événements ne sont jamais présentés comme une cause tant qu’ils ne sont pas reliés à une baisse ou une hausse précise.')+
      `<section class="geo-hero"><div><span class="eyebrow">LECTURE LOCALE</span><h2>${pressure.length?`${pressure.length} zone(s) méritent ton attention`:'Aucune zone ne décroche fortement'}</h2><p>${pressure.length?'Power a repéré des secteurs où les clients viennent moins ou dépensent moins. Ouvre les constats ci-dessous pour savoir ce qui est réellement démontré.':'Les zones clientes évoluent sans décrochage suffisamment important pour déclencher une alerte.'}</p></div></section>
      <div class="kpi-grid section-gap">
        ${kpi('Parkings',parking&&finite(parking.avgOccupancy)?`${fixed(parking.avgOccupancy)} % occupés`:'Donnée en attente',parking?`${parking.records||0} parking(s) suivis`:'aucune donnée récente',false)}
        ${kpi('Transports T2C',t2c?.decoded?(t2c.cancelled?`${t2c.cancelled} annulation(s)`:'Service suivi'):'Donnée en attente',t2c?.decoded?(Math.abs(Number(t2c.avgDelay)||0)>=120?'retards notables détectés':'pas de perturbation importante dans les données reçues'):'aucune donnée exploitable',false)}
        ${kpi('Événements à venir',agenda?U().integer(agenda.next7||0):'Donnée en attente','dans les 7 prochains jours',false)}
        ${kpi('Travaux connus',U().integer(works.length),'informations publiques actuellement récupérées',false)}
      </div>
      <section class="panel section-gap"><div class="panel-title"><div><h2>Ce qui change selon les zones clientes</h2><div class="panel-sub">Les phrases ci-dessous disent directement ce qui change dans chaque zone.</div></div></div><div class="merchant-zone-list">${zoneCards||'<div class="empty-mini">Aucune zone exploitable.</div>'}</div>
        <details class="merchant-detail-toggle"><summary>Voir le détail chiffré des zones</summary><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Zone</th><th>CA</th><th>Évolution CA</th><th>Visites</th><th>Évolution visites</th><th>Clients très en retard</th></tr></thead><tbody>${zones.slice(0,60).map(z=>`<tr><td><strong>${U().escapeHtml(z.name||'Zone')}</strong></td><td>${U().money(Number(z.current?.ca)||0)}</td><td>${fmtDelta(z.caDelta)}</td><td>${U().integer(z.current?.visits||0)}</td><td>${fmtDelta(z.visitsDelta)}</td><td>${U().integer(z.highRisk||0)}</td></tr>`).join('')}</tbody></table></div></details>
      </section>
      <div class="grid-2 section-gap"><section class="panel"><div class="panel-title"><h2>Ce que Power a réellement détecté</h2><span class="panel-sub">Un problème, puis seulement une cause si elle est suffisamment solide.</span></div><div class="intel-finding-list">${findings.map(f=>findingCard({...f,confidenceLabel:f.confidence>=90?'Très forte':f.confidence>=75?'Forte':'Moyenne'},false)).join('')||'<div class="empty-mini">Aucun problème géographique important.</div>'}</div></section>
      <section class="panel"><div class="panel-title"><h2>Informations publiques autour du commerce</h2><span class="panel-sub">Informations connues, pas causes automatiques.</span></div>${worksCards||'<div class="empty-mini">Aucun chantier pertinent n’est actuellement récupéré autour des zones suivies.</div>'}${agenda?.upcoming?.length?`<div class="context-zone"><strong>Événements officiels à venir</strong><ul>${agenda.upcoming.slice(0,6).map(e=>`<li>${U().escapeHtml(e.title||'Événement')} · ${U().escapeHtml(e.place||model.storeProfile?.city||'')}</li>`).join('')}</ul></div>`:''}</section></div>
      <section class="panel section-gap"><div class="panel-title"><h2>Évolution des principales zones</h2><span class="panel-sub">Pour voir rapidement si une zone se dégrade ou se reprend.</span></div><div class="geo-spark-grid">${zones.slice(0,6).map((z,i)=>`<article class="geo-spark-card"><div><strong>${U().escapeHtml(z.name||'Zone')}</strong><span>${arr(z.series).length?`${U().integer(z.series.at(-1)?.visits||0)} visites la dernière semaine`:''}</span></div>${sparkCanvas(`geoSpark${i}`,arr(z.series),'ca')}</article>`).join('')}</div></section>
      <details class="merchant-detail-toggle section-gap"><summary>Voir l’état technique des sources publiques</summary><section class="panel">${sourceHealthView(ctx)}</section></details>
      <section class="panel section-gap"><div class="panel-title"><h2>Historique du suivi</h2><span class="panel-sub">Pour voir si les problèmes se répètent ou disparaissent.</span></div>${hist.length?`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Analyse</th><th>Données jusqu’au</th><th>Tickets</th><th>Clients très en retard</th><th>Zone à regarder en premier</th></tr></thead><tbody>${hist.slice(-12).reverse().map(h=>{const z=[...arr(h.geo)].sort((a,b)=>(b.impactScore||0)-(a.impactScore||0))[0];return `<tr><td>${U().formatDate(new Date(h.capturedAt))}</td><td>${U().formatDate(new Date(h.dataMax))}</td><td>${U().integer(h.transactions||0)}</td><td>${U().integer(h.riskHigh||0)}</td><td>${z?U().escapeHtml(z.name||'Zone'):'—'}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty-mini">Le premier historique sera créé après cette analyse.</div>'}</section>`;
    const renderRoot=root;
    requestAnimationFrame(()=>{if(!renderRoot.isConnected)return;zones.slice(0,6).forEach((z,i)=>drawSpark(renderRoot.querySelector(`#geoSpark${i}`),arr(z.series),'ca'));});
  }

  function intelligenceView(model, root) {
    const intel = model.intelligence;
    if (!intel) {
      root.innerHTML = viewHeader('À faire maintenant','Power n’a pas pu terminer l’analyse.') + '<div class="empty-mini">Aucune conclusion disponible.</div>';
      return;
    }
    const findings = intel.findings.filter(f=>f.category!=='quality');
    const critical = findings.filter(f=>['critical','warning'].includes(f.level)).length;
    const opportunities = findings.filter(f=>['opportunity','positive'].includes(f.level)).length;
    const highRisk = intel.watchlists.highRisk;
    const stock = intel.watchlists.stock;
    root.innerHTML = viewHeader('À faire maintenant', `Power a analysé ${U().integer(model.transactions.length)} transactions et ne remonte ici que les éléments utiles à une décision.`) +
      executiveHero(model) +
      `<div class="kpi-grid section-gap">
        ${kpi('Points à traiter', U().integer(critical), 'problèmes ou baisses qui méritent une action',false)}
        ${kpi('Opportunités', U().integer(opportunities), 'progressions ou pistes de vente utiles',false)}
        ${kpi('Clients très en retard', U().integer(highRisk.length), 'à regarder en priorité',false)}
        ${kpi('Produits à sécuriser', U().integer(stock.length), 'stock ou ventes à surveiller',false)}
      </div>
      <div class="grid-intelligence section-gap">
        <section class="panel intelligence-main"><div class="panel-title"><div><h2>Ce que Power a compris</h2><div class="panel-sub">Chaque carte répond à trois questions : qu’est-ce qui se passe, pourquoi, que faire.</div></div><select id="intelFilter" class="select-input"><option value="">Tout afficher</option><option value="critical">À traiter</option><option value="warning">À surveiller</option><option value="opportunity">Opportunités</option><option value="positive">Progressions</option><option value="customer">Clients</option><option value="product">Produits</option><option value="stock">Stock</option><option value="margin">Marge</option><option value="calendar">Calendrier</option><option value="geo">Zones</option></select></div><div id="intelFindings" class="intel-finding-list"></div></section>
        <aside class="intel-side">
          <section class="panel"><div class="panel-title"><h2>Les prochaines actions</h2><span class="panel-sub">Commence par le haut de la liste</span></div><ol class="action-list">${intel.actions.slice(0,10).map(a=>`<li><span class="action-level ${a.level}"></span><div><strong>${U().escapeHtml(a.action)}</strong><small>${U().escapeHtml(a.sourceTitle||'Analyse Power')}</small></div></li>`).join('') || '<li>Aucune action prioritaire.</li>'}</ol></section>
          <section class="panel section-gap"><div class="panel-title"><h2>Ce qui fait bouger le chiffre d’affaires</h2><span class="panel-sub">Seulement les deux leviers principaux</span></div><div class="decomposition"><div><span>Nombre de passages</span><strong class="${intel.metrics.decomposition.trafficEffect<0?'negative':'positive'}">${intel.metrics.decomposition.trafficEffect>=0?'+':''}${U().money(intel.metrics.decomposition.trafficEffect)}</strong></div><div><span>Panier moyen</span><strong class="${intel.metrics.decomposition.basketEffect<0?'negative':'positive'}">${intel.metrics.decomposition.basketEffect>=0?'+':''}${U().money(intel.metrics.decomposition.basketEffect)}</strong></div><div><span>Écart total de CA</span><strong>${intel.metrics.decomposition.totalDelta>=0?'+':''}${U().money(intel.metrics.decomposition.totalDelta)}</strong></div></div></section>
        </aside>
      </div>
      ${askPanel(model)}
      <div class="grid-equal section-gap">
        <section class="panel"><div class="panel-title"><h2>Clients à regarder en premier</h2><span class="panel-sub">Ceux qui tardent nettement plus que d’habitude</span></div>${riskTable(highRisk.slice(0,15))}</section>
        <section class="panel"><div class="panel-title"><h2>Produits à sécuriser</h2><span class="panel-sub">Vendus récemment avec un stock qui peut devenir bloquant</span></div>${productTable(stock.slice(0,15))}</section>
      </div>`;

    const filter = root.querySelector('#intelFilter');
    const list = root.querySelector('#intelFindings');
    const draw = () => {
      const f = filter.value;
      const rows = findings.filter(x => !f || x.level === f || x.category === f);
      list.innerHTML = rows.map(x=>findingCard(x,false)).join('') || '<div class="empty-mini">Rien à afficher dans cette catégorie.</div>';
    };
    filter.addEventListener('change', draw); draw();
    bindAsk(model, root); bindClientRows(root); bindProductRows(root);
  }

  function contextView(model,root){
    const c=model.causalContext;
    if(!c){root.innerHTML=viewHeader('Pourquoi ça bouge ?','Power cherche une cause seulement après avoir détecté un vrai problème commercial.')+'<section class="panel"><div class="empty-mini">L’analyse des causes n’a pas encore été exécutée.</div></section>';return;}
    const top=c.top||[], events=c.events||[];
    const profile=AU.power?.profileSummary?.(model.storeProfile)||{};
    const withoutCause=Number(c.audit?.withoutCause||0);
    root.innerHTML=viewHeader('Pourquoi ça bouge ?','Ici, Power n’affiche que les causes qu’il peut expliquer clairement. Si la cause n’est pas assez solide, il dit simplement qu’elle n’est pas identifiée.')+
      `<div class="quality-grid">
        <div class="quality-card"><span>Causes identifiées</span><strong>${U().integer(c.strong+c.moderate)}</strong><span>explications assez solides pour être montrées</span></div>
        <div class="quality-card"><span>Cause encore inconnue</span><strong>${U().integer(withoutCause)}</strong><span>Power préfère ne pas inventer</span></div>
        <div class="quality-card"><span>Sources officielles reliées</span><strong>${U().integer(events.length)}</strong><span>travaux ou événements réellement utilisés</span></div>
      </div>
      <div class="power-context-profile section-gap"><div class="pin">⌖</div><div><strong>${U().escapeHtml(profile.label||'Adresse commerce non configurée')}</strong><span>${U().escapeHtml(profile.configured?'Les causes locales sont vérifiées autour de cette adresse.':'Configure l’adresse pour vérifier précisément travaux, accès et événements locaux.')}</span></div></div>
      <div class="grid-intelligence section-gap">
        <section class="panel intelligence-main"><div class="panel-title"><div><h2>Causes que Power peut défendre</h2><div class="panel-sub">Chaque explication doit pouvoir être comprise et vérifiée immédiatement.</div></div></div>
          ${top.length?top.map(x=>{
            const cause=x.retainedCauses?.[0]; const sources=(x.retainedCauses||[]).filter(v=>v.type==='works'&&v.work).map(v=>AU.power.officialSourceCard(v.work)).join('');
            const label=x.status==='strong'?'Cause très probable':'Cause probable';
            return `<article class="context-card ${x.status}"><div class="context-card-head"><strong>${U().escapeHtml(x.title)}</strong><span>${label}</span></div><div class="power-retained-cause"><strong>${U().escapeHtml(cause?.label||'Cause identifiée')}</strong><p>${U().escapeHtml(x.summary||cause?.evidence||'')}</p></div>${(x.chain||[]).length?`<ol>${x.chain.slice(1).map(v=>`<li>${U().escapeHtml(v)}</li>`).join('')}</ol>`:''}${sources}</article>`;
          }).join(''):'<div class="empty-mini"><strong>Aucune cause assez solide pour être affichée.</strong><br>Les problèmes détectés restent visibles dans « À faire maintenant », mais Power ne leur invente pas d’explication.</div>'}
        </section>
        <aside class="intel-side">
          <section class="panel"><div class="panel-title"><h2>Sources officielles utilisées</h2><span class="panel-sub">Seulement lorsqu’elles servent réellement à expliquer un problème</span></div>${events.length?events.map(e=>AU.power.officialSourceCard(e.work)).join(''):'<div class="empty-mini">Aucun chantier ou événement public n’est actuellement utilisé comme explication.</div>'}</section>
          <section class="panel section-gap"><h2>Principe Power</h2><p class="muted">Une information peut être surveillée sans être montrée. Elle n’apparaît comme cause que si elle correspond au bon endroit, à la bonne période et au bon mouvement commercial.</p></section>
        </aside>
      </div>`;
  }

  function causalAuditPanel(model){
    const c=model.causalContext;if(!c)return '';
    const rows=(c.results||[]).filter(x=>x.tested).flatMap(x=>(x.rejectedCauses||[]).map(r=>({diagnostic:x.title,label:r.label,strength:r.strength,evidence:r.evidence})));
    return `<section class="panel section-gap"><div class="panel-title"><div><h2>Pistes vérifiées puis écartées</h2><div class="panel-sub">Cette partie sert uniquement à comprendre ce que Power a contrôlé avant de refuser une mauvaise explication.</div></div><span class="pill muted">${U().integer(rows.length)} piste(s)</span></div>${rows.length?`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Problème analysé</th><th>Piste vérifiée</th><th>Pourquoi Power ne la retient pas</th></tr></thead><tbody>${rows.slice(0,200).map(r=>`<tr><td>${U().escapeHtml(r.diagnostic)}</td><td>${U().escapeHtml(r.label)}</td><td>${U().escapeHtml(r.evidence||'Les éléments disponibles ne suffisent pas à en faire une explication fiable.')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-mini">Aucune piste écartée enregistrée.</div>'}</section>`;
  }

  function render(view,model,root){
    currentModel=model;if(!model||!root)return;
    const views={today:AU.director.renderToday,operations:AU.director.renderOperations,reorder:AU.director.renderReorder,settings:AU.director.renderSettings,dashboard,autopilot:autopilotView,geo:geoView,intelligence:intelligenceView,context:contextView,clients:clientsView,alerts:alertsView,fidelity:fidelityView,products:productsView,rayons:rayonsView,stock:stockView,salesforce:AU.director.renderTeam,calendar:calendarView,associations:associationsView,compare:compareView,quality:qualityView};
    const fn=views[view]||dashboard;
    try{fn(model,root);if(view==='quality')root.insertAdjacentHTML('beforeend',causalAuditPanel(model));bindFindingActions(root);bindPowerLens(model,root);root.dataset.viewState='ready';delete root.dataset.viewError;}
    catch(err){
      console.error(`Analysis Power render error [${view}]`,err);root.dataset.viewState='error';root.dataset.viewError=String(err?.message||err);
      root.innerHTML=viewHeader(view==='geo'?'Autour du commerce':'Affichage temporairement indisponible','Power a rencontré un problème d’affichage, mais les données analysées restent intactes.')+`<section class="panel"><div class="empty-mini"><strong>L’analyse n’est pas perdue.</strong><br>${U().escapeHtml(err?.message||String(err))}<br><br><button class="btn btn-primary" data-retry-view>Réessayer l’affichage</button></div></section>`;
      root.querySelector('[data-retry-view]')?.addEventListener('click',()=>setTimeout(()=>render(view,model,root),0));
    }
  }
  function closeDetail(){document.getElementById('detailModal')?.classList.add('hidden')}
  function toast(message,type='good'){const root=document.getElementById('toastRoot');const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=message;root.appendChild(el);setTimeout(()=>el.remove(),4500)}

  return {render,showClientDetail,showProductDetail,closeDetail,toast};
})();
