window.AU = window.AU || {};
AU.publicContext = (()=>{
  const U=()=>AU.util;
  const num=v=>{const x=Number(v);return Number.isFinite(x)?x:null;};
  const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
  const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));

  async function fetchJson(path,fallback){
    try{
      const r=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(7000)});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const x=await r.json();
      return x&&typeof x==='object'?x:fallback;
    }catch(e){return {...fallback,error:String(e)};}
  }
  async function load(){
    const [ctx,hist]=await Promise.all([
      fetchJson('data/public-context.json',{schema_version:null,generated_at:null,works:[],works_history:[],agenda:[],agenda_history:[],parking:[],cvelo:[],bike_counts:[],t2c:{},weather:[],source_health:[],status:'unavailable'}),
      fetchJson('data/public-context-history.json',{schema_version:1,snapshots:[]})
    ]);
    ctx.history=Array.isArray(hist?.snapshots)?hist.snapshots:[];
    return ctx;
  }
  function pearson(xs,ys){
    if(xs.length<8||xs.length!==ys.length)return null;
    const mx=avg(xs),my=avg(ys);let n=0,dx=0,dy=0;
    for(let i=0;i<xs.length;i++){const a=xs[i]-mx,b=ys[i]-my;n+=a*b;dx+=a*a;dy+=b*b;}
    return dx&&dy?n/Math.sqrt(dx*dy):null;
  }
  function ageHours(iso){if(!iso)return null;const t=new Date(iso).getTime();return Number.isFinite(t)?Math.max(0,(Date.now()-t)/3600000):null;}
  function dateKey(v){const d=v instanceof Date?v:new Date(v);if(Number.isNaN(d.getTime()))return null;return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function sourceSummary(ctx){
    const rows=Array.isArray(ctx?.source_health)?ctx.source_health:[];const ok=rows.filter(x=>x?.ok).length,total=rows.length;
    const api=ctx?.clermont_api?.health||{},age=ageHours(ctx?.generated_at),stale=age!==null&&age>36;
    let level='good';if(!api.ok||stale||ctx?.status==='partial')level='watch';if(ctx?.status==='unavailable'||(!api.ok&&ok===0))level='bad';
    return {ok,total,ratio:total?ok/total:0,apiOk:!!api.ok,apiLatency:api.latency_ms??null,totalDatasets:api.total_datasets??null,ageHours:age,stale,level,status:ctx?.status||'unavailable'};
  }
  function parkingSummary(ctx){
    const rows=(ctx?.parking||[]).filter(x=>num(x?.occupancy_pct)!==null);if(!rows.length)return null;
    const rates=rows.map(x=>num(x.occupancy_pct));const sorted=[...rows].sort((a,b)=>(num(b.occupancy_pct)||0)-(num(a.occupancy_pct)||0));
    return {records:rows.length,avgOccupancy:avg(rates),maxOccupancy:num(sorted[0].occupancy_pct),mostOccupied:sorted[0],high:rows.filter(x=>(num(x.occupancy_pct)||0)>=85).length};
  }
  function apiDatasetSummary(ctx){
    const api=ctx?.clermont_api||{},known=Array.isArray(api.known_datasets)?api.known_datasets:[],relevant=Array.isArray(api.discovered_relevant_datasets)?api.discovered_relevant_datasets:[],candidates=Array.isArray(api.candidate_fetch_status)?api.candidate_fetch_status:[];
    return {known,relevant,candidates,knownOk:known.filter(x=>x?.ok).length,candidateOk:candidates.filter(x=>x?.ok).length};
  }
  function cveloSummary(ctx){
    const s=ctx?.cvelo_status||{};const rows=Array.isArray(ctx?.cvelo)?ctx.cvelo:[];
    const bikes=num(s.bikes_available)??rows.reduce((a,x)=>a+(num(x.bikes_available)||0),0);
    const docks=num(s.docks_available)??rows.reduce((a,x)=>a+(num(x.docks_available)||0),0);
    return rows.length||s.ok?{ok:!!s.ok,stations:rows.length,bikesAvailable:bikes,docksAvailable:docks,utilisationProxy:bikes!==null&&docks!==null&&bikes+docks>0?docks/(bikes+docks):null}:null;
  }
  function t2cSummary(ctx){const t=ctx?.t2c;if(!t||typeof t!=='object')return null;return {ok:!!t.ok,decoded:!!t.decoded,tripUpdates:num(t.trip_updates),alerts:num(t.service_alerts),cancelled:num(t.cancelled_trips),delayed:num(t.delayed_updates),avgDelay:num(t.avg_delay_seconds),maxDelay:num(t.max_delay_seconds),fallback:!!t.fallback_last_known_good};}
  function agendaSummary(ctx){
    const rows=Array.isArray(ctx?.agenda)?ctx.agenda:[];const now=new Date();const end7=new Date(now.getTime()+7*86400000),end30=new Date(now.getTime()+30*86400000);
    const parsed=rows.map(x=>({...x,_d:new Date(x.start||'')})).filter(x=>!Number.isNaN(x._d.getTime()));
    return {records:rows.length,next7:parsed.filter(x=>x._d>=now&&x._d<=end7).length,next30:parsed.filter(x=>x._d>=now&&x._d<=end30).length,upcoming:parsed.filter(x=>x._d>=now).sort((a,b)=>a._d-b._d).slice(0,8)};
  }
  function bikeSummary(ctx,model){
    const rows=Array.isArray(ctx?.bike_counts)?ctx.bike_counts:[];const by=new Map();
    for(const r of rows){const k=dateKey(r.date);const c=num(r.count);if(k&&c!==null)by.set(k,(by.get(k)||0)+c);}
    const xs=[],ca=[],vis=[];for(const d of model?.daily||[]){const v=by.get(d.dateKey);if(v!==undefined){xs.push(v);ca.push(num(d.caTTC)||0);vis.push(num(d.tickets)||0);}}
    return {records:rows.length,days:by.size,latest:rows[0]||null,caCorrelation:pearson(xs,ca),visitsCorrelation:pearson(xs,vis)};
  }
  function historyCorrelations(ctx,model){
    const snaps=Array.isArray(ctx?.history)?ctx.history:[];const byDay=new Map();
    for(const s of snaps){const k=dateKey(s.generated_at);if(!k)continue;if(!byDay.has(k))byDay.set(k,[]);byDay.get(k).push(s);}
    const metrics=['parking_avg_occupancy_pct','t2c_avg_delay_seconds','t2c_delayed_updates','cvelo_bikes_available'];const out={};
    for(const m of metrics){const xs=[],ca=[],vis=[];for(const d of model?.daily||[]){const ss=byDay.get(d.dateKey)||[];const vals=ss.map(x=>num(x[m])).filter(x=>x!==null);if(!vals.length)continue;xs.push(avg(vals));ca.push(num(d.caTTC)||0);vis.push(num(d.tickets)||0);}out[m]={days:xs.length,caCorrelation:pearson(xs,ca),visitsCorrelation:pearson(xs,vis)};}
    return out;
  }
  function weatherSummary(ctx,model){
    const weatherBy=new Map((ctx?.weather||[]).map(w=>[w.date,w])),pairs=[];
    for(const d of model?.daily||[]){const w=weatherBy.get(d.dateKey);if(w&&num(w.precipitation_mm)!==null)pairs.push({ca:num(d.caTTC)||0,tickets:num(d.tickets)||0,rain:num(w.precipitation_mm)||0,temp:num(w.temperature_mean)});}
    if(pairs.length<8)return null;const rain=pairs.map(x=>x.rain),ca=pairs.map(x=>x.ca),tickets=pairs.map(x=>x.tickets),wet=pairs.filter(x=>x.rain>=3),dry=pairs.filter(x=>x.rain<1);
    return {days:pairs.length,rainCaCorrelation:pearson(rain,ca),rainVisitsCorrelation:pearson(rain,tickets),wetAvgCA:avg(wet.map(x=>x.ca)),dryAvgCA:avg(dry.map(x=>x.ca)),wetAvgVisits:avg(wet.map(x=>x.tickets)),dryAvgVisits:avg(dry.map(x=>x.tickets))};
  }
  function correlate(model,ctx){
    if(!ctx)return {matches:[],status:'unavailable',weather:null,source:null,parking:null,apiDatasets:null,urban:null,findings:[]};
    const matches=[],zones=Array.isArray(model.geoIntelligence?.zones)?model.geoIntelligence.zones:[];
    for(const z of zones.filter(x=>(num(x.impactScore)||0)>=25)){
      const token=String(z.worksSector||'').toUpperCase();const works=(ctx.works||[]).filter(w=>String(w.sector||'').toUpperCase()===token);
      if(works.length){const apiCount=works.filter(w=>w.source_type==='clermont_api').length;matches.push({zone:z.name,worksSector:z.worksSector,impactScore:z.impactScore,works:works.slice(0,16),quality:apiCount?'api+contextual':'contextual',apiCount,pageCount:works.length-apiCount});}
    }
    const source=sourceSummary(ctx),parking=parkingSummary(ctx),apiDatasets=apiDatasetSummary(ctx),weather=weatherSummary(ctx,model),agenda=agendaSummary(ctx),cvelo=cveloSummary(ctx),t2c=t2cSummary(ctx),bike=bikeSummary(ctx,model),history=historyCorrelations(ctx,model);
    const urban={agenda,cvelo,t2c,bike,history,pressureScore:0};
    let pressure=0,parts=0;if(parking?.avgOccupancy!=null){pressure+=clamp((parking.avgOccupancy-45)*1.4,0,100);parts++;}if(t2c?.avgDelay!=null){pressure+=clamp(t2c.avgDelay/5,0,100);parts++;}if(t2c?.cancelled){pressure+=clamp(t2c.cancelled*15,0,100);parts++;}if(cvelo?.utilisationProxy!=null){pressure+=clamp(cvelo.utilisationProxy*100,0,100);parts++;}urban.pressureScore=parts?Math.round(pressure/parts):0;
    const findings=[];
    if(!source.apiOk)findings.push({level:'warning',title:'API Clermont Métropole indisponible lors de la dernière synchronisation',text:'Analysis Power conserve le dernier contexte valide et les pages officielles de secours. Les analyses commerciales locales continuent normalement.'});
    if(source.stale)findings.push({level:'warning',title:'Contexte public ancien',text:`Dernière synchronisation il y a environ ${Math.round(source.ageHours)} h. Le moteur réduit la confiance accordée aux explications externes.`});
    if(parking?.high)findings.push({level:'info',title:'Stationnement métropolitain sous tension',text:`${parking.high} parc(s) dépassent 85 % d’occupation au dernier relevé API. Ce signal est testé contre les variations de fréquentation sans être considéré comme une preuve.`});
    if(t2c?.decoded&&((t2c.avgDelay||0)>180||(t2c.cancelled||0)>0))findings.push({level:'warning',title:'Pression T2C détectée',text:`Flux temps réel : retard moyen ${Math.round(t2c.avgDelay||0)} s${t2c.cancelled?` · ${t2c.cancelled} trajet(s) annulé(s)`:''}. Le moteur teste ce signal contre les zones et horaires de fréquentation.`});
    if(agenda?.next7)findings.push({level:'info',title:'Événements locaux à venir',text:`${agenda.next7} événement(s) officiel(s) détecté(s) dans les 7 prochains jours. Ils seront archivés pour mesurer ensuite leur effet réel sur le trafic et le CA.`});
    if(bike?.visitsCorrelation!==null&&Math.abs(bike.visitsCorrelation)>=0.25)findings.push({level:'info',title:'La mobilité autour du commerce évolue avec la fréquentation',text:'Les jours où la mobilité vélo change fortement, les passages en magasin évoluent souvent dans le même sens. Power garde cette information comme contexte, sans la présenter comme une cause.'});
    return {matches,status:ctx.status||'ok',weather,source,parking,apiDatasets,urban,findings,generatedAt:ctx.generated_at||null,history:ctx.history||[]};
  }
  return {load,correlate,sourceSummary,parkingSummary,agendaSummary,cveloSummary,t2cSummary};
})();
