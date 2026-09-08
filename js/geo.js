window.AU = window.AU || {};

AU.geo = (() => {
  const U = () => AU.util;
  const DAY = 86400000;

  const WORKS = Object.freeze({
    'NORD & EST': ['AULNAT','BLANZAT','CEBAZAT','CHATEAUGAY','GERZAT','LEMPDES','NOHANENT','PONT DU CHATEAU'],
    'OUEST': ['CHAMALIERES','DURTOL','ORCINES','ROYAT','SAINT GENES CHAMPANELLE'],
    'SUD': ['AUBIERE','BEAUMONT','CEYRAT','COURNON D AUVERGNE','LE CENDRE','PERIGNAT LES SARLIEVE','ROMAGNAT']
  });

  const EAST_METRO = new Set(['AULNAT','LEMPDES','PONT DU CHATEAU','DALLET','MUR SUR ALLIER','LES MARTRES D ARTIERE','MARTRES D ARTIERE','LUSSAT','MALINTRAT','VERTAIZON','CHAURIAT','BOUZEL']);
  const NORTH = new Set(['GERZAT','CEBAZAT','BLANZAT','CHATEAUGAY','NOHANENT','SAYAT']);
  const SOUTH = new Set(['AUBIERE','BEAUMONT','CEYRAT','COURNON D AUVERGNE','LE CENDRE','PERIGNAT LES SARLIEVE','ROMAGNAT']);
  const WEST = new Set(['CHAMALIERES','DURTOL','ORCINES','ROYAT','SAINT GENES CHAMPANELLE']);

  const MICRO = [
    {name:'Brézet / Est commercial', terms:['BREZET','ERNEST CRISTAL','JULES VERNE','GUTENBERG','GEORGES BESSE','NEWTON','KEPLER','AMPERE','LAVOISIER']},
    {name:'Montferrand / République', terms:['MONTFERRAND','ROGER SALENGRO','REPUBLIQUE','CLOS FOUR','CARMES']},
    {name:'Estaing / Michelin', terms:['ESTAING','AUGER','UNION SOVIETIQUE','MICHELIN']},
    {name:'La Plaine / Nord-Est', terms:['LA PLAINE','VERGNES','CROIX NEYRAT','CHANTURGUE','FLAMINA']},
    {name:'Pardieu / Oradou', terms:['PARDIEU','ORADOU','COURNON']},
    {name:'Centre / Jaude', terms:['JAUDE','BLATIN','BALLAINVILLIERS','VERCINGETORIX','DESAIX','DELILLE','FONTGIEVE']}
  ];

  function n(v){ return U().normText(v || ''); }
  function cityN(v){ return n(v).replace(/[-']/g,' ').replace(/\s+/g,' ').trim(); }
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function pc(v){ return String(v || '').replace(/\D/g,'').slice(0,5); }

  function worksSector(city){
    const c=cityN(city);
    if (c.includes('CLERMONT FERRAND')) return 'Clermont-Centre';
    for (const [sector,cities] of Object.entries(WORKS)) if (cities.includes(c)) return sector==='NORD & EST'?'Nord & Est':sector[0]+sector.slice(1).toLowerCase();
    return 'Hors secteurs Métropole';
  }

  function clermontMicro(address){
    const a=n(address);
    if (!a) return null;
    for (const m of MICRO) if (m.terms.some(t=>a.includes(t))) return m.name;
    return null;
  }

  function classify(raw={}){
    const city=cityN(raw.city || raw.clientCity || raw.Ville);
    const postal=pc(raw.postal || raw.clientPostal || raw['Code postal']);
    const address=raw.address1 || raw.address || raw['Adresse 1'] || '';
    let zone='Autre / hors métropole', group='Autre', micro=null, confidence=55, source='commune';
    if (city.includes('CLERMONT FERRAND')) {
      micro=clermontMicro(address);
      if (micro) { zone=micro; group=(micro==='Centre / Jaude')?'Centre':'Est'; confidence=88; source='adresse + commune'; }
      else if (postal==='63100') { zone='Clermont Est / Nord-Est (63100)'; group='Est'; confidence=78; source='code postal + commune'; }
      else if (postal==='63000') { zone='Clermont Centre / Sud (63000)'; group='Centre'; confidence=72; source='code postal + commune'; }
      else { zone='Clermont-Ferrand'; group='Centre'; confidence=62; source='commune'; }
    } else if (EAST_METRO.has(city)) { zone='Est métropole'; group='Est'; confidence=95; }
    else if (NORTH.has(city)) { zone='Nord métropole'; group='Nord'; confidence=95; }
    else if (SOUTH.has(city)) { zone='Sud métropole'; group='Sud'; confidence=95; }
    else if (WEST.has(city)) { zone='Ouest métropole'; group='Ouest'; confidence=95; }
    else if (postal.startsWith('63')) { zone='Puy-de-Dôme hors zone proche'; group='Autre 63'; confidence=68; source='code postal'; }
    return {zone, group, micro, worksSector:worksSector(city), city: raw.city || raw.clientCity || raw.Ville || '', postal, confidence, source};
  }

  function referenceBoundary(model){
    const max=model.range?.max; if(!max)return {referenceDate:null,partialLastDay:false};
    const by=U().groupBy(model.transactions.filter(t=>t.date),t=>t.dateKey);
    const lastKey=U().dateKey(max); const current=by.get(lastKey)||[];
    const lastMinute=current.length?Math.max(...current.map(t=>t.date.getHours()*60+t.date.getMinutes())):null;
    const history=[];
    for(const [k,rows] of by){if(k===lastKey)continue;const d=rows[0]?.date;if(!d||U().daysBetween(d,max)>60)continue;history.push(Math.max(...rows.map(t=>t.date.getHours()*60+t.date.getMinutes())));}
    const typical=U().median(history.slice(-35));
    const partial=lastMinute!==null&&typical!==null&&history.length>=10&&lastMinute<typical-120;
    return {referenceDate:partial?U().endOfDay(U().addDays(U().startOfDay(max),-1)):max,partialLastDay:partial,lastMinute,typicalLastMinute:typical};
  }

  function agg(txs){
    const ca=U().sum(txs.map(t=>t.ttc)), ht=U().sum(txs.map(t=>t.ht)), margin=U().sum(txs.map(t=>t.margin));
    const clients=new Set(txs.map(t=>t.clientCode).filter(Boolean));
    return {ca,ht,margin,visits:txs.length,clients:clients.size,avgBasket:txs.length?ca/txs.length:0,visitsPerClient:clients.size?txs.length/clients.size:0,marginRate:ht?margin/ht:null};
  }
  function pct(a,b){ return b ? (a-b)/Math.abs(b) : null; }
  function window(ref,days,offset=0){ const end=U().endOfDay(U().addDays(ref,-offset)); const start=U().startOfDay(U().addDays(ref,-offset-days+1)); return {start,end,days}; }

  function weeklySeries(txs, minDate, maxDate){
    if (!minDate||!maxDate) return [];
    const map=new Map();
    for(const t of txs){
      const d=t.date; if(!d) continue;
      const monday=U().startOfDay(U().addDays(d,-((d.getDay()+6)%7)));
      const k=U().dateKey(monday);
      if(!map.has(k)) map.set(k,{date:monday,ca:0,visits:0});
      const r=map.get(k); r.ca+=t.ttc; r.visits++;
    }
    return [...map.values()].sort((a,b)=>a.date-b.date);
  }

  function changePoint(series,key='ca'){
    if(series.length<8) return null;
    const vals=series.map(x=>Number(x[key])||0); const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
    const sse=a=>{const m=mean(a);return a.reduce((s,x)=>s+(x-m)*(x-m),0)};
    const total=sse(vals); if(total<=0) return null;
    let best=null;
    for(let i=4;i<=vals.length-4;i++){
      const left=vals.slice(0,i), right=vals.slice(i); const gain=1-(sse(left)+sse(right))/total;
      const lm=mean(left), rm=mean(right), delta=lm?pct(rm,lm):null;
      if(delta===null) continue;
      const candidate={index:i,date:series[i].date,before:lm,after:rm,delta,strength:gain};
      if(!best||candidate.strength>best.strength) best=candidate;
    }
    return best && best.strength>=0.12 && Math.abs(best.delta)>=0.08 ? best : null;
  }

  function forecast7(txs, ref){
    const byDay=U().groupBy(txs.filter(t=>t.date),t=>t.dateKey);
    const days=[...byDay.entries()].map(([key,rows])=>({date:U().startOfDay(rows[0].date),ca:U().sum(rows.map(t=>t.ttc)),visits:rows.length})).sort((a,b)=>a.date-b.date);
    let ca=0,visits=0,used=0; const detail=[];
    for(let off=1;off<=7;off++){
      const target=U().startOfDay(U().addDays(ref,off)); const dow=target.getDay();
      const hist=days.filter(d=>d.date<target&&d.date.getDay()===dow).slice(-8);
      const avgCa=hist.length?U().mean(hist.map(d=>d.ca)):0; const avgVisits=hist.length?U().mean(hist.map(d=>d.visits)):0;
      ca+=avgCa||0; visits+=avgVisits||0; used+=hist.length; detail.push({date:target,ca:avgCa||0,visits:avgVisits||0,samples:hist.length});
    }
    return {ca,visits,detail,confidence:Math.round(clamp(45+used/56*45,45,90))};
  }

  function distShift(txsA,txsB,keyFn,labels){
    const counts=(txs)=>{const o={}; for(const l of labels)o[l]=0; for(const t of txs){const k=keyFn(t);if(k in o)o[k]++;} const total=txs.length||1; return Object.fromEntries(labels.map(l=>[l,o[l]/total]));};
    const a=counts(txsA),b=counts(txsB); let best=null;
    for(const l of labels){const d=a[l]-b[l]; if(!best||Math.abs(d)>Math.abs(best.delta))best={label:l,current:a[l],previous:b[l],delta:d};}
    return best;
  }

  function analyze(model){
    const boundary=referenceBoundary(model); const ref=boundary.referenceDate; if(!ref) return {zones:[],groups:[],findings:[],series:{},coverage:null};
    const days=(U().daysBetween(model.range.min,ref)+1)>=60?30:Math.max(7,Math.floor((U().daysBetween(model.range.min,ref)+1)/2));
    const curW=window(ref,days,0), prevW=window(ref,days,days);

    const customerGeo=new Map();
    for(const c of model.customers){ c.geo=classify(c.client); customerGeo.set(c.client.codeClient,c.geo); }
    for(const t of model.transactions){ t.geo=t.clientCode&&customerGeo.get(t.clientCode)?customerGeo.get(t.clientCode):classify({city:t.clientCity,postal:t.clientPostal}); }
    for(const l of model.sales){ l.geo=l.clientCode&&customerGeo.get(l.clientCode)?customerGeo.get(l.clientCode):classify({city:l.clientCity,postal:l.clientPostal,address:l.clientAddress}); }

    const geoTx=model.transactions.filter(t=>t.geo && t.geo.group!=='Autre' && t.geo.group!=='Autre 63');
    const coveredTx=model.transactions.filter(t=>t.geo && t.geo.group!=='Autre');
    const coverage=model.transactions.length?coveredTx.length/model.transactions.length:0;
    const names=[...new Set(model.transactions.map(t=>t.geo?.zone).filter(Boolean))];

    const currentAll=model.transactions.filter(t=>U().inRange(t.date,curW.start,curW.end));
    const previousAll=model.transactions.filter(t=>U().inRange(t.date,prevW.start,prevW.end));
    const zones=[];
    for(const name of names){
      const all=model.transactions.filter(t=>t.geo?.zone===name);
      const cur=all.filter(t=>U().inRange(t.date,curW.start,curW.end));
      const prev=all.filter(t=>U().inRange(t.date,prevW.start,prevW.end));
      if(!cur.length&&!prev.length) continue;
      const A=agg(cur),B=agg(prev);
      const otherCur=currentAll.filter(t=>t.geo?.zone!==name), otherPrev=previousAll.filter(t=>t.geo?.zone!==name);
      const OA=agg(otherCur),OB=agg(otherPrev);
      const caDelta=pct(A.ca,B.ca), visitsDelta=pct(A.visits,B.visits), basketDelta=pct(A.avgBasket,B.avgBasket), clientsDelta=pct(A.clients,B.clients);
      const trafficEffect=(A.visits-B.visits)*B.avgBasket;
      const basketEffect=A.visits*(A.avgBasket-B.avgBasket);
      const driver=Math.abs(trafficEffect)>Math.abs(basketEffect)*1.35?'Fréquentation':Math.abs(basketEffect)>Math.abs(trafficEffect)*1.35?'Panier':'Mixte';
      const otherDelta=pct(OA.ca,OB.ca);
      const excess=caDelta!==null&&otherDelta!==null?caDelta-otherDelta:null;
      const expected=otherDelta!==null?B.ca*(1+otherDelta):B.ca;
      const gap=A.ca-expected;
      const weekly=weeklySeries(all,model.range.min,ref); const cp=changePoint(weekly,'ca'); const forecast=forecast7(all,ref);
      const zoneCustomers=model.customers.filter(c=>c.geo?.zone===name);
      const highRisk=zoneCustomers.filter(c=>c.risk?.key==='high');
      const atRisk=zoneCustomers.filter(c=>['watch','risk','high'].includes(c.risk?.key));
      const dueNext7=zoneCustomers.filter(c=>c.expectedNext&&c.expectedNext>=U().startOfDay(ref)&&c.expectedNext<=U().endOfDay(U().addDays(ref,7)));
      const histCA=U().sum(zoneCustomers.map(c=>c.totalSpend));
      const valueAtRisk=U().sum(highRisk.map(c=>c.estimatedMonthlyValue));
      const hourLabels=['08–11h','11–14h','14–17h','17–20h'];
      const hourKey=t=>{const h=t.date?.getHours();if(h>=8&&h<11)return'08–11h';if(h>=11&&h<14)return'11–14h';if(h>=14&&h<17)return'14–17h';return'17–20h';};
      const hourShift=cur.length>=15&&prev.length>=15?distShift(cur,prev,hourKey,hourLabels):null;
      const dayLabels=['Lun','Mar','Mer','Jeu','Ven','Sam']; const dayKey=t=>['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][t.date?.getDay()||0];
      const weekdayShift=cur.length>=15&&prev.length>=15?distShift(cur,prev,dayKey,dayLabels):null;
      const negativeExcess=Math.max(0,-(excess||0));
      const riskShare=zoneCustomers.length?highRisk.length/zoneCustomers.length:0;
      const volumeFactor=Math.min(1,(A.visits+B.visits)/40);
      const impactScore=Math.round(clamp((negativeExcess*220 + Math.max(0,-(visitsDelta||0))*90 + riskShare*35 + (cp?.strength||0)*20)*volumeFactor,0,100));
      const status=impactScore>=70?'Critique':impactScore>=45?'Fort':impactScore>=25?'À surveiller':'Stable';
      zones.push({name,group:cur[0]?.geo?.group||prev[0]?.geo?.group||'',worksSector:cur[0]?.geo?.worksSector||prev[0]?.geo?.worksSector||'',current:A,previous:B,caDelta,visitsDelta,basketDelta,clientsDelta,trafficEffect,basketEffect,driver,otherDelta,excess,expectedCA:expected,caGap:gap,changePoint:cp,highRisk:highRisk.length,atRisk:atRisk.length,dueNext7:dueNext7.length,valueAtRisk,historicalCA:histCA,impactScore,status,hourShift,weekdayShift,customers:zoneCustomers,series:weekly,forecast7:forecast});
    }
    zones.sort((a,b)=>b.impactScore-a.impactScore||b.current.ca-a.current.ca);

    const groupNames=[...new Set(model.transactions.map(t=>t.geo?.group).filter(Boolean))];
    const groups=groupNames.map(g=>{
      const tx=model.transactions.filter(t=>t.geo?.group===g); const cur=agg(tx.filter(t=>U().inRange(t.date,curW.start,curW.end))); const prev=agg(tx.filter(t=>U().inRange(t.date,prevW.start,prevW.end)));
      return {name:g,current:cur,previous:prev,caDelta:pct(cur.ca,prev.ca),visitsDelta:pct(cur.visits,prev.visits),basketDelta:pct(cur.avgBasket,prev.avgBasket),share:model.overview?.caTTC?U().sum(tx.map(t=>t.ttc))/model.overview.caTTC:0};
    }).sort((a,b)=>b.current.ca-a.current.ca);

    const findings=[];
    for(const z of zones.slice(0,8)){
      if(z.impactScore>=25){
        const actualDelta=(Number(z.current.ca)||0)-(Number(z.previous.ca)||0);
        const trafficMain=Math.abs(z.trafficEffect)>=Math.abs(z.basketEffect);
        const facts=[`${z.current.visits} visites actuellement contre ${z.previous.visits} auparavant.`,`CA : ${U().money(z.current.ca)} maintenant contre ${U().money(z.previous.ca)} auparavant.`,`${z.highRisk} client(s) habituel(s) de cette zone sont très en retard.`];
        if(z.changePoint) facts.push(`Le changement devient particulièrement visible autour du ${U().formatDate(z.changePoint.date)}.`);
        const visitsText=z.visitsDelta===null?'les visites ne sont pas comparables':`les visites ont ${z.visitsDelta<0?'baissé':'augmenté'} de ${Math.abs(z.visitsDelta*100).toFixed(1)} %`;
        const caText=z.caDelta===null?'le chiffre d’affaires n’est pas comparable':`le chiffre d’affaires a ${z.caDelta<0?'baissé':'augmenté'} de ${Math.abs(z.caDelta*100).toFixed(1)} %`;
        const mainDriver=trafficMain?(z.visitsDelta<0?'moins de passages en magasin':'un changement du nombre de passages'):(z.basketDelta<0?'un panier moyen plus faible':'un changement du panier moyen');
        const title=trafficMain&&Number(z.visitsDelta)<0?`Les clients de ${z.name} viennent moins qu’avant`:`Les clients de ${z.name} dépensent moins qu’avant`;
        const actions=trafficMain&&Number(z.visitsDelta)<0
          ? [`Voir en priorité les clients de ${z.name} qui ne sont pas revenus à leur rythme habituel.`,`Vérifier au prochain import si la baisse de visites continue dans cette zone.`]
          : [`Regarder quels rayons et produits ont le plus baissé chez les clients de ${z.name}.`,`Vérifier si le panier moyen de cette zone reste plus faible au prochain import.`];
        findings.push({id:`geo-${n(z.name).replace(/\s+/g,'-')}`,category:'geo',level:z.impactScore>=70?'critical':'warning',title,summary:`Dans cette zone, ${visitsText} et ${caText}. Le principal problème vient ${mainDriver.startsWith('un ')?'d’':'de '}${mainDriver}.`,explanation:`Power voit que cette zone se dégrade davantage que les autres. Il cherche ensuite une cause précise seulement si les données permettent de la défendre. Sinon, il indique simplement que la cause n’est pas identifiée.`,impactAmount:actualDelta<0?actualDelta:0,confidence:clamp(55+z.impactScore/2,55,94),quality:'estimate',facts,hypotheses:[],actions,entities:[z.name]});
      }
    }
    const positive=zones.filter(z=>z.caDelta!==null&&z.caDelta>0.12&&z.current.ca>300).sort((a,b)=>b.caDelta-a.caDelta)[0];
    if(positive) findings.push({id:'geo-opportunity',category:'geo',level:'opportunity',title:`Les clients de ${positive.name} achètent davantage`,summary:`Le chiffre d’affaires de cette zone progresse de ${(positive.caDelta*100).toFixed(1)} % avec ${positive.current.visits} visites sur la période récente.`,explanation:'Cette zone progresse clairement. Power la garde comme point de comparaison pour vérifier si la hausse dure et comprendre ce qui fonctionne.',impactAmount:positive.current.ca-positive.previous.ca,confidence:82,quality:'calculated',facts:[`Panier moyen ${U().money(positive.current.avgBasket)}.`,`Part du CA historique : ${(positive.historicalCA/(model.overview.caTTC||1)*100).toFixed(1)} %.`],hypotheses:[],actions:['Conserver cette zone comme témoin de comparaison et surveiller la pérennité de la hausse.'],entities:[positive.name]});

    return {generatedAt:new Date(),referenceDate:ref,boundary,windows:{current:curW,previous:prevW},coverage,zones,groups,findings,officialWorksSectorDefinition:'Clermont Auvergne Métropole : Centre / Nord & Est / Ouest / Sud',method:'Local : commune + code postal + lexique de rues pour les micro-zones clermontoises. Aucune adresse n’est envoyée à un service de géocodage.'};
  }

  return { classify, analyze };
})();
