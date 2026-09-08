window.AU = window.AU || {};

AU.storage = (() => {
  const DB_NAME = 'analysis-ultimate-db';
  const DB_VERSION = 2;
  let dbPromise = null;

  function openDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB indisponible dans ce navigateur.'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('analysisSnapshots')) db.createObjectStore('analysisSnapshots', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
        resolve(req.result);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
      req.onblocked = () => { dbPromise = null; reject(new Error('Fermer les autres onglets Analysis pour ouvrir la mémoire du magasin.')); };
    });
    return dbPromise;
  }

  async function put(store, key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const req = key === undefined ? os.put(value) : os.put(value, key);
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error || new Error('Sauvegarde interrompue.'));
      req.onerror = () => reject(req.error);
    });
  }

  async function get(store, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAll(store) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearStore(store) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('Effacement interrompu.'));
      req.onerror = () => reject(req.error);
    });
  }

  async function saveSession(session) {
    return put('state', 'latestSession', { ...session, savedAt: new Date() });
  }

  async function loadSession() {
    return get('state', 'latestSession');
  }

  async function saveStockSnapshot(catalogueImport) {
    if (!catalogueImport?.ok) return;
    const day = AU.util.dateKey(catalogueImport.observedAt || catalogueImport.importedAt || new Date());
    const fingerprint = await AU.util.hashString(JSON.stringify(catalogueImport.normalized.map(x=>[x.articleCode,x.stock])));
    const id = `${day}|${fingerprint}`;
    const existing = await get('snapshots', id);
    if (existing) return;
    await put('snapshots', undefined, {
      id,
      capturedAt: catalogueImport.observedAt || catalogueImport.importedAt || new Date(),
      sourceFile: catalogueImport.fileName,
      sourceLastModified: catalogueImport.sourceLastModified || null,
      items: catalogueImport.normalized.map(x => ({ articleCode: x.articleCode, stock: x.stock, saleTTC: x.saleTTC, rayon: x.rayon, famille: x.famille }))
    });
  }

  async function listStockSnapshots() {
    const rows = await getAll('snapshots');
    return rows.sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
  }


  async function saveAnalysisSnapshot(model) {
    if (!model?.range?.max) return;
    const capturedAt = new Date();
    const id = `${AU.util.dateKey(capturedAt)}|${model.range.max.getTime()}|${model.transactions.length}`;
    const row = {
      id, capturedAt, dataMax: model.range.max, transactions: model.transactions.length,
      caTTC: model.overview?.caTTC || 0,
      riskHigh: model.customers?.filter(c=>c.risk?.key==='high').length || 0,
      causal: model.causalContext ? {tested:model.causalContext.tested,strong:model.causalContext.strong,moderate:model.causalContext.moderate,top:(model.causalContext.top||[]).slice(0,8).map(x=>({findingId:x.findingId,title:x.title,score:x.score,status:x.status,topZone:x.topZone}))} : null,
      geo: (model.geoIntelligence?.zones || []).map(z=>({name:z.name,impactScore:z.impactScore,ca:z.current.ca,caDelta:z.caDelta,visits:z.current.visits,visitsDelta:z.visitsDelta,caGap:z.caGap}))
    };
    await put('analysisSnapshots', undefined, row);
  }

  async function listAnalysisSnapshots() {
    const rows = await getAll('analysisSnapshots');
    return rows.sort((a,b)=>new Date(a.capturedAt)-new Date(b.capturedAt));
  }

  async function clearAll() {
    await Promise.all([clearStore('state'), clearStore('snapshots'), clearStore('analysisSnapshots')]);
  }

  // Imports, journal and settings move forward together or not at all.
  async function commitWorkspace(imports, director, snapshots = null, expectedRevision = null) {
    const db = await openDb();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(['state','snapshots','analysisSnapshots'],'readwrite');
      let revision = 0, reason = null;
      const read = tx.objectStore('state').get('latestSession');
      read.onsuccess = () => {
        const currentRevision = read.result?.revision || 0;
        if (expectedRevision !== null && currentRevision !== expectedRevision) {
          reason = new Error('Un autre onglet a actualisé les ventes. Recharger la page puis réimporter les nouveaux fichiers.');
          tx.abort(); return;
        }
        revision = currentRevision + 1;
        tx.objectStore('state').put({imports,savedAt:new Date(),revision},'latestSession');
        tx.objectStore('state').put(director,'director');
        if (snapshots) for (const name of ['snapshots','analysisSnapshots']) {
          tx.objectStore(name).clear();
          for (const row of snapshots[name] || []) tx.objectStore(name).put(row);
        }
      };
      tx.oncomplete = () => resolve(revision);
      tx.onabort = tx.onerror = () => reject(reason || tx.error || new Error('Mise à jour locale interrompue.'));
    });
  }

  return { commitWorkspace, saveDirector: value => put('state', 'director', value), loadDirector: () => get('state', 'director'), saveSession, loadSession, saveStockSnapshot, listStockSnapshots, saveAnalysisSnapshot, listAnalysisSnapshots, clearAll };
})();
