window.AU = window.AU || {};

AU.causalContext = (() => {
  const U = () => AU.util;
  const DAY = 86400000;
  const MONTHS = {
    janvier:0,fevrier:1,mars:2,avril:3,mai:4,juin:5,juillet:6,aout:7,septembre:8,octobre:9,novembre:10,decembre:11
  };
  const WEEKDAYS = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];

  function clamp(v,a=0,b=100){ return Math.max(a,Math.min(b,v)); }
  function n(v){ return U().normText(v || '').toLowerCase(); }
  function pct(a,b){ return b ? (a-b)/Math.abs(b) : null; }
  function sum(rows,key){ return U().sum(rows.map(x=>Number(typeof key==='function'?key(x):x[key])||0)); }
  function escRe(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

  function parseIso(value){
    if(!value) return null;
    const s=String(value).trim();
    const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m){ const d=new Date(+m[1],+m[2]-1,+m[3]); return Number.isNaN(d.getTime())?null:d; }
    const d=new Date(s); return Number.isNaN(d.getTime())?null:d;
  }

  function monthIndex(word){ return MONTHS[n(word)] ?? null; }
  function lastDay(year,month){ return new Date(year,month+1,0).getDate(); }
  function dateFromParts(day,month,year){
    const mi=monthIndex(month); if(mi===null||!year) return null;
    const d=new Date(+year,mi,+day); return Number.isNaN(d.getTime())?null:d;
  }
  function monthBoundary(month,year,end=false){
    const mi=monthIndex(month); if(mi===null||!year) return null;
    return new Date(+year,mi,end?lastDay(+year,mi):1);
  }

  function extractDatesFromText(text){
    const raw=String(text||''); const s=n(raw);
    let start=null,end=null,precision='unknown';
    const month='(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)';
    let m;
    // du 4 mai 2026 au 31 mars 2027
    m=s.match(new RegExp(`(?:du|de)\\s+(\\d{1,2})\\s+${month}\\s+(20\\d{2})\\s+(?:au|a)\\s+(\\d{1,2})\\s+${month}\\s+(20\\d{2})`));
    if(m){ start=dateFromParts(m[1],m[2],m[3]); end=dateFromParts(m[4],m[5],m[6]); precision='day'; return {start,end,precision}; }
    // nuit du 26 au 27 août 2026
    m=s.match(new RegExp(`(?:nuit\\s+)?(?:du|de)\\s+(\\d{1,2})\\s+(?:au|a)\\s+(\\d{1,2})\\s+${month}\\s+(20\\d{2})`));
    if(m){ start=dateFromParts(m[1],m[3],m[4]); end=dateFromParts(m[2],m[3],m[4]); precision='day'; return {start,end,precision}; }
    // du 4 mai 2026 à juin 2027
    m=s.match(new RegExp(`(?:du|de)\\s+(\\d{1,2})\\s+${month}\\s+(20\\d{2})\\s+(?:au|a)\\s+${month}\\s+(20\\d{2})`));
    if(m){ start=dateFromParts(m[1],m[2],m[3]); end=monthBoundary(m[4],m[5],true); precision='month-end'; return {start,end,precision}; }
    // du 4 mai au 25 septembre 2026
    m=s.match(new RegExp(`(?:du|de)\\s+(\\d{1,2})\\s+${month}\\s+(?:au|a)\\s+(\\d{1,2})\\s+${month}\\s+(20\\d{2})`));
    if(m){ start=dateFromParts(m[1],m[2],m[5]); end=dateFromParts(m[3],m[4],m[5]); precision='day'; return {start,end,precision}; }
    // du 31 août au 19 septembre 2026 (same regex above)
    // du 1er juin à septembre 2026 / de début juin à octobre 2026
    m=s.match(new RegExp(`(?:du|de)\\s+(?:debut\\s+)?(\\d{1,2}|1er)?\\s*${month}\\s+(?:au|a)\\s+${month}\\s+(20\\d{2})`));
    if(m){ const d=m[1]&&/^\\d/.test(m[1])?parseInt(m[1],10):1; start=dateFromParts(d,m[2],m[4]); end=monthBoundary(m[3],m[4],true); precision='month-end'; return {start,end,precision}; }
    // à partir du 8 juin jusqu'en septembre 2026
    m=s.match(new RegExp(`(?:a partir du|a compter du)\\s+(\\d{1,2})\\s+${month}(?:\\s+(20\\d{2}))?.*?(?:jusqu[' ]?en|jusqu[' ]?a)\\s+${month}\\s+(20\\d{2})`));
    if(m){ const year=m[3]||m[5]; start=dateFromParts(m[1],m[2],year); end=monthBoundary(m[4],m[5],true); precision='month-end'; return {start,end,precision}; }
    // à partir du 17 août 2026 pour environ un mois
    m=s.match(new RegExp(`(?:a partir du|a compter du)\\s+(\\d{1,2})\\s+${month}\\s+(20\\d{2})`));
    if(m){ start=dateFromParts(m[1],m[2],m[3]); const oneMonth=/environ un mois|pour un mois/.test(s); end=oneMonth?new Date(start.getTime()+30*DAY):null; precision=oneMonth?'approx-month':'start-only'; return {start,end,precision}; }
    // jusqu'au 28 août 2026
    m=s.match(new RegExp(`(?:jusqu[' ]?au|jusqu[' ]?a)\\s+(\\d{1,2})\\s+${month}\\s+(20\\d{2})`));
    if(m){ end=dateFromParts(m[1],m[2],m[3]); precision='end-only'; return {start,end,precision}; }
    // jusqu'à août 2026
    m=s.match(new RegExp(`(?:jusqu[' ]?a|jusqu[' ]?en)\\s+${month}\\s+(20\\d{2})`));
    if(m){ end=monthBoundary(m[1],m[2],true); precision='end-month'; return {start,end,precision}; }
    // generic exact date in text
    const dates=[...s.matchAll(new RegExp(`(\\d{1,2})\\s+${month}\\s+(20\\d{2})`,'g'))];
    if(dates.length){ start=dateFromParts(dates[0][1],dates[0][2],dates[0][3]); if(dates.length>1) end=dateFromParts(dates[1][1],dates[1][2],dates[1][3]); precision=dates.length>1?'day':'single-date'; }
    return {start,end,precision};
  }

  function workSeverity(work){
    const t=n(`${work.place||''} ${work.text||''}`);
    let score=35; let reason='chantier signalé';
    const tests=[
      [/fermeture complete|route barree|circulation totalement coupee|axe principal.*fermeture/,95,'fermeture / route barrée'],
      [/deviation|deviation/,86,'déviation'],
      [/sens unique|alternat|circulation alternee/,78,'circulation contrainte'],
      [/stationnement.*supprime|places.*supprime/,72,'stationnement réduit'],
      [/circulation perturbee|circulation adaptee|perturbations de circulation/,62,'circulation perturbée'],
      [/travaux|chantier|amenagement|reseaux|inspire/,48,'travaux / aménagement']
    ];
    for(const [re,s,r] of tests) if(re.test(t) && s>score){score=s;reason=r;}
    if(/principalement de nuit|entre 21h|de nuit/.test(t)) score=Math.max(20,Math.round(score*0.55));
    return {score,reason};
  }

  function normalizeWork(w){
    const explicitStart=parseIso(w.start||w.start_date||w.date_debut);
    const explicitEnd=parseIso(w.end||w.end_date||w.date_fin||(!w.active?w.observed_end:null));
    const inferred=extractDatesFromText(`${w.text||''} ${w.place||''}`);
    const sev=workSeverity(w);
    return {...w,startDate:explicitStart||inferred.start,endDate:explicitEnd||inferred.end,datePrecision:(explicitStart||explicitEnd)?'structured':inferred.precision,severity:sev.score,severityReason:sev.reason,sourceTrust:w.source_type==='clermont_api'?0.95:w.source_type==='official_page'?0.82:0.65};
  }

  function overlaps(work,window){
    if(!window) return false;
    const s=work.startDate, e=work.endDate;
    if(s&&e) return s<=window.end && e>=window.start;
    if(s) return s<=window.end && U().daysBetween(s,window.end)<=180;
    if(e) return e>=window.start && U().daysBetween(window.start,e)<=180;
    return true; // current official context without machine-readable date: weak compatibility only
  }

  function nearestDays(date, work){
    if(!date) return null;
    const candidates=[work.startDate,work.endDate].filter(Boolean).map(d=>Math.abs(U().daysBetween(d,date)));
    return candidates.length?Math.min(...candidates):null;
  }

  function eventTimingScore(work, targetDate, currentWindow){
    if(!targetDate){ return overlaps(work,currentWindow)?45:0; }
    const d=nearestDays(targetDate,work);
    if(d===null) return overlaps(work,currentWindow)?35:0;
    if(d<=3) return 100; if(d<=7) return 90; if(d<=14) return 76; if(d<=30) return 55; if(overlaps(work,currentWindow)) return 40; return 0;
  }

  function aggregateTx(txs,metric='ca'){
    const ca=sum(txs,x=>x.ttc), margin=sum(txs,x=>x.margin);
    return {ca,margin,visits:txs.length,clients:new Set(txs.map(x=>x.clientCode).filter(Boolean)).size};
  }
  function aggregateLines(lines,metric='ca'){
    return {ca:sum(lines,x=>x.saleTTC),margin:sum(lines,x=>x.margin),visits:new Set(lines.map(x=>x.transactionKey)).size,clients:new Set(lines.map(x=>x.clientCode).filter(Boolean)).size};
  }

  function weekdayFromFinding(f){
    const title=n(f.title); for(let i=0;i<WEEKDAYS.length;i++) if(title.startsWith(n(WEEKDAYS[i]))) return i; return null;
  }

  function scopeForFinding(model,f,windows){
    const cur=windows.current, prev=windows.previous;
    const base={kind:'transactions',metric:f.category==='margin'?'margin':'ca',filterLabel:'ensemble du magasin',current:[],previous:[]};
    let txFilter=()=>true, lineFilter=()=>true, useLines=false;
    const entity=(f.entities||[])[0];
    if(f.category==='rayon' && entity?.key){ useLines=true; lineFilter=l=>(l.effectiveRayon||'NON CLASSE')===entity.key; base.filterLabel=`rayon ${entity.label||entity.key}`; }
    else if(f.category==='product' && entity?.key){ useLines=true; lineFilter=l=>l.articleCode===entity.key; base.filterLabel=`produit ${entity.label||entity.key}`; }
    else if(f.category==='family'){
      useLines=true; const label=String(f.title||'').split(':')[0]; const parts=label.split('·').map(x=>x.trim());
      if(parts.length>=2){ lineFilter=l=>(l.effectiveRayon||'Non classé')===parts[0] && (l.effectiveFamille||'Non classée')===parts[1]; base.filterLabel=`famille ${label}`; }
    }
    else if(f.category==='returns'){ useLines=true; lineFilter=l=>l.isReturn||l.qty<0; base.filterLabel='retours'; }
    else if(f.category==='vendor'){
      const vendor=String(f.title||'').replace(/^Contribution brute vendeur\s*:\s*/i,'').replace(/\s+[+-].*$/,'').trim(); txFilter=t=>(t.vendor||'')===vendor; base.filterLabel=`tickets ${vendor}`;
    }
    else if(f.category==='traffic'){
      const wd=weekdayFromFinding(f); if(wd!==null){txFilter=t=>t.date?.getDay()===wd;base.filterLabel=WEEKDAYS[wd];}
    }
    else if(f.id==='high-risk-customers'){
      const codes=new Set(model.customers.filter(c=>c.risk?.key==='high').map(c=>c.client.codeClient)); txFilter=t=>codes.has(t.clientCode);base.filterLabel='clients à risque élevé';
    }
    else if(f.id==='customer-movement'){
      const codes=model.intelligence?.metrics?.movement?.absentCodes || new Set(); txFilter=t=>codes.has(t.clientCode);base.filterLabel='clients présents avant et absents récemment';
    }
    if(useLines){
      base.kind='lines'; base.current=model.sales.filter(l=>U().inRange(l.date,cur.start,cur.end)&&lineFilter(l)); base.previous=model.sales.filter(l=>U().inRange(l.date,prev.start,prev.end)&&lineFilter(l));
    } else {
      base.current=model.transactions.filter(t=>U().inRange(t.date,cur.start,cur.end)&&txFilter(t)); base.previous=model.transactions.filter(t=>U().inRange(t.date,prev.start,prev.end)&&txFilter(t));
    }
    return base;
  }

  function geoDeltas(scope){
    const cur=U().groupBy(scope.current,x=>x.geo?.zone||'Zone inconnue');
    const prev=U().groupBy(scope.previous,x=>x.geo?.zone||'Zone inconnue');
    const keys=new Set([...cur.keys(),...prev.keys()]); const rows=[];
    for(const zone of keys){
      if(zone==='Zone inconnue') continue;
      const a=scope.kind==='lines'?aggregateLines(cur.get(zone)||[]):aggregateTx(cur.get(zone)||[]);
      const b=scope.kind==='lines'?aggregateLines(prev.get(zone)||[]):aggregateTx(prev.get(zone)||[]);
      const av=scope.metric==='margin'?a.margin:a.ca, bv=scope.metric==='margin'?b.margin:b.ca;
      rows.push({zone,current:a,previous:b,delta:av-bv,trend:pct(av,bv),currentValue:av,previousValue:bv});
    }
    rows.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)); return rows;
  }

  function restDelta(model, zoneName, windows, metric='ca'){
    const select=(w)=>model.transactions.filter(t=>U().inRange(t.date,w.start,w.end)&&t.geo?.zone!==zoneName);
    const a=aggregateTx(select(windows.current)),b=aggregateTx(select(windows.previous));
    const av=metric==='margin'?a.margin:a.ca,bv=metric==='margin'?b.margin:b.ca; return pct(av,bv);
  }

  function geoSignal(model,scope,windows,direction){
    const rows=geoDeltas(scope);
    const relevant=rows.filter(r=>direction<0?r.delta<0:r.delta>0);
    const totalAbs=relevant.reduce((s,r)=>s+Math.abs(r.delta),0)||1;
    const top=relevant.slice(0,3).map(r=>{
      const z=model.geoIntelligence?.zones?.find(x=>x.name===r.zone);
      const rest=restDelta(model,r.zone,windows,scope.metric);
      return {...r,share:Math.abs(r.delta)/totalAbs,geo:z||null,restTrend:rest,excess:r.trend!==null&&rest!==null?r.trend-rest:null,worksSector:z?.worksSector||null};
    });
    return {rows,top,concentration:top[0]?.share||0};
  }

  function recentRainShift(ctx,windows){
    const weather=ctx?.weather||[]; if(!weather.length) return null;
    const avgFor=w=>{const rows=weather.filter(x=>{const d=parseIso(x.date);return d&&U().inRange(d,w.start,w.end)});return rows.length?sum(rows,x=>x.precipitation_mm)/rows.length:null;};
    const a=avgFor(windows.current),b=avgFor(windows.previous); if(a===null||b===null)return null;
    return {current:a,previous:b,delta:a-b};
  }

  function historyMetricShift(model,windows,key){
    const rows=model.publicContext?.history||[];
    const values=w=>rows.filter(x=>{const d=parseIso(x.generated_at);return d&&U().inRange(d,w.start,w.end)}).map(x=>Number(x[key])).filter(Number.isFinite);
    const a=values(windows.current),b=values(windows.previous);if(!a.length||!b.length)return null;
    const ma=U().mean(a),mb=U().mean(b);return {current:ma,previous:mb,delta:ma-mb,samplesCurrent:a.length,samplesPrevious:b.length};
  }
  function agendaShift(model,windows){
    const rows=[...(model.publicContext?.agenda_history||[]),...(model.publicContext?.agenda||[])];const seen=new Set();
    const count=w=>{let c=0;for(const e of rows){const k=e.event_id||`${e.title}|${e.start}|${e.place}`;if(seen.has(`${k}|${w.start}`))continue;const d=parseIso(e.start);if(d&&U().inRange(d,w.start,w.end)){seen.add(`${k}|${w.start}`);c++;}}return c;};
    const current=count(windows.current),previous=count(windows.previous);return {current,previous,delta:current-previous};
  }
  function directionMatches(observedDirection, signalDelta, correlation){
    if(!Number.isFinite(Number(signalDelta)) || !Number.isFinite(Number(correlation)) || Number(correlation)===0) return false;
    const predicted=Math.sign(Number(signalDelta)*Number(correlation));
    return predicted===Math.sign(observedDirection);
  }

  function competingSignals(model,f,scope,windows,direction){
    const out=[];
    const h=n((f.hypotheses||[]).join(' '));

    // Causes métier : on ne transforme pas un simple indice en certitude.
    // Une migration réellement observée entre références est plus solide qu'un stock faible aujourd'hui.
    const migration=(f.hypotheses||[]).find(x=>/acheteurs precedents ont achete une autre reference|migration possible/.test(n(x)));
    if(migration) out.push({key:'migration',label:'Clients partis vers une autre référence',strength:82,evidence:migration});
    if(/prix|prix unitaire/.test(h)) out.push({key:'price',label:'Hausse de prix associée à moins de ventes',strength:64,evidence:(f.hypotheses||[]).find(x=>/prix/.test(n(x)))||'Le prix moyen a augmenté pendant que les quantités reculaient.'});
    if(/stock|rupture/.test(h)||f.category==='stock') out.push({key:'stock',label:'Stock à vérifier',strength:56,evidence:(f.hypotheses||[]).find(x=>/stock|rupture/.test(n(x)))||'Le niveau de stock actuel mérite un contrôle, sans preuve de rupture sur toute la période.'});
    if(f.category==='margin'){const d=model.intelligence?.findings?.find(x=>x.id==='discount-shift'); if(d) out.push({key:'discount',label:'Remises plus fortes',strength:72,evidence:d.summary});}
    if(f.category==='calendar'||f.id==='calendar-mix') out.push({key:'calendar',label:'Effet vacances / calendrier',strength:68,evidence:'Les périodes comparées ne contiennent pas le même nombre de jours de vacances scolaires et l’historique montre un comportement différent.'});

    // Les facteurs extérieurs ne peuvent expliquer directement qu'un mouvement global de trafic/zone.
    // Ils ne sont jamais proposés comme cause directe d'un produit, d'un vendeur ou d'un client isolé.
    const externalAllowed=new Set(['turnover','traffic','geo','anomaly']).has(f.category);
    if(!externalAllowed) return out.sort((a,b)=>b.strength-a.strength);

    const rain=recentRainShift(model.publicContext,windows);
    const corr=model.contextCorrelation?.weather?.rainVisitsCorrelation;
    if(rain&&corr!==null&&Math.abs(corr)>=0.25&&Math.abs(rain.delta)>=1.5&&directionMatches(direction,rain.delta,corr)) {
      out.push({key:'weather',label:'Météo défavorable',strength:clamp(52+Math.abs(corr)*45,52,78),evidence:`La météo a nettement changé entre les deux périodes et l’historique du magasin montre que ce type de changement va habituellement avec une variation des visites dans le même sens.`});
    }

    const parking=historyMetricShift(model,windows,'parking_avg_occupancy_pct');
    const pc=model.contextCorrelation?.urban?.history?.parking_avg_occupancy_pct?.visitsCorrelation;
    if(parking&&Math.abs(parking.delta)>=5&&pc!==null&&pc!==undefined&&Math.abs(pc)>=0.25&&directionMatches(direction,parking.delta,pc)) {
      out.push({key:'parking',label:'Stationnement plus difficile',strength:clamp(56+Math.abs(pc)*30+Math.min(12,Math.abs(parking.delta)/2),56,82),evidence:'Les conditions de stationnement ont changé au même moment et l’historique du magasin montre qu’elles évoluent habituellement avec la fréquentation.'});
    }

    const t2c=historyMetricShift(model,windows,'t2c_avg_delay_seconds');
    const tc=model.contextCorrelation?.urban?.history?.t2c_avg_delay_seconds?.visitsCorrelation;
    if(t2c&&Math.abs(t2c.delta)>=60&&tc!==null&&tc!==undefined&&Math.abs(tc)>=0.25&&directionMatches(direction,t2c.delta,tc)) {
      out.push({key:'t2c',label:'Perturbations T2C',strength:clamp(58+Math.abs(tc)*30+Math.min(12,Math.abs(t2c.delta)/60),58,84),evidence:`Les perturbations T2C ont nettement changé au même moment et l’historique du magasin montre qu’elles évoluent habituellement avec la fréquentation.`});
    }

    // L'agenda, C.vélo et les comptages urbains restent des variables de contexte/audit.
    // Ils ne deviennent plus automatiquement une cause dans le cockpit faute de preuve événement par événement.
    return out.sort((a,b)=>b.strength-a.strength);
  }

  const ZONE_TERMS={
    'brezet / est commercial':['brezet','ernest cristal','jules verne','gutenberg','georges besse','newton','kepler','ampere','lavoisier'],
    'montferrand / republique':['montferrand','republique','carmes','clos four','salengro'],
    'estaing / michelin':['estaing','michelin','auger','union sovietique'],
    'la plaine / nord est':['la plaine','vergn','croix neyrat','chanturgue','flamina'],
    'pardieu / oradou':['pardieu','oradou'],
    'centre / jaude':['jaude','blatin','ballainvilliers','vercingetorix','desaix','delille','fontgieve','lagarlaye','malfreyt'],
    'est metropole':['aulnat','lempdes','pont du chateau','dalet','dallet','mur sur allier','martres','lussat','malintrat'],
    'nord metropole':['gerzat','cebazat','blanzat','chateaugay','nohanent','sayat'],
    'sud metropole':['aubiere','beaumont','ceyrat','cournon','le cendre','romagnat','perignat'],
    'ouest metropole':['chamalieres','durtol','orcines','royat','saint genes'],
    'clermont est / nord est 63100':['brezet','montferrand','estaing','la plaine','carmes','republique','michelin'],
    'clermont centre / sud 63000':['jaude','blatin','lagarlaye','oradou','pardieu','delille']
  };
  function zoneAffinity(zoneName,work){
    const zn=n(zoneName); const text=n(`${work.place||''} ${work.text||''}`); const terms=ZONE_TERMS[zn]||[];
    if(terms.some(t=>text.includes(t))) return 100;
    if(zn.includes('metropole')) return 58;
    if(zn.includes('clermont')||zn.includes('/') ) return 32;
    return 45;
  }

  function eventImpactAround(model, zone, work, metric='ca', direction=-1){
    const pivot=direction<0?work.startDate:work.endDate; if(!pivot) return null;
    const tx=model.transactions.filter(t=>t.geo?.zone===zone&&t.date);
    const days=14;
    const before={start:U().startOfDay(U().addDays(pivot,-days)),end:U().endOfDay(U().addDays(pivot,-1))};
    const after={start:U().startOfDay(pivot),end:U().endOfDay(U().addDays(pivot,days-1))};
    const a=aggregateTx(tx.filter(t=>U().inRange(t.date,after.start,after.end))),b=aggregateTx(tx.filter(t=>U().inRange(t.date,before.start,before.end)));
    if(a.visits<3||b.visits<3) return null;
    const av=metric==='margin'?a.margin:a.ca,bv=metric==='margin'?b.margin:b.ca;
    return {before:b,after:a,delta:pct(av,bv),visitDelta:pct(a.visits,b.visits),pivot,days};
  }

  function findWorks(model, zoneSignal, targetDate, windows, direction){
    const raw=[...(model.publicContext?.works_history||[]),...(model.publicContext?.works||[])];
    const seen=new Set(); const all=[];
    for(const item of raw){const k=item?.event_id||`${n(item?.sector)}|${n(item?.place)}|${n(item?.text).slice(0,180)}`;if(seen.has(k))continue;seen.add(k);all.push(normalizeWork(item));}
    if(!zoneSignal?.worksSector||zoneSignal.worksSector==='Hors secteurs Métropole') return [];
    return all.filter(w=>n(w.sector)===n(zoneSignal.worksSector) && (overlaps(w,windows.current)||nearestDays(targetDate,w)!==null))
      .map(w=>{
        const timing=eventTimingScore(w,targetDate,windows.current);
        const around=eventImpactAround(model,zoneSignal.zone,w,'ca',direction);
        const behavior=around?.delta===null||around?.delta===undefined?0:(direction<0?-around.delta:around.delta);
        const behaviorScore=around?clamp(50+behavior*120,15,100):35;
        const affinity=zoneAffinity(zoneSignal.zone,w);
        const distance=Number.isFinite(Number(w.distanceMeters))?Number(w.distanceMeters):null;
        const proximity=distance===null?45:distance<=100?100:distance<=500?86:distance<=2000?58:18;
        const score=clamp(timing*0.25+w.severity*0.18+w.sourceTrust*100*0.10+behaviorScore*0.20+affinity*0.12+proximity*0.15,0,100);
        return {...w,timingScore:timing,zoneAffinity:affinity,proximityScore:proximity,around,compatibility:Math.round(score)};
      }).sort((a,b)=>b.compatibility-a.compatibility).slice(0,6);
  }

  function targetDateForFinding(model,f,zoneSignal){
    if(zoneSignal?.geo?.changePoint?.date) return zoneSignal.geo.changePoint.date;
    const anomaly=f.id?.startsWith('anomaly-')?parseIso(f.id.replace('anomaly-','')):null;
    return anomaly||model.intelligence?.referenceDate||model.range?.max||null;
  }

  function workProofReady(work,direction){
    // Une fiche travaux n'est montrée que si Power dispose d'une vraie chaîne de preuve :
    // date exploitable + source officielle + soit un changement de visites autour du chantier,
    // soit une restriction d'accès forte et très proche de la zone concernée.
    const dated=!!(work.startDate||work.endDate) && Number(work.timingScore||0)>=76;
    const trusted=Number(work.sourceTrust||0)>=0.80;
    const vd=work.around?.visitDelta;
    const observed=Number.isFinite(Number(vd)) && (direction<0 ? Number(vd)<=-0.08 : Number(vd)>=0.08);
    const accessRestriction=Number(work.severity||0)>=78 && Number(work.proximityScore||0)>=86 && Number(work.zoneAffinity||0)>=70;
    return dated && trusted && (observed || accessRestriction);
  }

  function testFinding(model,f){
    const empty=(tested,status,label,summary,extra={})=>({tested,status,score:0,label,summary,chain:[],works:[],alternatives:[],retainedCauses:[],rejectedCauses:[],...extra});
    if(!f||f.category==='quality') return empty(false,'not-applicable','Non applicable','Contrôle causal non applicable à un diagnostic de qualité des données.');
    const windows=model.intelligence?.windows||model.geoIntelligence?.windows;
    if(!windows?.current||!windows?.previous) return empty(false,'unavailable','Indisponible','Historique insuffisant pour tester les causes.');
    const direction=(f.impactAmount||0)<0?-1:(f.level==='positive'||f.level==='opportunity'?1:-1);
    const scope=scopeForFinding(model,f,windows);
    if(scope.current.length+scope.previous.length<6) return empty(true,'insufficient','Échantillon insuffisant','Le segment ne fournit pas assez d’observations comparables.',{scope:scope.filterLabel});

    const geo=geoSignal(model,scope,windows,direction);
    const top=geo.top[0];
    const targetDate=targetDateForFinding(model,f,top);
    const externalEligible=new Set(['turnover','traffic','geo','anomaly']).has(f.category);
    const geoEligible=!!top && geo.concentration>=0.38 && (top.excess===null||top.excess===undefined||Math.abs(top.excess)>=0.08);
    const works=(externalEligible&&geoEligible)?findWorks(model,top,targetDate,windows,direction).filter(w=>direction<0||!!w.endDate):[];
    const alternatives=competingSignals(model,f,scope,windows,direction);

    const candidates=[];
    for(const w of works){
      candidates.push({
        key:`work:${w.event_id||w.place||w.sector}`,
        type:'works',
        label:'Travaux / accessibilité',
        strength:Number(w.compatibility||0),
        evidence:w.text||w.place||w.sector||'Travaux publics',
        work:w,
        source:w.source||'',
        sourceLabel:w.sourceLabel||'Source publique',
        proofReady:workProofReady(w,direction)
      });
    }
    for(const a of alternatives) candidates.push({...a,type:a.key==='stock'||a.key==='price'||a.key==='calendar'||a.key==='discount'?'business':'external'});

    // POWER RULE: une cause n'est visible que si son propre signal franchit le seuil.
    // Les causes testées mais faibles restent dans l'audit et ne polluent jamais le diagnostic.
    const retainedCauses=candidates.filter(c=>{
      if(c.type==='works') return c.strength>=72 && c.proofReady===true;
      return c.strength >= (c.key==='migration'?76:70);
    }).sort((a,b)=>b.strength-a.strength);
    const rejectedCauses=candidates.filter(c=>!retainedCauses.includes(c)).sort((a,b)=>b.strength-a.strength);
    const primary=retainedCauses[0]||null;

    const concentrationScore=clamp((geo.concentration-0.2)*125,0,100);
    const excessScore=top?.excess===null||top?.excess===undefined?25:clamp((direction<0?-top.excess:top.excess)*250,0,100);
    const sample=Math.min(100,((top?.current?.visits||0)+(top?.previous?.visits||0))*2.5);
    const source=model.contextCorrelation?.source;
    const freshness=source?.stale?55:source?.apiOk?100:75;
    const causeStrength=primary?.strength||0;
    let score=clamp(concentrationScore*0.20+excessScore*0.18+causeStrength*0.46+sample*0.08+freshness*0.08,0,100);
    if(!primary) score=Math.min(score,34);
    if(top?.geo?.impactScore>=70&&primary) score=clamp(score+5,0,100);

    const status=primary && score>=78?'strong':primary && score>=64?'moderate':'none';
    const label=status==='strong'?'Cause très probable':status==='moderate'?'Cause probable':'Cause non identifiée';
    const chain=[];
    if(primary){
      chain.push(`Power a d’abord confirmé le problème : ${f.title}.`);
      if(top) chain.push(`Le changement est surtout visible chez les clients de ${top.zone}.`);
      if(primary.type==='works' && primary.work){
        const distance=Number.isFinite(Number(primary.work.distanceMeters))?` à environ ${Math.round(primary.work.distanceMeters)} m du commerce`:'';
        chain.push(`Un chantier officiel${distance} se déroule au même moment et sur le secteur concerné.`);
        if(primary.work.around?.visitDelta!==null&&primary.work.around?.visitDelta!==undefined){
          const vd=primary.work.around.visitDelta;
          chain.push(`Autour du début du chantier, les visites de cette zone ont ${vd<0?'baissé':'augmenté'} d'environ ${Math.abs(vd*100).toFixed(0)} %.`);
        }
      } else {
        chain.push(primary.evidence);
      }
    }

    const summary=primary
      ? `${status==='strong'?'Power a identifié une explication très solide':'Power a identifié une explication probable'} : « ${primary.label} ». Ouvre « Voir les faits » pour vérifier les éléments utilisés.`
      : `Power voit bien le problème, mais aucune cause n’est assez solide pour être affichée. Il préfère dire « je ne sais pas encore » plutôt que proposer une mauvaise explication.`;

    return {
      tested:true,status,score:Math.round(score),label,summary,scope:scope.filterLabel,targetDate,
      topZone:top?.zone||null,concentration:geo.concentration,zoneExcess:top?.excess??null,chain,
      works:retainedCauses.filter(c=>c.type==='works').map(c=>c.work),
      alternatives:retainedCauses.filter(c=>c.type!=='works'),
      retainedCauses,rejectedCauses,
      dominantExternal:primary,
      sourceFreshness:freshness,
      audit:{testedCandidates:candidates.length,rejected:rejectedCauses.map(c=>({label:c.label,strength:Math.round(c.strength),evidence:c.evidence}))}
    };
  }

  function analyze(model,intel){
    const findings=intel?.findings||[]; const results=[];
    for(const f of findings){
      const causal=testFinding(model,f); f.causal=causal;
      results.push({findingId:f.id,title:f.title,category:f.category,level:f.level,impactAmount:f.impactAmount||0,...causal});
    }
    const tested=results.filter(x=>x.tested&&x.status!=='insufficient');
    const strong=tested.filter(x=>x.status==='strong');
    const moderate=tested.filter(x=>x.status==='moderate');
    const visible=[...strong,...moderate];
    const explainedAmount=visible.reduce((s,x)=>s+Math.abs(x.impactAmount||0),0);
    const top=visible.sort((a,b)=>b.score-a.score||Math.abs(b.impactAmount)-Math.abs(a.impactAmount));
    const actions=top.slice(0,10).map(x=>{
      const cause=x.retainedCauses?.[0];
      const finding=findings.find(f=>f.id===x.findingId);
      return {
        action:finding?.actions?.[0]||`Traiter en priorité « ${x.title} » en suivant ${cause?.label||'la cause retenue'}.`,
        sourceTitle:`${cause?.label||'Cause retenue'} · ${x.title}`,
        confidence:x.score,level:x.status==='strong'?'warning':'info',external:false
      };
    });
    const byWork=new Map();
    for(const r of top){
      for(const c of (r.retainedCauses||[]).filter(x=>x.type==='works')){
        const w=c.work; const key=`${w.event_id||''}|${w.sector||''}|${w.place||''}|${w.text||''}`;
        if(!byWork.has(key))byWork.set(key,{work:w,diagnostics:[],maxScore:0});
        const row=byWork.get(key); row.diagnostics.push(r.title); row.maxScore=Math.max(row.maxScore,r.score);
      }
    }
    const events=[...byWork.values()].sort((a,b)=>b.maxScore-a.maxScore).slice(0,12);
    const audit={
      totalFindings:findings.filter(f=>f.category!=='quality').length,
      tested:tested.length,
      withCause:visible.length,
      withoutCause:tested.filter(x=>x.status==='none').length,
      rejectedCandidates:tested.reduce((s,x)=>s+(x.rejectedCauses?.length||0),0)
    };
    return {generatedAt:new Date(),results,tested:tested.length,strong:strong.length,moderate:moderate.length,explainedAmount,top,events,actions,audit,coverage:findings.length?tested.length/findings.filter(f=>f.category!=='quality').length:0};
  }

  function apply(model){
    const c=analyze(model,model.intelligence); model.causalContext=c;
    const intel=model.intelligence;
    if(intel){
      for(const f of intel.findings||[]){ if(['strong','moderate'].includes(f.causal?.status)) f.score=(f.score||0)+f.causal.score/8; }
      intel.findings.sort((a,b)=>(b.score||0)-(a.score||0));
      const seen=new Set(); const merged=[];
      for(const a of [...(c.actions||[]),...(intel.actions||[])]){ const k=n(a.action); if(!k||seen.has(k))continue;seen.add(k);merged.push(a); }
      intel.actions=merged.slice(0,30);
      if(c.strong||c.moderate){
        const line=`Moteur causal : ${c.strong+c.moderate} diagnostic(s) disposent d’une cause suffisamment étayée. Les hypothèses faibles sont conservées uniquement dans l’audit.`;
        intel.brief=[intel.brief?.[0]||'Analyse automatique terminée.',line,...(intel.brief||[]).slice(1)];
      }
    }
    return c;
  }

  function answer(model){
    const c=model.causalContext;
    if(!c) return {title:'Causes indisponibles',intro:'Le moteur causal n’a pas encore été exécuté.',items:[],extra:[]};
    return {
      title:'Causes retenues',
      intro:`${c.strong+c.moderate} problème(s) disposent actuellement d’une cause assez solide pour être expliquée simplement. Les pistes faibles restent cachées.`,
      items:c.top.slice(0,8).map(x=>({
        title:`${x.retainedCauses?.[0]?.label||x.label} · ${x.title}`,
        text:x.summary,
        bullets:x.chain.slice(1,6),
        confidence:x.status==='strong'?'Très probable':'Probable',quality:'cause retenue'
      })),
      extra:c.events.slice(0,5).map(e=>`${e.work.place||e.work.sector} : source officielle reliée à ${e.diagnostics.length} problème(s).`)
    };
  }

  return {analyze,apply,testFinding,normalizeWork,answer};
})();
