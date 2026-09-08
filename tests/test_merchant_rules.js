global.window=global;global.AU={};
const fs=require('fs'),vm=require('vm'),path=require('path');const root=path.join(__dirname,'..');
vm.runInThisContext(fs.readFileSync(path.join(root,'js/utils.js'),'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(root,'js/causal-context.js'),'utf8'));
const d=s=>new Date(s+'T12:00:00');
const current={start:d('2026-08-01'),end:d('2026-08-30'),days:30,label:'current'};
const previous={start:d('2026-07-02'),end:d('2026-07-31'),days:30,label:'previous'};
const tx=[];let id=0;
function add(date,zone,sector,ttc){tx.push({date:d(date),dateKey:date,ttc,margin:ttc*.6,clientCode:'C'+(++id),geo:{zone,worksSector:sector}})}
for(let i=2;i<=31;i++){add(`2026-07-${String(i).padStart(2,'0')}`,'Est métropole','Nord & Est',100);add(`2026-07-${String(i).padStart(2,'0')}`,'Ouest métropole','Ouest',100)}
for(let i=1;i<=30;i++){add(`2026-08-${String(i).padStart(2,'0')}`,'Est métropole','Nord & Est',40);add(`2026-08-${String(i).padStart(2,'0')}`,'Ouest métropole','Ouest',100)}
const oldAgenda=[];for(let i=0;i<16;i++)oldAgenda.push({event_id:'E'+i,title:'Événement '+i,start:`2026-07-${String(2+i).padStart(2,'0')}T10:00:00`,place:'Clermont-Ferrand'});
function modelFor(finding){
 const intel={referenceDate:d('2026-08-30'),windows:{current,previous},findings:[finding],actions:[],brief:['Test']};
 return {transactions:tx,sales:[],customers:[],range:{max:d('2026-08-30')},intelligence:intel,geoIntelligence:{zones:[{name:'Est métropole',worksSector:'Nord & Est',impactScore:90,changePoint:{date:d('2026-08-17')}},{name:'Ouest métropole',worksSector:'Ouest',impactScore:0}]},publicContext:{works:[],works_history:[],agenda:[],agenda_history:oldAgenda,weather:[]},contextCorrelation:{source:{stale:false,apiOk:true},weather:null,urban:{history:{}}}};
}
const turnover={id:'turnover-main',category:'turnover',level:'warning',title:'Le chiffre d’affaires recule',impactAmount:-1800,hypotheses:[],actions:[],score:100,confidence:100};
AU.causalContext.apply(modelFor(turnover));
if(turnover.causal.retainedCauses.some(x=>x.key==='events')) throw new Error('Generic event-count difference must never become a cause');
if(turnover.causal.retainedCauses.some(x=>x.label==='Événements locaux')) throw new Error('Generic event cause leaked');

// A chantier that starts after a decline has already happened must not be promoted just because it is in the right sector.
const weakWork={sector:'Nord & Est',place:'Aulnat',text:'À partir du 17 août 2026 pour environ un mois : route barrée avec déviation.',source:'https://example.test/officiel',source_type:'official_page'};
const weakModel=modelFor({...turnover,id:'turnover-weak-work'});weakModel.publicContext.works=[weakWork];weakModel.publicContext.works_history=[];
AU.causalContext.apply(weakModel);
const weakFinding=weakModel.intelligence.findings[0];
if(weakFinding.causal.retainedCauses.some(x=>x.type==='works')) throw new Error('Works must not be retained when the commercial decline predates the work and no around-event deterioration is observed');

const product={id:'product-decline-X',category:'product',level:'warning',title:'Produit X se vend moins qu’avant',impactAmount:-800,hypotheses:[],actions:[],score:90,confidence:90};
AU.causalContext.apply(modelFor(product));
if(product.causal.retainedCauses.some(x=>['weather','parking','t2c','events'].includes(x.key))) throw new Error('External context must not directly explain a product');
const ui=fs.readFileSync(path.join(root,'js/ui.js'),'utf8');
const merchantUi=ui.split('function qualityView')[0]; // technical vocabulary is allowed only after this point in Détails & audit
if(/Explication fortement compatible/.test(merchantUi)) throw new Error('Technical causal wording remains in merchant UI');
if(/Cause(s)? fortes.*score|score ≥ 78\/100/.test(merchantUi)) throw new Error('Causal score threshold leaked into merchant UI');
if(/Zone contributrice|mouvement géolocalisé|Qualité du rattachement|Critique <7 jours|Faible <21 jours/.test(merchantUi)) throw new Error('Technical wording remains in merchant-facing views');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
if(/Lancer le croisement|Croisement non lancé/.test(index)) throw new Error('Import flow still exposes technical crossing vocabulary');
const geo=fs.readFileSync(path.join(root,'js/geo.js'),'utf8');
if(/Pression géographique/.test(geo)) throw new Error('Technical geo title remains');
console.log('test_merchant_rules: OK');
