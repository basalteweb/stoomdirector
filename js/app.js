window.AU = window.AU || {};
AU.app = (() => {
  const blank = () => ({clients:null,ventes:[],catalogue:null});
  const state = {revision:0,imports:blank(), pending:blank(), model:null, currentView:'today',analysisRunning:false,importing:false,initializing:true,viewRenderSeq:0, stagedFiles:[], stagedTypes:new Set(), stagedDuplicates:0, importErrors:new Set(), stagedStock:null};
  const $=s=>document.querySelector(s), U=()=>AU.util;
  let lastFocus=null;
  function status(type,kind,text){const e=$(`#${type}Status`);if(e){e.className=`import-status ${kind}`;e.textContent=text;}}
  function progress(type,pct){const e=$(`#${type}Progress`);if(e)e.style.width=`${Math.max(0,Math.min(100,pct))}%`;}
  function valid(i){return !!(i.clients?.ok&&i.catalogue?.ok&&i.ventes?.length&&i.ventes.every(x=>x.ok));}
  function busy(){return state.initializing||state.importing||state.analysisRunning;}
  function updateRunButton(){
    $('#runAnalysisBtn').disabled=busy()||!valid(state.pending)||state.importErrors.size>0;
    document.querySelectorAll('#importModal input[type=file],#importModal input[type=date],#discardImportBtn,#restoreFile').forEach(e=>e.disabled=busy());
    $('#runAnalysisBtn').textContent=state.analysisRunning?'Validation et sauvegarde…':'Valider et mettre à jour';
  }
  function currentImportText(i){if(!i)return 'En attente';return `${U().integer(i.rowCount)} lignes · ${i.fileName}${i.observedAt?` · relevé du ${U().formatDate(i.observedAt)}`:''}`;}
  function resetPending(){
    state.pending={...state.imports,ventes:state.imports.ventes.slice()};state.stagedFiles=[];state.stagedTypes.clear();state.stagedDuplicates=0;state.stagedStock=null;state.importErrors.clear();
    for(const t of ['clients','catalogue']){status(t,state.imports[t]?'success':'neutral',currentImportText(state.imports[t]));progress(t,state.imports[t]?100:0);}
    status('ventes',state.imports.ventes.length?'success':'neutral',state.imports.ventes.length?`${state.imports.ventes.length} export(s) conservé(s) · ${state.model?.transactions.length||0} tickets uniques`:'En attente');progress('ventes',state.imports.ventes.length?100:0);
    $('#crossStatus').className='cross-status';$('#crossStatus').innerHTML='<div class="cross-icon">+</div><div><strong>Historique conservé</strong><p>Les nouvelles ventes s’ajoutent. Les doublons exacts sont ignorés. La mise à jour est appliquée seulement après validation complète.</p></div>';
    updateRunButton();
  }
  function openImport(){lastFocus=document.activeElement;$('#importModal').classList.remove('hidden');$('#importTitle').focus();}
  function closeImport(){if(busy())return;$('#importModal').classList.add('hidden');lastFocus?.focus?.();}
  function appendSales(existing,received){
    const merged=AU.analytics.mergeSalesDatasets([...existing,...received]);
    if(merged.conflicts.length){const details=merged.conflicts.slice(0,6).map(c=>`${c.key.split('|')[0]} (${c.sourceA} / ${c.sourceB})`).join(' ; ');throw new Error(`${merged.conflicts.length} ticket(s) contradictoire(s) : ${details}. Anciennes données conservées. Corriger l’export avant de recommencer.`);}
    const keys=new Set(existing.flatMap(ds=>ds.normalized.map(l=>l.transactionKey))), result=existing.slice();let duplicates=0;
    for(const ds of received){const groups=U().groupBy(ds.normalized,l=>l.transactionKey);const rows=[];for(const [key,lines]of groups){if(keys.has(key)){duplicates++;continue;}keys.add(key);for(const l of lines)rows.push(l);}
      if(!rows.length)continue;
      const dates=rows.map(l=>l.date).sort((a,b)=>a-b);
      result.push({...ds,rowCount:rows.length,sourceRowCount:ds.rowCount,normalized:rows,report:{...ds.report,metrics:{...ds.report.metrics,minDate:dates[0],maxDate:dates.at(-1),transactionCount:new Set(rows.map(x=>x.transactionKey)).size,totalTTC:U().sum(rows.map(x=>x.saleTTC)),totalHT:U().sum(rows.map(x=>x.saleHT)),totalMargin:U().sum(rows.map(x=>x.margin))}}});
    }
    return {datasets:result,duplicates};
  }
  function mergeClients(old,next){
    if(!old)return next;
    const oldDate=old.observedAt||old.sourceLastModified||old.importedAt,nextDate=next.observedAt||next.sourceLastModified||next.importedAt;
    const newer=!oldDate||U().startOfDay(nextDate)>=U().startOfDay(oldDate), rows=new Map(old.normalized.map(c=>[c.codeClient,c]));
    for(const c of next.normalized)if(newer||!rows.has(c.codeClient))rows.set(c.codeClient,c);
    const base=newer?next:old;
    return {...base,normalized:[...rows.values()],rowCount:rows.size,report:{...base.report,warnings:[...base.report.warnings,`${rows.size} fiches cumulées : les clients historiques absents de cet export sont conservés.`],metrics:{...base.report.metrics,uniqueCodes:rows.size}}};
  }
  async function handleFiles(type,files){
    const list=[...(files||[])];if(!list.length||busy())return;
    state.importing=true;updateRunButton();status(type,'neutral','Lecture et contrôle…');progress(type,2);
    try{
      const results=[];
      for(let i=0;i<list.length;i++){
        const r=await AU.importer.parseFile(type,list[i],(pct,text)=>{progress(type,(i+pct/100)/list.length*100);status(type,'neutral',`${i+1}/${list.length} · ${text}`);});
        if(!r.ok)throw new Error(r.report.errors.join('\n'));
        if(type!=='ventes'){
          const observedAt=U().parseTgmDate($(`#${type}Observed`).value);
          if(!observedAt||observedAt>U().endOfDay(new Date()))throw new Error('La date de l’export est absente, invalide ou future.');
          r.observedAt=observedAt;
        }
        results.push(r);
      }
      let note='';
      if(type==='ventes'){
        const appended=appendSales(state.pending.ventes,results);state.pending.ventes=appended.datasets;state.stagedDuplicates+=appended.duplicates;
        note=`${appended.duplicates} ticket(s) déjà présent(s) ignoré(s). Historique conservé.`;
      }else if(type==='clients')state.pending.clients=mergeClients(state.imports.clients,results[0]);
      else {
        const next=results[0],old=state.imports.catalogue,oldAt=old?.observedAt||old?.sourceLastModified||old?.importedAt;
        state.stagedStock=next;
        if(old&&oldAt&&next.observedAt<U().startOfDay(oldAt)){state.pending.catalogue=old;note='Ce relevé est plus ancien : ajouté aux relevés de stock, le stock courant reste inchangé.';}
        else state.pending.catalogue=next;
      }
      state.stagedFiles.push(...list.map(f=>f.name));state.stagedTypes.add(type);state.importErrors.delete(type);
      status(type,results.some(r=>r.report.warnings.length)?'warning':'success',`${list.length} fichier(s) contrôlé(s). ${note}\n${results.flatMap(r=>r.report.warnings||[]).slice(0,4).join('\n')}`);progress(type,100);
      $('#crossStatus').className='cross-status good';$('#crossStatus').innerHTML='<div class="cross-icon">✓</div><div><strong>Mise à jour prête à vérifier</strong><p>Cliquer sur « Valider et mettre à jour ». Les données déjà validées restent disponibles jusque-là.</p></div>';
    }catch(e){state.importErrors.add(type);status(type,'error',e.message);progress(type,0);AU.ui.toast('Import refusé. L’historique validé est conservé.','bad');}
    finally{state.importing=false;updateRunButton();for(const id of ['clientsFile','ventesFile','catalogueFile'])$('#'+id).value='';}
  }
  async function enrich(model){
    try{
      model.publicContext=await AU.publicContext?.load?.();
      if(AU.power?.hydrateContext)await AU.power.hydrateContext(model);
      model.contextCorrelation=AU.publicContext?.correlate?.(model,model.publicContext)||null;
      model.intelligence=AU.intelligence?.analyze?.(model)||model.intelligence;
      model.causalContext=AU.causalContext?.apply?.(model)||null;
    }catch(e){console.warn('Contexte public indisponible',e);}
    try{model.analysisHistory=await AU.storage.listAnalysisSnapshots();model.stockHistory=await AU.storage.listStockSnapshots();}catch{model.analysisHistory=model.analysisHistory||[];model.stockHistory=[];}
    try{model.autopilot=AU.autopilot?.run?.(model)||model.autopilot;}catch(e){console.warn('Contrôles supplémentaires indisponibles',e);}
    return model;
  }
  async function runAnalysis(){
    if(busy()||!valid(state.pending)||state.importErrors.size)return;
    state.analysisRunning=true;updateRunButton();const previousDirector=AU.director.getData();let committed=false;
    const cross=$('#crossStatus');cross.className='cross-status';cross.innerHTML='<div class="cross-icon">↻</div><div><strong>Contrôle du nouvel état du magasin</strong><p>Vérification de l’historique, des identités et des articles avant sauvegarde.</p></div>';
    await new Promise(r=>setTimeout(r,30));
    try{
      const imports=state.pending;
      const model=AU.analytics.buildModel({clientsImport:imports.clients,salesImports:imports.ventes,catalogueImport:imports.catalogue});
      if(!model.quality.analysisAllowed)throw new Error(model.quality.blocking.join(' '));
      const total=model.transactions.length,added=total-(state.model?.transactions.length||0);
      const d=AU.director.getData();d.journal.push({at:new Date().toISOString(),files:state.stagedFiles.join(' · ')||'Recalcul des sources conservées',added,duplicates:state.stagedDuplicates,total,range:`${U().formatDate(model.range.min)} → ${U().formatDate(model.range.max)}`});
      AU.director.setData(d);
      state.revision=await AU.storage.commitWorkspace(imports,AU.director.getData(),null,state.revision);
      committed=true;
      state.imports=imports;state.model=model;
      try{await AU.storage.saveStockSnapshot(state.stagedStock||imports.catalogue);}catch(e){AU.ui.toast('Données enregistrées ; relevé de stock supplémentaire non sauvegardé.','bad');}
      resetPending();showModel();
      await enrich(model);
      try{await AU.storage.saveAnalysisSnapshot(model);}catch(e){console.warn(e);}
      showModel();
      AU.ui.toast(`Historique mis à jour : ${added} ticket(s) ajouté(s), ${total} tickets conservés.`);
      $('#importModal').classList.add('hidden');lastFocus?.focus?.();
    }catch(e){
      if(!committed)AU.director.setData(previousDirector);
      cross.className='cross-status bad';cross.innerHTML=`<div class="cross-icon">!</div><div><strong>${committed?'Données enregistrées, affichage à relancer':'Mise à jour non appliquée'}</strong><p>${U().escapeHtml(e.message)} ${committed?'Recharger la page pour restaurer la mise à jour sauvegardée.':'La dernière analyse validée reste accessible.'}</p></div>`;
      AU.ui.toast((committed?'Données sauvegardées, affichage interrompu : ':'Nouvel import non appliqué : ')+e.message,'bad');
    }finally{state.analysisRunning=false;updateRunButton();}
  }
  function showModel(){
    if(!state.model)return;$('#emptyState').classList.add('hidden');$('#viewRoot').classList.remove('hidden');
    $('#dataRangeBadge').className='pill info';$('#dataRangeBadge').textContent=`${state.model.transactions.length} tickets · au ${U().formatDate(state.model.range.max)}`;
    switchView(state.currentView);
  }
  function switchView(view){
    state.currentView=view||'today';const root=$('#viewRoot'),seq=++state.viewRenderSeq;
    document.querySelectorAll('.nav-item').forEach(b=>{const active=b.dataset.view===state.currentView;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');});
    $('#mainNav').classList.remove('mobile-open');$('#menuBtn')?.setAttribute('aria-expanded','false');
    if(!state.model)return;
    root.dataset.viewState='loading';requestAnimationFrame(()=>{if(seq!==state.viewRenderSeq||!state.model)return;AU.ui.render(state.currentView,state.model,root);});
  }
  async function refreshContextFromStore(){if(!state.model)return false;await enrich(state.model);showModel();return true;}
  async function restoreSession(){
    try{
      const [saved,d]=await Promise.all([AU.storage.loadSession(),AU.storage.loadDirector()]);AU.director.setData(d);
      if(!valid(saved?.imports||{}))return;
      const model=AU.analytics.buildModel({clientsImport:saved.imports.clients,salesImports:saved.imports.ventes,catalogueImport:saved.imports.catalogue});
      if(!model.quality.analysisAllowed)throw new Error(model.quality.blocking.join(' '));
      state.revision=saved.revision||0;state.imports=saved.imports;state.model=model;resetPending();showModel();await enrich(model);showModel();
      AU.ui.toast('Mémoire du magasin restaurée.');
    }catch(e){AU.ui.toast('Restauration locale impossible : '+e.message,'bad');}
  }
  function parseBackup(text){
    const dateKeys=new Set(['date','importedAt','observedAt','sourceLastModified','createdAt','modifiedAt','capturedAt','dataMax','minDate','maxDate','savedAt']);
    const b=JSON.parse(text,(k,v)=>{if(['__proto__','prototype','constructor'].includes(k))throw new Error('Clé de sauvegarde interdite.');if(dateKeys.has(k)&&typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)){const d=new Date(v);if(!Number.isFinite(d.getTime()))throw new Error('Date de sauvegarde invalide.');return d;}return v;});
    if(b.format!=='stoom-director-backup'||b.schema!==1||!valid(b.imports||{}))throw new Error('Ce fichier n’est pas une sauvegarde Stoom Director compatible.');
    for(const [type,imports]of [['clients',[b.imports.clients]],['catalogue',[b.imports.catalogue]],['ventes',b.imports.ventes]])for(const i of imports){
      if(i.type!==type||!Array.isArray(i.normalized)||!i.normalized.length||typeof i.fileName!=='string'||!Array.isArray(i.report?.columns)||!Array.isArray(i.report?.warnings))throw new Error('Structure d’export invalide dans la sauvegarde.');
      const keys=new Set();
      for(const row of i.normalized){
        if(!row||typeof row!=='object')throw new Error('Ligne de sauvegarde invalide.');
        const code=type==='clients'?row.codeClient:row.articleCode;
        if(typeof code!=='string'||!code)throw new Error('Code manquant dans la sauvegarde.');
        if(type!=='ventes'){if(keys.has(code))throw new Error('Codes dupliqués dans la sauvegarde.');keys.add(code);}
        if(type==='catalogue'&&!Number.isFinite(row.stock))throw new Error('Stock invalide.');
        if(type==='ventes'){
          if(!(row.date instanceof Date)||!Number.isFinite(row.date.getTime())||typeof row.transactionKey!=='string'||!row.transactionKey)throw new Error('Ticket invalide dans la sauvegarde.');
          for(const field of ['qty','saleTTC','saleHT','margin','discount'])if(!Number.isFinite(row[field]))throw new Error(`Montant invalide : ${field}.`);
          if(row.dateKey!==U().dateKey(row.date))throw new Error('Date de ticket incohérente.');
        }
      }
    }
    return b;
  }
  async function exportBackup(){
    if(!state.model||busy()){AU.ui.toast('Attendre la fin de la mise à jour avant de sauvegarder.','bad');return;}
    try{
      const snapshots=await AU.storage.listStockSnapshots(),analysisSnapshots=await AU.storage.listAnalysisSnapshots();
      const d=AU.director.getData();d.lastBackup=new Date().toISOString();
      const b={format:'stoom-director-backup',schema:1,version:AU.APP.version,createdAt:new Date().toISOString(),imports:state.imports,director:d,storeProfile:AU.power.loadProfile(),snapshots,analysisSnapshots};
      U().downloadText(`STOOM-Sauvegarde-${U().dateKey(new Date())}.json`,JSON.stringify(b),'application/json');
      AU.director.setData(d);await AU.director.persist();AU.ui.toast('Sauvegarde exportée. Conserver le fichier téléchargé.');
    }catch(e){AU.ui.toast('Sauvegarde impossible : '+e.message,'bad');}
  }
  async function restoreBackup(file){
    if(!file||busy())return;state.importing=true;updateRunButton();
    try{
      if(file.size>250*1024*1024)throw new Error('Sauvegarde trop volumineuse pour cette restauration (250 Mo maximum).');
      const b=parseBackup(await file.text());
      const model=AU.analytics.buildModel({clientsImport:b.imports.clients,salesImports:b.imports.ventes,catalogueImport:b.imports.catalogue});
      if(!model.quality.analysisAllowed)throw new Error(model.quality.blocking.join(' '));
      if(!confirm(`Restaurer ${model.transactions.length} tickets du ${U().formatDate(model.range.min)} au ${U().formatDate(model.range.max)} ? Cette restauration remplacera la mémoire actuelle de ce navigateur. Exporter d’abord la mémoire actuelle si nécessaire.`))return;
      const old=AU.director.getData();AU.director.setData(b.director);
      try{state.revision=await AU.storage.commitWorkspace(b.imports,AU.director.getData(),{snapshots:b.snapshots||[],analysisSnapshots:b.analysisSnapshots||[]},state.revision);}catch(e){AU.director.setData(old);throw e;}
      state.imports=b.imports;state.model=model;
      if(b.storeProfile)try{AU.power.saveProfile(b.storeProfile);}catch{AU.ui.toast('Données restaurées ; profil du magasin à reconfigurer.','bad');}
      resetPending();showModel();await enrich(model);showModel();AU.ui.toast('Sauvegarde restaurée et calculs reconstruits.');
    }catch(e){AU.ui.toast('Restauration refusée : '+e.message,'bad');}
    finally{state.importing=false;$('#restoreFile').value='';updateRunButton();}
  }
  function trapDialog(e){
    if(e.key!=='Tab')return;const modal=[...document.querySelectorAll('.modal:not(.hidden)')].at(-1);if(!modal)return;
    const focusable=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length);
    if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);
    if(e.shiftKey&&(document.activeElement===first||!modal.contains(document.activeElement))){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&(document.activeElement===last||!modal.contains(document.activeElement))){e.preventDefault();first.focus();}
  }
  function bindSearch(){
    const input=$('#globalSearch'),results=$('#searchResults');
    input.addEventListener('input',()=>{
      const q=U().normText(input.value);
      if(q.length<2||!state.model){results.classList.add('hidden');return;}
      const clients=state.model.customers.filter(c=>U().normText(`${c.client.name} ${c.client.codeClient} ${c.client.phone} ${c.client.email}`).includes(q)).slice(0,5);
      const products=state.model.products.filter(p=>U().normText(`${p.code} ${p.designation} ${p.rayon}`).includes(q)).slice(0,5);
      results.innerHTML=clients.map(c=>`<button data-search-client="${U().escapeHtml(c.client.codeClient)}">${U().escapeHtml(c.client.name)}<small>Client · ${U().integer(c.visitCount)} visite(s)</small></button>`).join('')+products.map(p=>`<button data-search-product="${U().escapeHtml(p.code)}">${U().escapeHtml(p.designation)}<small>Produit · ${U().escapeHtml(p.code)} · stock ${p.stock===null?'inconnu':U().number(p.stock)}</small></button>`).join('')||'<p>Aucun résultat.</p>';
      results.classList.remove('hidden');
      results.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.searchClient)AU.ui.showClientDetail(b.dataset.searchClient);else AU.ui.showProductDetail(b.dataset.searchProduct);results.classList.add('hidden');input.value='';}));
    });
    input.addEventListener('keydown',e=>{if(e.key==='Escape')results.classList.add('hidden');if(e.key==='ArrowDown'){e.preventDefault();results.querySelector('button')?.focus();}});
    document.addEventListener('click',e=>{if(!e.target.closest('.dir-global-search'))results.classList.add('hidden');});
  }
  async function clearLocalData(){
    if(busy()||!confirm('Effacer ventes, clients, catalogue, actions et relevés de stock de ce navigateur ? Exporter une sauvegarde avant de continuer.'))return;
    try{await AU.storage.clearAll();location.reload();}catch(e){AU.ui.toast('Effacement incomplet : '+e.message,'bad');}
  }
  async function init(){
    $('#versionLabel').textContent=`v${AU.APP.version}`;
    $('#openImportBtn').addEventListener('click',openImport);$('#emptyImportBtn').addEventListener('click',openImport);
    $('#discardImportBtn').addEventListener('click',()=>{resetPending();AU.ui.toast('Fichiers en attente retirés. Historique conservé.');});
    document.querySelectorAll('[data-close-modal]').forEach(e=>e.addEventListener('click',closeImport));
    document.querySelectorAll('[data-close-detail]').forEach(e=>e.addEventListener('click',AU.ui.closeDetail));
    for(const t of ['clients','ventes','catalogue'])$('#'+t+'File').addEventListener('change',e=>handleFiles(t,e.target.files));
    for(const t of ['clients','catalogue']){$('#'+t+'Observed').value=U().dateKey(new Date());$('#'+t+'Observed').max=U().dateKey(new Date());$('#'+t+'Observed').addEventListener('change',()=>{if(state.stagedTypes.has(t)){state.importErrors.add(t);status(t,'warning','Date modifiée : sélectionner à nouveau le fichier pour appliquer cette date.');updateRunButton();}});}
    $('#runAnalysisBtn').addEventListener('click',runAnalysis);$('#clearDataBtn').addEventListener('click',clearLocalData);
    $('#backupBtn').addEventListener('click',exportBackup);$('#restoreBtn').addEventListener('click',()=>$('#restoreFile').click());$('#restoreFile').addEventListener('change',e=>restoreBackup(e.target.files[0]));
    document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $('#menuBtn').addEventListener('click',()=>{const open=$('#mainNav').classList.toggle('mobile-open');$('#menuBtn').setAttribute('aria-expanded',String(open));});
    document.addEventListener('keydown',e=>{trapDialog(e);if(e.key==='Escape'){closeImport();AU.ui.closeDetail();}if((e.ctrlKey||e.metaKey)&&e.key==='i'){e.preventDefault();openImport();}});
    bindSearch();updateRunButton();await restoreSession();state.initializing=false;resetPending();
    if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{});
  }
  return {state,init,openImport,runAnalysis,switchView,refreshContextFromStore,exportBackup,restoreBackup,parseBackup,appendSales,mergeClients,handleFiles};
})();
document.addEventListener('DOMContentLoaded',AU.app.init);
