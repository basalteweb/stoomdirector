global.window=global;global.AU={};
const fs=require('fs'),vm=require('vm');
const root=__dirname+'/..';
vm.runInThisContext(fs.readFileSync(root+'/js/utils.js','utf8'));
vm.runInThisContext(fs.readFileSync(root+'/js/causal-context.js','utf8'));
const d=s=>new Date(s+'T12:00:00');
const current={start:d('2026-08-01'),end:d('2026-08-30'),days:30,label:'current'};
const previous={start:d('2026-07-02'),end:d('2026-07-31'),days:30,label:'previous'};
const tx=[];
let id=0;
function add(date,zone,sector,ttc){tx.push({date:d(date),dateKey:date,ttc,margin:ttc*.6,clientCode:'C'+(++id),geo:{zone,worksSector:sector}})}
for(let i=2;i<=31;i++){add(`2026-07-${String(i).padStart(2,'0')}`,'Est métropole','Nord & Est',100);add(`2026-07-${String(i).padStart(2,'0')}`,'Ouest métropole','Ouest',100)}
for(let i=1;i<=30;i++){if(i<17||i%3===0)add(`2026-08-${String(i).padStart(2,'0')}`,'Est métropole','Nord & Est',40);add(`2026-08-${String(i).padStart(2,'0')}`,'Ouest métropole','Ouest',100)}
const finding={id:'turnover-main',category:'turnover',level:'warning',title:'CA 30 jours en baisse',impactAmount:-1800,findings:[],actions:[],score:100,confidence:100};
const intel={referenceDate:d('2026-08-30'),windows:{current,previous},findings:[finding],actions:[],brief:['Test']};
const model={transactions:tx,sales:[],customers:[],range:{max:d('2026-08-30')},intelligence:intel,geoIntelligence:{zones:[{name:'Est métropole',worksSector:'Nord & Est',impactScore:90,changePoint:{date:d('2026-08-17')}},{name:'Ouest métropole',worksSector:'Ouest',impactScore:0}]},publicContext:{works:[{sector:'Nord & Est',place:'Aulnat',text:'À partir du 17 août 2026 pour environ un mois : travaux en route barrée.',source_type:'official_page'}],works_history:[],weather:[]},contextCorrelation:{source:{stale:false,apiOk:true},weather:null}};
const c=AU.causalContext.apply(model);
if(!finding.causal?.tested) throw new Error('causal test not executed');
if(finding.causal.score<58) throw new Error('expected at least moderate causal compatibility, got '+finding.causal.score);
if(!c.top.length) throw new Error('expected top causal result');
const parsed=AU.causalContext.normalizeWork(model.publicContext.works[0]);
if(AU.util.dateKey(parsed.startDate)!=='2026-08-17') throw new Error('work start date parse failed');
console.log('test_causal_context: OK',finding.causal.score,finding.causal.status);
