window.AU = window.AU || {};

/* Operational layer: deterministic metrics over the validated transaction ledger. */
AU.director = (() => {
  const U = () => AU.util;
  const esc = v => U().escapeHtml(v ?? '');
  const own = (o,k) => Object.prototype.hasOwnProperty.call(o || {},k) ? o[k] : undefined;
  const date = s => U().parseTgmDate(s);
  const defaults = {basis:'TTC', monthlyGoal:0, leadDays:5, safetyDays:7, targetDays:28, openDays:[1,2,3,4,5,6], closedDates:[]};
  let data = {settings:{...defaults}, tasks:{}, manual:[], journal:[], itemRules:{}, lastBackup:null};
  let period = 'month', comparison = 'previous', selectedVendor = '', orderSearch = '', orderSupplier = '', orderMode = 'needed';
  const basisKey = () => data.settings.basis === 'HT' ? 'ht' : 'ttc';
  const amount = v => v === null || !Number.isFinite(v) ? 'Non disponible' : U().money(v);
  const n = (v, fallback, min=0, max=1000000) => Number.isFinite(Number(v)) ? Math.max(min,Math.min(max,Number(v))) : fallback;

  function setData(value) {
    const v = value && typeof value === 'object' ? value : {};
    const s = v.settings || {};
    data = {settings:{basis:s.basis==='HT'?'HT':'TTC',monthlyGoal:n(s.monthlyGoal,0),leadDays:n(s.leadDays,5,0,365),safetyDays:n(s.safetyDays,7,0,365),targetDays:n(s.targetDays,28,1,365),
      openDays:Array.isArray(s.openDays)?[...new Set(s.openDays.filter(x=>Number.isInteger(x)&&x>=0&&x<=6))]:defaults.openDays,
      closedDates:Array.isArray(s.closedDates)?s.closedDates.filter(x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&date(x)).slice(0,1000):[]},
      tasks:v.tasks && typeof v.tasks==='object'&&!Array.isArray(v.tasks)?v.tasks:{},
      itemRules:v.itemRules&&typeof v.itemRules==='object'&&!Array.isArray(v.itemRules)?v.itemRules:{},
      manual:Array.isArray(v.manual)?v.manual.filter(t=>t&&typeof t.id==='string'&&typeof t.title==='string').slice(0,1000):[],
      journal:Array.isArray(v.journal)?v.journal.slice(-200):[],lastBackup:typeof v.lastBackup==='string'?v.lastBackup:null};
  }
  async function persist() { await AU.storage.saveDirector(data); }
  async function change(fn) {
    const before = structuredClone(data);
    try { fn(); await persist(); return true; }
    catch(e) { data = before; AU.ui.toast('Modification non sauvegardée : '+e.message,'bad'); return false; }
  }
  const getData = () => structuredClone(data);
  const dayList = (from,to) => {const rows=[]; for(let d=U().startOfDay(from);d&&d<=to&&rows.length<3700;d=U().addDays(d,1))rows.push(d);return rows;};
  const isOpen = d => data.settings.openDays.includes(d.getDay())&&!data.settings.closedDates.includes(U().dateKey(d));

  function ranges(model, mode=period, comp=comparison) {
    const to=U().startOfDay(model.range.max);
    let from=to;
    if(mode==='week') from=U().addDays(to,-((to.getDay()+6)%7));
    if(mode==='month') from=new Date(to.getFullYear(),to.getMonth(),1);
    if(mode==='28') from=U().addDays(to,-27);
    if(mode==='all') from=U().startOfDay(model.range.min);
    const span=U().daysBetween(from,to)+1;
    const shift=comp==='year'?364:Math.ceil(span/7)*7;
    const previousFrom=U().addDays(from,-shift),previousTo=U().addDays(to,-shift);
    const available=d=>U().startOfDay(d)>=U().startOfDay(model.range.min);
    return {from,to,previousFrom,previousTo,span,complete:available(from),comparable:available(previousFrom)&&mode!=='all'};
  }
  function slice(model,from,to) { return AU.analytics.transactionsInRange(model.transactions,from,to); }
  function hasField(model,txs,field) {
    const flag=field==='ht'?'htAvailable':'marginAvailable', col=field==='ht'?'Vente HT':'Marge';
    if(!txs.length) return model.imports.ventes.every(i=>(i.report?.columns||[]).includes(col));
    return txs.every(t=>t.lines.every(l=>l[flag]===true || (l[flag]===undefined&&model.imports.ventes.every(i=>(i.report?.columns||[]).includes(col)))));
  }
  function metrics(model,txs) {
    const ht=hasField(model,txs,'ht')?U().sum(txs.map(t=>t.ht)):null;
    const margin=hasField(model,txs,'margin')?U().sum(txs.map(t=>t.margin)):null;
    const purchases=txs.filter(t=>t.ttc>0);
    const value = basisKey()==='ht'?ht:U().sum(txs.map(t=>t.ttc));
    const positiveValue=basisKey()==='ht'?(ht===null?null:U().sum(purchases.map(t=>t.ht))):U().sum(purchases.map(t=>t.ttc));
    return {value,ht,margin,marginRate:ht!==null&&ht>0&&margin!==null?margin/ht:null, tickets:txs.length,purchases:purchases.length,
      basket:purchases.length&&positiveValue!==null?positiveValue/purchases.length:null,
      returns:txs.filter(t=>t.hasReturn).length,returnValue:U().sum(txs.flatMap(t=>t.lines).filter(l=>l.isReturn||l.qty<0).map(l=>l.saleTTC)),
      discounts:U().sum(txs.map(t=>t.discount)),discountTickets:purchases.filter(t=>t.discount>0).length,
      discountAvailable:model.imports.ventes.every(i=>(i.report?.columns||[]).includes('Remise')),
      qty:U().sum(txs.map(t=>t.qty)),days:new Set(txs.map(t=>t.dateKey)).size};
  }
  function pct(a,b) { if(a===null||b===null||!b)return 'Comparaison indisponible';const d=(a-b)/Math.abs(b);return `${d>=0?'+':''}${U().percent(d)}`; }
  function metricCard(label,value,sub='',tone='') {return `<article class="dir-metric ${tone}"><span>${esc(label)}</span><strong>${value}</strong><small>${sub}</small></article>`;}
  const button=(label,view,primary=false)=>`<button class="btn ${primary?'btn-primary':''}" data-dir-nav="${esc(view)}">${esc(label)}</button>`;
  function header(title,subtitle,actions='') {return `<div class="view-header"><div><span class="eyebrow">STOOM · DIRECTOR</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="view-actions">${actions}</div></div>`;}
  function controls(model) {const r=ranges(model);return `<div class="dir-controls"><div class="dir-segments" role="group" aria-label="Période analysée">${[['latest','Dernier jour'],['week','Semaine'],['month','Mois'],['28','28 jours'],['all','Historique']].map(([v,l])=>`<button data-dir-period="${v}" aria-pressed="${period===v}" class="${period===v?'selected':''}">${l}</button>`).join('')}</div><label>Comparer à <select id="dirComparison"><option value="previous" ${comparison==='previous'?'selected':''}>Période précédente · mêmes jours</option><option value="year" ${comparison==='year'?'selected':''}>52 semaines avant · mêmes jours</option></select></label><span class="dir-basis">CA ${data.settings.basis}</span></div><p class="dir-period">${U().formatDate(r.from)} → ${U().formatDate(r.to)} · ${r.comparable?`Comparaison : ${U().formatDate(r.previousFrom)} → ${U().formatDate(r.previousTo)}`:'Historique insuffisant pour cette comparaison'}${r.complete?'':' · Début de période absent'}.</p>`;}
  function bindCommon(root,model,render) {
    root.querySelectorAll('[data-dir-nav]').forEach(b=>b.addEventListener('click',()=>AU.app.switchView(b.dataset.dirNav)));
    root.querySelectorAll('[data-dir-period]').forEach(b=>b.addEventListener('click',()=>{period=b.dataset.dirPeriod;render(model,root);}));
    root.querySelector('#dirComparison')?.addEventListener('change',e=>{comparison=e.target.value;render(model,root);});
    root.querySelectorAll('[data-dir-client]').forEach(b=>b.addEventListener('click',()=>AU.ui.showClientDetail(b.dataset.dirClient)));
    root.querySelectorAll('[data-dir-product]').forEach(b=>b.addEventListener('click',()=>AU.ui.showProductDetail(b.dataset.dirProduct)));
  }
  function freshness(model) {
    const lag=U().daysBetween(model.range.max,new Date());
    const stockDate=model.imports.catalogue.observedAt||model.imports.catalogue.sourceLastModified||model.imports.catalogue.importedAt;
    const stockLag=stockDate?U().daysBetween(stockDate,new Date()):null;
    return {lag,stockDate,stockLag};
  }
  function chart(model,r) {
    const a=U().groupBy(slice(model,r.from,r.to),t=>t.dateKey), b=U().groupBy(slice(model,r.previousFrom,r.previousTo),t=>t.dateKey);
    const days=dayList(r.from,r.to), shift=U().daysBetween(r.previousFrom,r.from);
    const values=days.map(d=>({d,a:metrics(model,a.get(U().dateKey(d))||[]).value,b:r.comparable?metrics(model,b.get(U().dateKey(U().addDays(d,-shift)))||[]).value:null,seen:a.has(U().dateKey(d))}));
    const all=values.flatMap(x=>[x.a,x.b]).filter(Number.isFinite), min=Math.min(0,...all), max=Math.max(1,...all), span=max-min;
    const x=i=>40+i/Math.max(1,values.length-1)*810, y=v=>184-(v-min)/span*158;
    const path=key=>values.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(v[key]||0).toFixed(1)}`).join(' ');
    if(!all.length)return '<p class="dir-note">CA HT absent des exports. Choisir TTC dans les réglages.</p>';
    return `<svg class="dir-chart" viewBox="0 0 890 218" role="img" aria-label="Chiffre d’affaires quotidien sur la période sélectionnée. Les valeurs exactes figurent dans le tableau sous le graphique."><defs><linearGradient id="dirArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#398aff" stop-opacity=".28"/><stop offset="100%" stop-color="#398aff" stop-opacity="0"/></linearGradient></defs>${[0,.5,1].map(z=>`<line x1="40" x2="850" y1="${26+158*z}" y2="${26+158*z}" stroke="#233041"/><text x="42" y="${20+158*z}" fill="#9aaec6" font-size="12">${esc(U().number(max-z*span))} €</text>`).join('')}<path d="${path('a')} L${x(values.length-1)},${y(0)} L40,${y(0)} Z" fill="url(#dirArea)"/>${r.comparable?`<path d="${path('b')}" fill="none" stroke="#8999b4" stroke-width="2" stroke-dasharray="5 6"/>`:''}<path d="${path('a')}" fill="none" stroke="#4b9aff" stroke-width="3"/>${values.length===1?`<circle cx="40" cy="${y(values[0].a||0)}" r="5" fill="#4b9aff"/>`:''}<text x="40" y="211" fill="#9aaec6" font-size="13">${esc(U().formatDate(r.from))}</text><text x="850" y="211" text-anchor="end" fill="#9aaec6" font-size="13">${esc(U().formatDate(r.to))}</text></svg><div class="dir-legend"><span>━ Période sélectionnée</span><span>┄ Comparaison</span></div><details class="dir-details"><summary>Voir les montants par jour</summary>${table(['Jour',`CA ${data.settings.basis}`,'Comparaison','Présence de tickets'],values.map(v=>[U().formatDate(v.d),amount(v.a),amount(v.b),v.seen?'Oui':'Aucun ticket importé']))}</details>`;
  }
  function table(headers,rows) {return `<div class="data-table-wrap"><table class="data-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">Aucune donnée pour cette sélection.</td></tr>`}</tbody></table></div>`;}

  function goal(model) {
    const ref=U().startOfDay(model.range.max), start=new Date(ref.getFullYear(),ref.getMonth(),1), end=new Date(ref.getFullYear(),ref.getMonth()+1,0);
    const days=dayList(start,end).filter(isOpen), elapsed=days.filter(d=>d<=ref).length, remaining=days.length-elapsed;
    const actual=metrics(model,slice(model,start,ref)).value, target=data.settings.monthlyGoal;
    const complete=U().startOfDay(model.range.min)<=start;
    return {actual,target,remaining,elapsed,totalDays:days.length,complete,pace:target&&days.length?target*elapsed/days.length:null,daily:target&&remaining&&actual!==null?Math.max(0,target-actual)/remaining:null};
  }
  function reorder(model) {
    const f=freshness(model), end=U().startOfDay(model.range.max), start=U().addDays(end,-27);
    const actualStart=start<model.range.min?U().startOfDay(model.range.min):start, observedDays=U().daysBetween(actualStart,end)+1;
    const items=new Map(model.catalogue.map(i=>[i.articleCode,{item:i,qty:0,revenue:0}]));
    for(const l of model.sales) {
      if(!U().inRange(l.date,actualStart,U().endOfDay(end)))continue;
      const row=items.get(l.catalogueItem?.articleCode||l.articleCode);
      if(row&&l.qty>0&&!l.isReturn){row.qty+=l.qty;row.revenue+=l.saleTTC;}
    }
    const horizon=Math.max(data.settings.targetDays,data.settings.leadDays+data.settings.safetyDays);
    return [...items.values()].map(({item,qty,revenue})=>{
      const rule=own(data.itemRules,item.articleCode)||{}, pack=Math.max(1,Math.round(n(rule.pack,1))), incoming=n(rule.incoming,0);
      const rate=qty/observedDays, coverage=rate>0?item.stock/rate:null;
      const reason=item.stock<0?'Stock à corriger':!qty?'Sans vente observée':item.stock===0?'Rupture':coverage<=data.settings.leadDays+data.settings.safetyDays?'À commander':'Stock couvert';
      const proposed=item.stock<0||!qty?0:Math.ceil(Math.max(0,rate*horizon-item.stock-incoming)/pack)*pack;
      return {code:item.articleCode,name:item.designation,supplier:item.supplier||'Sans fournisseur',rayon:item.rayon,stock:item.stock,qty,rate,coverage,pack,incoming,proposed,reason,revenue,observedDays,stockLag:f.stockLag};
    }).sort((a,b)=>(a.reason==='Stock à corriger'?-1:b.reason==='Stock à corriger'?1:0)||((a.stock<=0&&a.qty>0)?-1:(b.stock<=0&&b.qty>0)?1:0)||b.proposed-a.proposed||b.revenue-a.revenue);
  }
  function actionList(model) {
    const f=freshness(model), list=[];
    if(f.lag>2)list.push({id:'fresh-sales',title:'Actualiser les ventes',detail:`Dernier ticket : ${U().formatDate(model.range.max)}. Les alertes clients sont calculées à cette date.`,view:'quality',priority:'high'});
    if(f.stockLag===null||f.stockLag>2)list.push({id:'fresh-stock',title:'Actualiser le stock',detail:'Vérifier un catalogue récent avant de préparer la commande.',view:'reorder',priority:'high'});
    const orders=reorder(model), critical=orders.filter(x=>['Stock à corriger','Rupture','À commander'].includes(x.reason));
    if(critical.length)list.push({id:'stock-review',title:`Sécuriser ${critical.length} référence(s)`,detail:'Contrôler le stock physique et les commandes en cours, puis préparer le réassort.',view:'reorder',priority:'high'});
    const late=model.customers.filter(c=>c.risk.key==='high'&&c.identityQuality==='certified');
    if(late.length)list.push({id:'client-review',title:`Revoir ${late.length} client(s) très en retard`,detail:'Examiner les habitudes et les produits favoris ; vérifier les autorisations avant toute relance.',view:'clients',priority:'medium'});
    for(const f of (model.intelligence?.findings||[]).filter(f=>['critical','warning','opportunity'].includes(f.level)).slice(0,8)) {
      list.push({id:'finding-'+(f.id||f.title),title:f.title,detail:f.actions?.[0]||f.summary||'',view:'intelligence',priority:f.level==='critical'?'high':'medium'});
    }
    list.push(...data.manual.map(t=>({...t,manual:true,priority:'medium'})));
    return list.map(t=>{const saved=own(data.tasks,t.id)||{};return {...t,...saved,id:t.id,title:t.title,detail:t.detail,manual:t.manual};});
  }
  function taskCard(t,compact=false) {
    const today=U().dateKey(new Date()), done=t.manual?!!t.done:t.done===today;
    const status=done?(t.manual?'Action traitée':'Traitée aujourd’hui'):t.due&&t.due>today?`Prévue le ${U().formatDate(date(t.due))}`:t.due&&t.due<today?'Échéance dépassée':'À traiter';
    return `<article class="dir-task ${done?'done':t.priority==='high'?'high':'medium'}"><div><span class="dir-status">${esc(status)}</span><h3>${esc(t.title)}</h3><p>${esc(t.detail)}</p>${t.note?`<p class="dir-task-note">${esc(t.note)}</p>`:''}</div><div class="dir-task-buttons">${t.view?button('Examiner',t.view):''}<button class="btn ${done?'':'btn-primary'}" data-task-done="${esc(t.id)}">${done?'Rouvrir':'Marquer traitée'}</button></div>${compact?'':`<div class="dir-task-edit"><label>Échéance <input type="date" data-task-due="${esc(t.id)}" value="${esc(t.due||'')}"></label><label>Note / responsable <input maxlength="500" data-task-note="${esc(t.id)}" value="${esc(t.note||'')}" placeholder="Décision, responsable, résultat…"></label></div>`}</article>`;
  }
  function bindTasks(root,model,render) {
    root.querySelectorAll('[data-task-done]').forEach(b=>b.addEventListener('click',async()=>{const id=b.dataset.taskDone,today=U().dateKey(new Date());if(await change(()=>{const s=own(data.tasks,id)||{};data.tasks[id]={...s,done:(id.startsWith('manual-')?!!s.done:s.done===today)?null:today};}))render(model,root);}));
    for(const field of ['due','note'])root.querySelectorAll(`[data-task-${field}]`).forEach(input=>input.addEventListener('change',async()=>{const id=input.dataset[field==='due'?'taskDue':'taskNote'];await change(()=>data.tasks[id]={...(own(data.tasks,id)||{}),[field]:input.value});}));
  }
  function renderToday(model,root) {
    const r=ranges(model), current=slice(model,r.from,r.to), previous=r.comparable?slice(model,r.previousFrom,r.previousTo):[];
    const a=metrics(model,current),b=r.comparable?metrics(model,previous):null,f=freshness(model),g=goal(model);
    const tasks=actionList(model).filter(t=>!(t.manual?t.done:t.done===U().dateKey(new Date()))&&(!t.due||t.due<=U().dateKey(new Date())));
    const missing=dayList(r.from,r.to).filter(d=>isOpen(d)&&!current.some(t=>t.dateKey===U().dateKey(d)));
    root.innerHTML=header('Ma journée','Les chiffres utiles. Les décisions à prendre.',button('Préparer le réassort','reorder')+button('Plan d’action','operations',true))+
      `<div class="dir-freshness ${f.lag>2?'warn':''}"><span><strong>Ventes au ${U().formatDate(model.range.max)}</strong> · Stock daté du ${U().formatDate(f.stockDate)}</span><span>${f.lag===0?'Dernier jour en cours · potentiellement incomplet':f.lag>0?`${f.lag} jour(s) depuis le dernier ticket`:'Date future à vérifier'}</span></div>`+controls(model)+
      `<div class="dir-kpis">${metricCard(`Chiffre d’affaires ${data.settings.basis}`,amount(a.value),b?`${pct(a.value,b.value)} · référence ${amount(b.value)}`:'Comparaison indisponible','primary')}${metricCard('Tickets d’achat',U().integer(a.purchases),`${a.tickets} tickets au total · ${a.returns} avec retour`)}${metricCard(`Panier d’achat ${data.settings.basis}`,amount(a.basket),'Tickets à montant TTC positif')}${metricCard('Marge commerciale',amount(a.margin),a.marginRate===null?'HT ou marge manquant':`${U().percent(a.marginRate)} du CA HT`)}</div>`+
      `<div class="dir-grid"><section class="panel dir-trend"><div class="panel-title"><div><span class="eyebrow">ACTIVITÉ</span><h2>Le rythme du magasin</h2></div><span class="pill info">CA ${data.settings.basis}</span></div>${chart(model,r)}<p class="dir-note">${missing.length?`${missing.length} jour(s) d’ouverture prévu(s) sans ticket importé : absence de vente ou données manquantes à vérifier.`:'Présence de tickets sur chaque jour d’ouverture prévu de cette période.'} La présence de tickets ne garantit pas que les exports sont complets.</p></section>
      <section class="panel dir-goal"><span class="eyebrow">CAP DU MOIS</span><h2>Objectif ${data.settings.basis}</h2>${g.target?`<div class="dir-goal-value">${amount(g.actual)}</div><p>sur ${amount(g.target)}</p><progress max="100" value="${g.actual!==null?Math.max(0,Math.min(100,g.actual/g.target*100)):0}" aria-label="Avancement de l’objectif mensuel"></progress><div class="dir-goal-meta"><strong>${g.complete&&g.daily!==null?amount(g.daily):'—'}</strong><span>à réaliser par jour d’ouverture restant</span></div><p class="dir-note">${g.remaining} jour(s) prévu(s) après le dernier jour importé. ${g.complete?'Calcul indicatif selon les jours d’ouverture configurés ; le dernier jour importé est supposé terminé.':'Début du mois absent : rythme à atteindre non calculé.'}</p>`:'<div class="dir-goal-value">Fixer le cap.</div><p>Renseigner un objectif mensuel et les jours d’ouverture pour suivre l’avance ou le retard.</p>'}${button('Régler les objectifs','settings')}</section></div>`+
      `<section class="panel section-gap"><div class="panel-title"><div><span class="eyebrow">DÉCISIONS</span><h2>${tasks.length?'À traiter en priorité':'Aucune action en attente aujourd’hui'}</h2></div>${button('Tout voir','operations')}</div><div class="dir-priorities">${tasks.slice(0,3).map(t=>taskCard(t,true)).join('')||'<p class="dir-note">Les contrôles restent accessibles dans les analyses détaillées.</p>'}</div></section>`+
      `<div class="dir-shortcuts">${button('Performance des vendeurs','salesforce')}${button('Clients & habitudes','clients')}${button('Produits & rayons','products')}${button('Journal des imports','settings')}${button('Détails & audit','quality')}</div>`;
    bindCommon(root,model,renderToday);bindTasks(root,model,renderToday);
  }
  function renderOperations(model,root) {
    const tasks=actionList(model),done=tasks.filter(t=>t.manual?!!t.done:t.done===U().dateKey(new Date())).length;
    root.innerHTML=header('Plan d’action',`${tasks.length-done} action(s) non traitée(s) aujourd’hui · ${done} traitée(s)`,button('Retour au cockpit','today'))+
      `<section class="panel"><form id="newTask" class="dir-add-task"><label>Ajouter une action magasin<input id="taskTitle" required maxlength="160" placeholder="Ex. Contrôler le stock des résistances"></label><button class="btn btn-primary">Ajouter</button></form><p class="dir-note">Les actions automatiques sont réévaluées après chaque import. Leur traitement vaut pour la journée ; notes et échéances sont conservées.</p></section><div class="dir-task-list section-gap">${tasks.map(t=>taskCard(t)).join('')}</div>`;
    bindCommon(root,model,renderOperations);bindTasks(root,model,renderOperations);
    root.querySelector('#newTask').addEventListener('submit',async e=>{e.preventDefault();const title=root.querySelector('#taskTitle').value.trim();if(title&&await change(()=>data.manual.push({id:'manual-'+crypto.randomUUID(),title,detail:'Action ajoutée par le magasin.'})))renderOperations(model,root);});
  }
  function renderReorder(model,root) {
    const all=reorder(model), f=freshness(model);
    const rows=all.filter(x=>(!orderSupplier||x.supplier===orderSupplier)&&U().normText(`${x.code} ${x.name} ${x.rayon}`).includes(U().normText(orderSearch))&&(orderMode==='all'||orderMode==='needed'&&(x.proposed>0||x.stock<0)||orderMode==='unsold'&&!x.qty&&x.stock>0));
    root.innerHTML=header('Préparer le réassort','Suggestions à valider avec le stock physique et les commandes en cours.',button('Règles de commande','settings')+'<button id="exportOrder" class="btn btn-primary">Exporter cette liste</button>')+
      `<div class="dir-freshness ${f.stockLag>2||f.lag>2?'warn':''}"><span>Stock daté du ${U().formatDate(f.stockDate)} · Ventes au ${U().formatDate(model.range.max)}</span><span>${f.stockLag>2||f.lag>2?'Données anciennes : actualiser avant de commander.':'Vérifier la date réelle des exports.'}</span></div><div class="dir-kpis">${metricCard('Références à préparer',U().integer(all.filter(x=>x.proposed>0).length),'Horizon et conditionnements configurables')}${metricCard('Stocks négatifs',U().integer(all.filter(x=>x.stock<0).length),'Comptage nécessaire · aucune quantité suggérée')}${metricCard('Sans vente sur la fenêtre',U().integer(all.filter(x=>!x.qty&&x.stock>0).length),'Pas automatiquement du stock mort')}${metricCard('Historique de demande',`${all[0]?.observedDays||0} jours`,'Fenêtre limitée aux 28 derniers jours')}</div>
      <section class="panel"><div class="table-tools"><label>Rechercher<input id="orderSearch" class="search-input" value="${esc(orderSearch)}" placeholder="Référence, produit, rayon"></label><label>Fournisseur<select id="orderSupplier" class="select-input"><option value="">Tous les fournisseurs</option>${[...new Set(all.map(x=>x.supplier))].sort(U().sortFrench).map(s=>`<option ${s===orderSupplier?'selected':''}>${esc(s)}</option>`).join('')}</select></label><label>Afficher<select id="orderMode" class="select-input"><option value="needed" ${orderMode==='needed'?'selected':''}>À préparer / corriger</option><option value="unsold" ${orderMode==='unsold'?'selected':''}>En stock sans vente récente</option><option value="all" ${orderMode==='all'?'selected':''}>Tout le catalogue</option></select></label></div><p class="dir-note">${rows.length} référence(s). Calcul : demande quotidienne × horizon − stock − en commande, arrondi au lot supérieur. Retours exclus de la demande. Vérifier les unités en commande après chaque import et les remettre à zéro à réception. Un export partiel ou une rupture passée peut sous-estimer la demande. Les coûts d’achat unitaires ne sont pas fournis par le catalogue : aucun budget d’achat n’est inventé.</p>
      <div class="data-table-wrap"><table class="data-table dir-order-table"><thead><tr>${['Référence / produit','Fournisseur','Stock','Vendu','Couverture','État','Lot','En commande','Suggestion'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,250).map(x=>`<tr><td><strong>${esc(x.name)}</strong><small>${esc(x.code)}</small></td><td>${esc(x.supplier)}</td><td>${U().number(x.stock)}</td><td>${U().number(x.qty)}</td><td>${x.coverage===null?'—':`${Math.max(0,x.coverage).toFixed(1)} j`}</td><td>${esc(x.reason)}</td><td><input aria-label="Lot pour ${esc(x.name)}" data-order-pack="${esc(x.code)}" type="number" min="1" step="1" value="${x.pack}"></td><td><input aria-label="En commande pour ${esc(x.name)}" data-order-incoming="${esc(x.code)}" type="number" min="0" step="1" value="${x.incoming}"></td><td class="dir-order-qty">${x.stock<0?'À vérifier':U().integer(x.proposed)}</td></tr>`).join('')||'<tr><td colspan="9">Aucune référence pour ce filtre.</td></tr>'}</tbody></table></div>${rows.length>250?'<p class="dir-note">Affichage limité aux 250 premières références. L’export contient toute la sélection.</p>':''}</section>`;
    bindCommon(root,model,renderReorder);
    root.querySelector('#orderSearch').addEventListener('change',e=>{orderSearch=e.target.value;renderReorder(model,root);});
    root.querySelector('#orderSupplier').addEventListener('change',e=>{orderSupplier=e.target.value;renderReorder(model,root);});
    root.querySelector('#orderMode').addEventListener('change',e=>{orderMode=e.target.value;renderReorder(model,root);});
    for(const field of ['pack','incoming'])root.querySelectorAll(`[data-order-${field}]`).forEach(input=>input.addEventListener('change',async()=>{if(!input.reportValidity())return;const key=input.dataset[field==='pack'?'orderPack':'orderIncoming'];if(await change(()=>data.itemRules[key]={...(own(data.itemRules,key)||{}),[field]:Number(input.value)}))renderReorder(model,root);}));
    root.querySelector('#exportOrder').addEventListener('click',()=>U().downloadText(`STOOM-Reassort-${U().dateKey(new Date())}.csv`,U().toCsv(rows.map(x=>({'Code':x.code,'Produit':x.name,'Fournisseur':x.supplier,'Stock':x.stock,'Date stock':U().dateKey(f.stockDate),'Date ventes':U().dateKey(model.range.max),'Jours observes':x.observedDays,'Quantite vendue':x.qty,'Lot':x.pack,'En commande':x.incoming,'Quantite suggeree':x.stock<0?'A verifier':x.proposed,'Etat':x.reason}))), 'text/csv;charset=utf-8'));
  }

  function renderSettings(model,root) {
    const s=data.settings;
    const imports=[model.imports.clients,...model.imports.ventes,model.imports.catalogue];
    root.innerHTML=header('Réglages & mémoire','Objectifs, règles de gestion et historique des mises à jour.',button('Retour au cockpit','today'))+
      `<div class="dir-grid"><section class="panel"><h2>Règles de pilotage</h2><form id="directorSettings" class="dir-form"><label>Base du chiffre d’affaires<select name="basis"><option ${s.basis==='TTC'?'selected':''}>TTC</option><option ${s.basis==='HT'?'selected':''}>HT</option></select></label><label>Objectif mensuel (€)<input name="monthlyGoal" type="number" min="0" max="1000000" step=".01" value="${s.monthlyGoal}"></label><label>Délai fournisseur (jours calendaires)<input name="leadDays" type="number" min="0" max="365" value="${s.leadDays}"></label><label>Stock de sécurité (jours)<input name="safetyDays" type="number" min="0" max="365" value="${s.safetyDays}"></label><label>Horizon de stock visé (jours)<input name="targetDays" type="number" min="1" max="365" value="${s.targetDays}"></label><fieldset><legend>Jours d’ouverture habituels</legend><div class="dir-weekdays">${['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'].map((l,i)=>`<label><input type="checkbox" name="openDay" value="${i}" ${s.openDays.includes(i)?'checked':''}>${l}</label>`).join('')}</div></fieldset><label class="dir-full">Fermetures exceptionnelles (une date AAAA-MM-JJ par ligne)<textarea name="closedDates" rows="3">${esc(s.closedDates.join('\n'))}</textarea></label><button class="btn btn-primary">Enregistrer les réglages</button></form></section>
      <section class="panel"><h2>Mémoire du magasin</h2><p>Les ventes validées s’ajoutent à l’historique. Un doublon exact est ignoré. Un conflit bloque la nouvelle analyse et préserve la précédente.</p><div class="dir-backup-actions"><button class="btn btn-primary" data-backup>Exporter une sauvegarde complète</button><button class="btn" data-restore>Restaurer une sauvegarde</button></div><p class="dir-note">Sauvegarde : ventes, clients, catalogue, paramètres, actions, journal et relevés de stock. Fichier contenant des données clients à conserver dans un emplacement privé. Stockage lié à ce navigateur et à l’adresse du site ; exporter avant de changer d’appareil ou d’adresse.</p><p class="dir-note">Dernière sauvegarde exportée : ${data.lastBackup?esc(new Date(data.lastBackup).toLocaleString('fr-FR')):'aucune enregistrée'}.</p><h3>Sources actives</h3>${table(['Source','Fichier','Lignes','Période / relevé'],imports.map(i=>[i.type,i.fileName,i.rowCount,i.type==='ventes'?`${U().formatDate(i.report?.metrics?.minDate)} → ${U().formatDate(i.report?.metrics?.maxDate)}`:U().formatDate(i.observedAt||i.importedAt)]))}</section></div>
      <section class="panel section-gap"><h2>Journal des imports validés</h2>${table(['Validation','Fichiers reçus','Tickets ajoutés','Doublons ignorés','Total tickets','Historique après import'],data.journal.slice().reverse().map(j=>[new Date(j.at).toLocaleString('fr-FR'),j.files,j.added,j.duplicates,j.total,j.range]))}<p class="dir-note">Le journal démarre avec cette version et conserve les 200 dernières validations. Une période entre deux tickets ne prouve pas que tous les jours intermédiaires sont couverts.</p></section>`;
    const months = new Map();
    for(let d=new Date(model.range.min.getFullYear(),model.range.min.getMonth(),1);d<=model.range.max;d=new Date(d.getFullYear(),d.getMonth()+1,1))months.set(U().monthKey(d),[]);
    for(const tx of model.transactions)months.get(U().monthKey(tx.date))?.push(tx);
    root.insertAdjacentHTML('beforeend',`<section class="panel section-gap"><h2>Mémoire des périodes observées</h2>${table(['Mois','Tickets importés','Jours avec tickets','Premier / dernier ticket','CA TTC observé'],[...months].map(([key,ts])=>[key,ts.length,new Set(ts.map(t=>t.dateKey)).size,ts.length?`${U().formatDate(ts[0].date)} → ${U().formatDate(ts.at(-1).date)}`:'Aucun ticket importé',ts.length?amount(U().sum(ts.map(t=>t.ttc))):'Non disponible']))}<p class="dir-note">Un mois comportant des tickets n’est pas forcément complet. Un mois vide peut correspondre à des données absentes ou à une fermeture : le logiciel ne tranche pas sans preuve.</p></section><section class="panel section-gap"><h2>Relevés de stock conservés</h2>${table(['Date du relevé','Fichier','Références'],(model.stockHistory||[]).slice(-30).reverse().map(x=>[U().formatDate(x.capturedAt),x.sourceFile,x.items.length]))}<p class="dir-note">Les 30 derniers relevés sont affichés. La sauvegarde complète conserve tous les relevés enregistrés.</p></section>`);
    bindCommon(root,model,renderSettings);
    root.querySelector('#directorSettings').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target),closed=String(fd.get('closedDates')).split(/\s+/).filter(Boolean);if(closed.some(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x)||!date(x))){AU.ui.toast('Une date de fermeture est invalide. Format : AAAA-MM-JJ.','bad');return;}if(await change(()=>setData({...data,settings:{...Object.fromEntries(fd),openDays:fd.getAll('openDay').map(Number),closedDates:closed}})))AU.ui.toast('Règles de pilotage enregistrées.');});
    root.querySelector('[data-backup]').addEventListener('click',()=>AU.app.exportBackup());
    root.querySelector('[data-restore]').addEventListener('click',()=>document.getElementById('restoreFile').click());
  }

  function vendorReport(model,txs,name) {
    const selected=name?txs.filter(t=>(t.vendor||'Non renseigné')===name):txs;
    const group=(key)=>[...U().groupBy(selected,key)].map(([label,items])=>({label,...metrics(model,items)}));
    const weekdays=Array.from({length:7},(_,i)=>{const day=(i+1)%7;return {day,label:['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'][day],...metrics(model,selected.filter(t=>t.date.getDay()===day))};});
    const hasHours=txs.some(t=>t.date.getHours()!==0||t.date.getMinutes()!==0);
    const hours=hasHours?group(t=>String(t.date.getHours()).padStart(2,'0')+' h').sort((a,b)=>a.label.localeCompare(b.label)):[];
    const days=group(t=>t.dateKey).sort((a,b)=>b.label.localeCompare(a.label));
    const mix=new Map();
    for(const t of selected)for(const l of t.lines){const key=l.effectiveRayon||'Non classé';if(!mix.has(key))mix.set(key,{label:key,ttc:0,ht:0,margin:0,qty:0,tickets:new Set()});const row=mix.get(key);row.ttc+=l.saleTTC;row.ht+=l.saleHT;row.margin+=l.margin;row.qty+=l.qty;row.tickets.add(t.key);}
    const rayons=[...mix.values()].sort((a,b)=>b[basisKey()]-a[basisKey()]);
    // Weighted peer basket within weekday + time block; no causal ranking or inferred hours worked.
    const peers=name?txs.filter(t=>(t.vendor||'Non renseigné')!==name&&t.vendor&&t.ttc>0):[];
    const cell=t=>`${t.date.getDay()}|${hasHours?Math.floor(t.date.getHours()/3):'day'}`;
    const peerGroups=U().groupBy(peers,cell), selectedGroups=U().groupBy(selected.filter(t=>t.ttc>0),cell);
    let expected=0,observed=0,matched=0;
    for(const [key,items]of selectedGroups){const other=peerGroups.get(key)||[];if(other.length<5||items.length<5)continue;const pm=metrics(model,other),sm=metrics(model,items);if(pm.basket===null||sm.basket===null)continue;expected+=pm.basket*items.length;observed+=sm.basket*items.length;matched+=items.length;}
    return {selected,summary:metrics(model,selected),weekdays,hours,hasHours,days,rayons,matched,expectedBasket:matched?expected/matched:null,observedBasket:matched?observed/matched:null};
  }
  function renderTeam(model,root) {
    const r=ranges(model),txs=slice(model,r.from,r.to),names=[...new Set(txs.map(t=>t.vendor||'Non renseigné'))].sort(U().sortFrench);
    if(selectedVendor&&!names.includes(selectedVendor))selectedVendor='';
    const report=vendorReport(model,txs,selectedVendor),m=report.summary;
    const qualified=report.weekdays.filter(d=>d.purchases>=10&&d.basket!==null).sort((a,b)=>b.basket-a.basket);
    const sellerRows=names.map(name=>({name,...metrics(model,txs.filter(t=>(t.vendor||'Non renseigné')===name))})).sort((a,b)=>(b.value||0)-(a.value||0));
    const performanceRows=rows=>rows.map(x=>[x.label,amount(x.value),x.purchases,amount(x.basket),amount(x.margin),x.returns,x.discountAvailable?`${x.discountTickets}/${x.purchases}`:'Non disponible']);
    root.innerHTML=header('Équipe & performance','Comprendre les ventes de chaque vendeur et les moments où elles se réalisent.','<button id="exportTeam" class="btn btn-primary">Exporter le détail quotidien</button>')+controls(model)+
      `<div class="dir-team-select"><label>Vendeur analysé<select id="selectedVendor"><option value="">Toute l’équipe</option>${names.map(v=>`<option ${v===selectedVendor?'selected':''}>${esc(v)}</option>`).join('')}</select></label><p>Les chiffres sont attribués au vendeur enregistré sur le ticket. Sans planning ni fréquentation, le taux de conversion et les ventes par heure travaillée ne sont pas calculables.</p></div>
      <div class="dir-kpis">${metricCard(`CA net ${data.settings.basis}`,amount(m.value),`${m.days} jour(s) avec tickets`,'primary')}${metricCard('Tickets d’achat',U().integer(m.purchases),`${m.tickets} tickets incluant avoirs et retours`)}${metricCard(`Panier d’achat ${data.settings.basis}`,amount(m.basket),'Tickets à montant TTC positif')}${metricCard('Marge commerciale',amount(m.margin),m.marginRate===null?'Données insuffisantes':`${U().percent(m.marginRate)} du CA HT`)}</div>
      <div class="dir-grid"><section class="panel"><span class="eyebrow">LECTURE DES ÉCARTS</span><h2>${esc(selectedVendor||'Toute l’équipe')}</h2><p>${qualified.length>=2?`Avec au moins 10 tickets d’achat par jour de semaine, le panier le plus élevé est observé le ${esc(qualified[0].label.toLowerCase())} (${amount(qualified[0].basket)}) et le plus bas le ${esc(qualified.at(-1).label.toLowerCase())} (${amount(qualified.at(-1).basket)}).`:'Pas assez de tickets pour distinguer des jours forts ou faibles avec le seuil de 10 achats par jour de semaine.'}</p><p class="dir-note">Ce sont des constats sur les tickets importés. L’affluence, les horaires de présence et les produits vendus peuvent expliquer les différences.</p>${selectedVendor?`<h3>Repère équipe sur des créneaux comparables</h3><p>${report.matched>=20?`Panier : ${amount(report.observedBasket)} contre ${amount(report.expectedBasket)} pour les autres vendeurs, pondéré selon les jours de semaine${report.hasHours?' et blocs de 3 heures':''} fréquentés. Écart : ${pct(report.observedBasket,report.expectedBasket)}. ${report.matched} ticket(s) comparables sur ${m.purchases}.`:'Volume insuffisant : au moins 5 tickets de chaque côté par créneau et 20 tickets comparables sont nécessaires.'}</p><p class="dir-note">Ce repère ne corrige pas le mix produits ni le profil client et n’est pas une mesure de performance individuelle pure.</p>`:''}</section>
      <section class="panel"><span class="eyebrow">REMISES & RETOURS</span><h2>Points à examiner</h2><div class="dir-detail-pairs"><div><span>Tickets d’achat remisés</span><strong>${m.discountAvailable?`${m.discountTickets} / ${m.purchases}`:'Non disponible'}</strong></div><div><span>Remises enregistrées</span><strong>${m.discountAvailable?amount(m.discounts):'Non disponible'}</strong></div><div><span>Tickets comportant un retour</span><strong>${m.returns}</strong></div><div><span>Montant des lignes de retour TTC</span><strong>${amount(m.returnValue)}</strong></div><div><span>Quantités nettes</span><strong>${U().number(m.qty)}</strong></div></div><p class="dir-note">Un retour est rattaché au vendeur du ticket de retour ; il ne prouve pas un problème lors de la vente initiale. Les remises peuvent suivre une offre du magasin.</p></section></div>
      <section class="panel section-gap"><h2>Vue de l’équipe</h2>${table(['Vendeur',`CA ${data.settings.basis}`,'Achats',`Panier ${data.settings.basis}`,'Marge','Tickets avec retour','Achats remisés'],performanceRows(sellerRows.map(x=>({...x,label:x.name}))))}</section>
      <div class="dir-grid section-gap"><section class="panel"><h2>Par jour de semaine</h2>${table(['Jour',`CA ${data.settings.basis}`,'Achats','Panier','Marge','Retours','Remisés'],performanceRows(report.weekdays))}</section><section class="panel"><h2>Par tranche horaire</h2>${report.hasHours?table(['Heure',`CA ${data.settings.basis}`,'Achats','Panier','Marge','Retours','Remisés'],performanceRows(report.hours)):'<p>Les tickets sont tous horodatés à minuit : les heures ne sont pas exploitables.</p>'}<p class="dir-note">Heures telles qu’enregistrées dans TGM. Les jours sans ticket ne permettent pas de déduire les absences du vendeur.</p></section></div>
      <section class="panel section-gap"><h2>Mix de vente par rayon</h2>${table(['Rayon',`CA ${data.settings.basis}`,'Quantités nettes','Tickets','Marge'],report.rayons.map(x=>[x.label,amount(basisKey()==='ht'&&m.ht===null?null:x[basisKey()]),U().number(x.qty),x.tickets.size,amount(m.margin===null?null:x.margin)]))}</section>
      <section class="panel section-gap"><h2>Détail quotidien</h2>${table(['Date',`CA ${data.settings.basis}`,'Achats','Panier','Marge','Retours','Remisés'],performanceRows(report.days))}</section>`;
    bindCommon(root,model,renderTeam);
    root.querySelector('#selectedVendor').addEventListener('change',e=>{selectedVendor=e.target.value;renderTeam(model,root);});
    root.querySelector('#exportTeam').addEventListener('click',()=>{const groups=U().groupBy(report.selected,t=>`${t.vendor||'Non renseigné'}|${t.dateKey}`);const rows=[...groups.values()].map(ts=>{const m=metrics(model,ts);return {'Vendeur':ts[0].vendor||'Non renseigné','Date':ts[0].dateKey,'Base CA':data.settings.basis,'CA net':m.value,'Tickets total':m.tickets,'Tickets achat':m.purchases,'Panier achat':m.basket,'Marge':m.margin,'Tickets retour':m.returns,'Lignes retour TTC':m.returnValue,'Remises':m.discountAvailable?m.discounts:null,'Achats remises':m.discountAvailable?m.discountTickets:null};});U().downloadText(`STOOM-Equipe-${U().dateKey(r.from)}-${U().dateKey(r.to)}.csv`,U().toCsv(rows),'text/csv;charset=utf-8');});
  }
  return {setData,getData,persist,change,ranges,metrics,reorder,goal,vendorReport,freshness,actionList,renderToday,renderOperations,renderReorder,renderSettings,renderTeam};
})();
