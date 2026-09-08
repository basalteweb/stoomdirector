// Exercises transaction completion, rollback and revision checks using an IDB event simulator.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
global.window=global;global.AU={};
let failNextCommit=false;
const stores=new Map();
const db={objectStoreNames:{contains:k=>stores.has(k)},createObjectStore(k){stores.set(k,new Map());},close(){},transaction(names,mode){
 const selected=Array.isArray(names)?names:[names],staged=new Map(selected.map(k=>[k,new Map(stores.get(k))]));
 let pending=0,ended=false,timer;
 const tx={error:null,abort(){if(ended)return;ended=true;clearTimeout(timer);queueMicrotask(()=>tx.onabort?.());},objectStore(name){
  const request=fn=>{const req={result:null};pending++;queueMicrotask(()=>{if(ended)return;try{req.result=fn();req.onsuccess?.();}catch(e){req.error=e;tx.error=e;req.onerror?.();tx.abort();}finally{pending--;schedule();}});return req;};
  const map=staged.get(name);return {get:key=>request(()=>structuredClone(map.get(key))),getAll:()=>request(()=>[...map.values()].map(x=>structuredClone(x))),put:(value,key)=>request(()=>{const k=key===undefined?value.id:key;if(k===undefined)throw new Error('Key missing');map.set(k,structuredClone(value));return k;}),clear:()=>request(()=>map.clear())};
 }};
 function schedule(){clearTimeout(timer);timer=setTimeout(()=>{if(ended||pending)return;if(mode==='readwrite'&&failNextCommit){failNextCommit=false;tx.error=new Error('Quota simulée');tx.abort();return;}ended=true;if(mode==='readwrite')for(const [k,v]of staged)stores.set(k,v);tx.oncomplete?.();},0);}
 schedule();return tx;
}};
global.indexedDB={open(){const req={};queueMicrotask(()=>{req.result=db;req.onupgradeneeded?.();req.onsuccess?.();});return req;}};
for(const file of ['utils','storage'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'));
(async()=>{
 let count=0;const pass=name=>{count++;console.log('PASS '+name);};
 assert.equal(await AU.storage.loadSession(),null);pass('Fresh database opens and creates its stores');
 await AU.storage.saveDirector({a:1});assert.deepEqual(await AU.storage.loadDirector(),{a:1});pass('Director write resolves only after committed state is readable');
 failNextCommit=true;await assert.rejects(AU.storage.saveDirector({a:2}),/Quota/);assert.deepEqual(await AU.storage.loadDirector(),{a:1});pass('Write request success followed by transaction abort rejects and preserves old state');
 let revision=await AU.storage.commitWorkspace({ventes:['January']},{a:3},null,0);assert.equal(revision,1);assert.equal((await AU.storage.loadSession()).imports.ventes[0],'January');assert.deepEqual(await AU.storage.loadDirector(),{a:3});pass('Imports and director journal commit together');
 failNextCommit=true;await assert.rejects(AU.storage.commitWorkspace({ventes:['February']},{a:4},null,1),/Quota/);assert.equal((await AU.storage.loadSession()).imports.ventes[0],'January');assert.deepEqual(await AU.storage.loadDirector(),{a:3});pass('Failed workspace commit rolls back both sales and director state');
 await assert.rejects(AU.storage.commitWorkspace({ventes:['stale tab']},{a:9},null,0),/autre onglet/);assert.equal((await AU.storage.loadSession()).revision,1);pass('Stale tab cannot overwrite a newer sales ledger');
 revision=await AU.storage.commitWorkspace({ventes:['restored']},{a:5},{snapshots:[{id:'s1',capturedAt:new Date(2026,2,1),items:[]}],analysisSnapshots:[]},1);assert.equal(revision,2);assert.equal((await AU.storage.listStockSnapshots()).length,1);pass('Restore applies sales and stock history atomically');
 await AU.storage.clearAll();assert.equal(await AU.storage.loadSession(),null);assert.equal((await AU.storage.listStockSnapshots()).length,0);pass('Clear operation waits for deletion of every store');
 console.log(`\n${count} storage checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
