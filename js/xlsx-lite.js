window.AU = window.AU || {};

AU.xlsxLite = (() => {
  const decoder = new TextDecoder('utf-8');

  function u16(v,o){return v.getUint16(o,true)}
  function u32(v,o){return v.getUint32(o,true)}

  function zipEntries(buffer) {
    const bytes=new Uint8Array(buffer), view=new DataView(buffer);
    let eocd=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(u32(view,i)===0x06054b50){eocd=i;break}}
    if(eocd<0) throw new Error('Classeur XLSX invalide : fin d’archive ZIP introuvable.');
    const total=u16(view,eocd+10), centralOffset=u32(view,eocd+16);
    let pos=centralOffset; const map=new Map();
    for(let n=0;n<total;n++){
      if(u32(view,pos)!==0x02014b50) throw new Error('Classeur XLSX invalide : répertoire ZIP corrompu.');
      const method=u16(view,pos+10), compSize=u32(view,pos+20), uncompSize=u32(view,pos+24);
      const nameLen=u16(view,pos+28), extraLen=u16(view,pos+30), commentLen=u16(view,pos+32), localOffset=u32(view,pos+42);
      const name=decoder.decode(bytes.slice(pos+46,pos+46+nameLen));
      map.set(name,{name,method,compSize,uncompSize,localOffset});
      pos+=46+nameLen+extraLen+commentLen;
    }
    return {bytes,view,map};
  }

  async function inflateRaw(data) {
    if(typeof DecompressionStream==='undefined') throw new Error('Ce navigateur ne fournit pas le décompresseur nécessaire aux fichiers XLSX.');
    const ds=new DecompressionStream('deflate-raw');
    const stream=new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function extract(zip,name) {
    const e=zip.map.get(name); if(!e) return null;
    const {view,bytes}=zip; const p=e.localOffset;
    if(u32(view,p)!==0x04034b50) throw new Error(`Entrée XLSX corrompue : ${name}`);
    const nameLen=u16(view,p+26), extraLen=u16(view,p+28), start=p+30+nameLen+extraLen;
    const compressed=bytes.slice(start,start+e.compSize);
    if(e.method===0) return compressed;
    if(e.method===8) return await inflateRaw(compressed);
    throw new Error(`Compression XLSX non prise en charge (${e.method}).`);
  }

  async function xml(zip,name) {
    const data=await extract(zip,name); if(!data) return null;
    const text=decoder.decode(data);
    const doc=new DOMParser().parseFromString(text,'application/xml');
    if(doc.querySelector('parsererror')) throw new Error(`XML XLSX invalide : ${name}`);
    return doc;
  }

  function textOf(node){return node ? [...node.querySelectorAll('t')].map(t=>t.textContent||'').join('') : ''}
  function colIndex(ref) {
    const m=String(ref||'').match(/^([A-Z]+)/i); if(!m)return 0;
    let n=0; for(const ch of m[1].toUpperCase()) n=n*26+(ch.charCodeAt(0)-64); return n-1;
  }

  async function parseFile(file,onProgress) {
    onProgress?.(8,'Lecture XLSX locale…');
    const buffer=await file.arrayBuffer();
    const zip=zipEntries(buffer);
    onProgress?.(25,'Lecture de la structure du classeur…');
    const sharedDoc=await xml(zip,'xl/sharedStrings.xml');
    const shared=sharedDoc ? [...sharedDoc.querySelectorAll('si')].map(textOf) : [];
    let sheetPath=null, sheetName='Feuille 1';
    const wb=await xml(zip,'xl/workbook.xml');
    const rels=await xml(zip,'xl/_rels/workbook.xml.rels');
    if(wb){
      const first=wb.querySelector('sheet');
      if(first){
        sheetName=first.getAttribute('name')||sheetName;
        const rid=first.getAttribute('r:id')||first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
        if(rid && rels){
          const rel=[...rels.querySelectorAll('Relationship')].find(r=>r.getAttribute('Id')===rid);
          if(rel){let target=rel.getAttribute('Target')||'';target=target.replace(/^\//,'');sheetPath=target.startsWith('xl/')?target:`xl/${target.replace(/^\.\//,'')}`;}
        }
      }
    }
    if(!sheetPath){sheetPath=[...zip.map.keys()].filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/i.test(k)).sort()[0]||null;}
    if(!sheetPath) throw new Error('Aucune feuille exploitable dans le classeur XLSX.');
    onProgress?.(48,`Décodage de ${sheetName}…`);
    const sheet=await xml(zip,sheetPath);
    const matrix=[];
    const rowNodes=[...sheet.querySelectorAll('sheetData > row')];
    rowNodes.forEach((rowNode,ri)=>{
      const arr=[];
      for(const c of rowNode.querySelectorAll('c')){
        const idx=colIndex(c.getAttribute('r'));
        const type=c.getAttribute('t')||'';
        let value='';
        if(type==='inlineStr') value=textOf(c.querySelector('is'));
        else {
          const raw=c.querySelector('v')?.textContent ?? '';
          if(type==='s') value=shared[Number(raw)] ?? '';
          else if(type==='b') value=raw==='1';
          else if(type==='str' || type==='e') value=raw;
          else if(raw!=='' && Number.isFinite(Number(raw))) value=Number(raw);
          else value=raw;
        }
        arr[idx]=value;
      }
      matrix.push(arr);
      if(ri && ri%2500===0) onProgress?.(48+Math.min(38,ri/Math.max(1,rowNodes.length)*38),`${new Intl.NumberFormat('fr-FR').format(ri)} lignes Excel lues…`);
    });
    if(!matrix.length) return {rows:[],sheetName,parseErrors:[]};
    const headers=(matrix[0]||[]).map(v=>String(v??''));
    const rows=[];
    for(let i=1;i<matrix.length;i++){
      const arr=matrix[i]||[];
      if(arr.every(v=>v===undefined||v===null||String(v).trim()==='')) continue;
      const obj={}; for(let c=0;c<headers.length;c++) if(headers[c]) obj[headers[c]]=arr[c]??'';
      rows.push(obj);
    }
    onProgress?.(90,'Validation des colonnes…');
    return {rows,sheetName,parseErrors:[]};
  }

  return { parseFile };
})();
