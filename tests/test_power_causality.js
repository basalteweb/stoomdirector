global.window=global;global.AU={};
const fs=require('fs'),vm=require('vm');const root=__dirname+'/..';
vm.runInThisContext(fs.readFileSync(root+'/js/utils.js','utf8'));
vm.runInThisContext(fs.readFileSync(root+'/js/causal-context.js','utf8'));
const d=s=>new Date(s+'T12:00:00');
const current={start:d('2026-08-01'),end:d('2026-08-30'),days:30,label:'current'};
const previous={start:d('2026-07-02'),end:d('2026-07-31'),days:30,label:'previous'};
const tx=[];let id=0;
function add(date,zone,sector,ttc){tx.push({date:d(date),dateKey:date,ttc,margin:ttc*.6,clientCode:'C'+(++id),geo:{zone,worksSector:sector}})}
for(let i=2;i<=31;i++){add(`2026-07-${String(i).padStart(2,'0')}`,'Est métropole','Nord & Est',100);add(`2026-07-${String(i).padStart(2,'0')}`,'Ouest métropole','Ouest',100)}
for(let i=1;i<=30;i++){if(i<17||i%3===0)add(`2026-08-${String(i).padStart(2,'0')}`,'Est métropole','Nord & Est',35);add(`2026-08-${String(i).padStart(2,'0')}`,'Ouest métropole','Ouest',100)}
const work={sector:'Nord & Est',place:'Aulnat — rue test',text:'À partir du 17 août 2026 pour environ un mois : route barrée avec déviation.',source:'https://example.test/officiel',source_type:'official_page'};
function modelFor(finding){
 const intel={referenceDate:d('2026-08-30'),windows:{current,previous},findings:[finding],actions:[],brief:['Test']};
 return {transactions:tx,sales:[],customers:[],range:{max:d('2026-08-30')},intelligence:intel,geoIntelligence:{zones:[{name:'Est métropole',worksSector:'Nord & Est',impactScore:90,changePoint:{date:d('2026-08-17')}},{name:'Ouest métropole',worksSector:'Ouest',impactScore:0}]},publicContext:{works:[work],works_history:[],weather:[]},contextCorrelation:{source:{stale:false,apiOk:true},weather:null}};
}
const product={id:'product-x',category:'product',level:'warning',title:'Décrochage produit X',impactAmount:-900,hypotheses:[],actions:[],score:90,confidence:90};
AU.causalContext.apply(modelFor(product));
if(product.causal.retainedCauses.some(c=>c.type==='works')) throw new Error('POWER rule failed: product diagnosis incorrectly attributed to works');
const turnover={id:'turnover-main',category:'turnover',level:'warning',title:'CA en baisse',impactAmount:-1800,hypotheses:[],actions:[],score:100,confidence:100};
const m=modelFor(turnover);const c=AU.causalContext.apply(m);
if(!turnover.causal.retainedCauses.some(x=>x.type==='works')) throw new Error('Expected strong geographically coherent works signal');
if(!c.events[0]?.work?.source) throw new Error('Retained works must preserve exact source');
console.log('test_power_causality: OK',turnover.causal.score,turnover.causal.retainedCauses[0].strength);
