window.AU = window.AU || {};

AU.autopilot = (() => {
  const U=()=>AU.util;
  function priority(level){return {critical:5,warning:4,opportunity:3,positive:2,info:1,quality:0}[level]||1;}
  function run(model){
    const intel=model.intelligence; const geo=model.geoIntelligence;
    const executed=[]; const recommendations=[];
    const add=(id,title,result,details=[],level='info',payload=null)=>executed.push({id,title,result,details,level,status:'executed',payload});

    const high=model.customers.filter(c=>c.risk?.key==='high').sort((a,b)=>b.estimatedMonthlyValue-a.estimatedMonthlyValue);
    add('customer-rescue','Clients à relancer classés',`${high.length} client(s) reviennent nettement moins qu’à leur habitude`,high.slice(0,12).map(c=>`${c.client.name} · ${c.geo?.zone||'zone inconnue'} · environ ${U().money(c.estimatedMonthlyValue)}/mois historiquement`),high.length>20?'warning':'info',{customers:high.map(c=>c.client.codeClient)});

    const restock=model.products.filter(p=>p.qty30>0&&p.stock!==null&&p.coverageDays!==null&&p.coverageDays<21).map(p=>({...p,target21:Math.max(0,Math.ceil(p.velocity30*21-p.stock))})).sort((a,b)=>(a.coverageDays??999)-(b.coverageDays??999));
    add('restock-plan','Produits à recommander vérifiés',`${restock.length} référence(s) risquent de devenir trop faibles au rythme actuel`,restock.slice(0,12).map(p=>`${p.designation} · stock ${p.stock} · environ ${Math.round(p.coverageDays)} jours au rythme actuel · à vérifier : +${p.target21}`),restock.some(p=>p.coverageDays<7)?'critical':'warning',{products:restock.map(p=>({code:p.code,target21:p.target21}))});

    const zones=(geo?.zones||[]).filter(z=>z.impactScore>=25);
    add('geo-watch','Origine des clients vérifiée',zones.length?`${zones.length} zone(s) cliente(s) méritent une attention particulière`:'Aucune zone cliente ne décroche fortement',zones.slice(0,10).map(z=>`${z.name} · CA ${z.caDelta===null?'non comparable':`${z.caDelta>=0?'+':''}${(z.caDelta*100).toFixed(1)} %`} · visites ${z.visitsDelta===null?'non comparables':`${z.visitsDelta>=0?'+':''}${(z.visitsDelta*100).toFixed(1)} %`}`),zones.some(z=>z.impactScore>=70)?'critical':zones.length?'warning':'positive');

    const forecastZones=(geo?.zones||[]).filter(z=>z.forecast7?.confidence>=55).sort((a,b)=>b.forecast7.ca-a.forecast7.ca);
    add('geo-forecast','Tendance des 7 prochains jours estimée',`${forecastZones.length} zone(s) disposent d’assez d’historique pour donner un ordre de grandeur`,forecastZones.slice(0,10).map(z=>`${z.name} · environ ${U().money(z.forecast7.ca)} de CA attendu · ${Math.round(z.forecast7.visits)} visites attendues`),'info');

    const due=model.customers.filter(c=>c.expectedNext&&c.expectedNext>=U().startOfDay(model.range.max)&&c.expectedNext<=U().endOfDay(U().addDays(model.range.max,7))).sort((a,b)=>b.estimatedMonthlyValue-a.estimatedMonthlyValue);
    add('due-next','Clients qui devraient bientôt revenir repérés',`${due.length} clients devraient entrer dans leur fenêtre habituelle sous 7 jours`,due.slice(0,12).map(c=>`${c.client.name} · attendu vers ${U().formatDate(c.expectedNext)} · ${c.geo?.zone||'zone inconnue'}`),'info',{customers:due.map(c=>c.client.codeClient)});

    const decliners=(intel?.drivers?.products||[]).filter(p=>p.delta<0).sort((a,b)=>a.delta-b.delta).slice(0,15);
    add('product-decline','Produits qui expliquent le plus la baisse repérés',`${decliners.length} références principales expliquent une partie de la baisse`,decliners.map(p=>`${p.label} · ${U().money(p.delta)}`),decliners.length?'warning':'positive');

    const previousSnapshot=(model.analysisHistory||[]).at(-1);
    if(previousSnapshot?.geo?.length && geo?.zones?.length){
      const prevMap=new Map(previousSnapshot.geo.map(z=>[z.name,z]));
      const evolution=geo.zones.map(z=>{const p=prevMap.get(z.name);return p?{name:z.name,impactNow:z.impactScore,impactBefore:p.impactScore,deltaImpact:z.impactScore-p.impactScore,caNow:z.current.ca,caBefore:p.ca}:null}).filter(Boolean).sort((a,b)=>Math.abs(b.deltaImpact)-Math.abs(a.deltaImpact));
      add('since-last-import','Évolution depuis la dernière analyse vérifiée',evolution.length?`${evolution.length} zone(s) comparées à la dernière analyse enregistrée`:'Pas encore assez d’historique pour comparer les zones',evolution.slice(0,10).map(x=>`${x.name} · CA comparé : ${U().money(x.caBefore)} → ${U().money(x.caNow)}`),evolution.some(x=>x.deltaImpact>=20)?'warning':'info');
    }

    const ctx=model.contextCorrelation;
    if(ctx?.source){
      const s=ctx.source;
      const apiText=s.apiOk?`API Clermont connectée · ${s.totalDatasets??'—'} jeux détectés · ${s.apiLatency??'—'} ms`:`API Clermont indisponible · fallback local/pages activé`;
      const details=[apiText,`Sources publiques valides : ${s.ok}/${s.total}`,`Fraîcheur : ${s.ageHours===null?'inconnue':`${s.ageHours.toFixed(1)} h`}`,`État contexte : ${s.status}`];
      if(ctx.parking)details.push(`Parkings API : ${ctx.parking.records} relevé(s) · occupation moyenne ${ctx.parking.avgOccupancy.toFixed(1)} %`);
      if(ctx.apiDatasets)details.push(`Jeux connus API valides : ${ctx.apiDatasets.knownOk}/${ctx.apiDatasets.known.length} · candidats mobilité/travaux : ${ctx.apiDatasets.relevant.length}`);
      add('public-api-sentinel','Local Context Sentinel contrôlé',apiText,details,!s.apiOk||s.stale?'warning':'positive');
    }

    const causal=model.causalContext;
    if(causal){
      add('causal-context-engine','Explications vérifiées',causal.strong+causal.moderate?`${causal.strong+causal.moderate} cause(s) suffisamment solides pour être expliquées`:'Aucune cause externe ou comportementale n’est assez solide pour être affirmée',causal.top.slice(0,10).map(x=>`${x.title} · ${x.status==='strong'?'cause très probable':'cause probable'} : ${x.retainedCauses?.[0]?.label||'cause identifiée'}${x.works?.[0]?` · ${x.works[0].place||x.works[0].sector}`:''}`),causal.strong?'warning':causal.moderate?'warning':'positive',{diagnostics:causal.top.map(x=>x.findingId)});
      const causalOps=causal.top.filter(x=>['strong','moderate'].includes(x.status)).slice(0,8);
      add('causal-action-plan','Explications à suivre préparées',causalOps.length?`${causalOps.length} explication(s) méritent d’être suivies au prochain import`:'Aucune cause suffisamment fiable à afficher pour le moment',causalOps.map(x=>`${x.title} · ${x.retainedCauses?.[0]?.label||'cause identifiée'}`),causalOps.some(x=>x.status==='strong')?'warning':'info');
    }

    const quality=model.quality;
    add('quality-guard','Fiabilité des données vérifiée',quality.analysisAllowed?'Les fichiers sont assez fiables pour lancer l’analyse':'Analyse bloquée pour éviter une conclusion fausse',[
      `${(quality.matchCounts?.probable||0)+(quality.matchCounts?.anonymous||0)} ticket(s) demandent de la prudence côté client`,
      `${quality.catalogCounts?.missing||0} ligne(s) concernent un article absent du catalogue actuel`,
      quality.financialIntegrity===null?'La marge ne peut pas être vérifiée partout avec les champs disponibles':quality.financialIntegrity>.999?'Les montants contrôlables sont cohérents':'Certains montants demandent une vérification'
    ],quality.status==='certified'?'positive':quality.analysisAllowed?'warning':'critical');

    const findings=[...(intel?.findings||[])].sort((a,b)=>(priority(b.level)*100+(b.confidence||0))-(priority(a.level)*100+(a.confidence||0)));
    for(const f of findings.slice(0,12)) for(const action of (f.actions||[]).slice(0,2)) recommendations.push({action,source:f.title,confidence:f.confidence,level:f.level,external:false});
    if(high.length) recommendations.push({action:`Utiliser la liste automatique des ${Math.min(30,high.length)} clients à plus forte valeur pour préparer une campagne de réactivation conforme aux consentements commerciaux.`,source:'Liste de sauvetage clients',confidence:90,level:'warning',external:true});
    if(restock.length) recommendations.push({action:`Vérifier/commander les ${Math.min(15,restock.length)} références les plus tendues selon la cible de 21 jours calculée automatiquement.`,source:'Plan stock',confidence:94,level:'warning',external:true});

    const critical=executed.filter(x=>x.level==='critical').length; const warnings=executed.filter(x=>x.level==='warning').length;
    const brief=[
      `Autopilot a exécuté ${executed.length} contrôles/actions internes sans intervention.`,
      zones.length?`${zones.length} zone(s) géographique(s) nécessitent une surveillance renforcée.`:'Aucune zone géographique ne présente actuellement un décrochage majeur selon les seuils du moteur.',
      high.length?`${high.length} client(s) réguliers tardent nettement à revenir et ont été classés par priorité.`:'Aucun client régulier n’est actuellement très en retard.',
      restock.length?`${restock.length} référence(s) peuvent devenir trop faibles dans les trois prochaines semaines au rythme actuel.`:'Aucun produit vendu récemment ne semble manquer à court terme.'
    ];
    return {generatedAt:new Date(),executed,recommendations,brief,status:critical?'ALERTE':warnings?'SURVEILLANCE':'NORMAL',score:Math.max(0,100-critical*18-warnings*7)};
  }
  return {run};
})();
