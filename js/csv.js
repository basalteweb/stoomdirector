window.AU = window.AU || {};

AU.csv = (() => {
  function workerSource() {
    return String.raw`
      function detectDelimiter(text) {
        const first = text.split(/\r?\n/, 1)[0] || '';
        const candidates = [';', ',', '\t'];
        let best = ';', bestCount = -1;
        for (const d of candidates) {
          let count = 0, quoted = false;
          for (let i=0;i<first.length;i++) {
            const ch=first[i];
            if (ch==='"') quoted=!quoted;
            else if (!quoted && ch===d) count++;
          }
          if (count>bestCount) {best=d;bestCount=count;}
        }
        return best;
      }
      function rowToObject(header,row) {
        const o={};
        for(let i=0;i<header.length;i++) o[header[i]??'']=row[i]??'';
        if(row.length>header.length) o.__extra=row.slice(header.length);
        return o;
      }
      function parse(text, delimiter) {
        let row=[], field='', quoted=false, headers=null, chunk=[], rowNo=0, issues=[];
        const flushField=()=>{row.push(field);field='';};
        const flushRow=()=>{
          if(row.length===1 && row[0]==='' && !headers){row=[];return;}
          if(row.every(v=>String(v).trim()==='')){row=[];return;}
          rowNo++;
          if(!headers){headers=row.map((x,i)=> i===0 ? String(x).replace(/^\uFEFF/,'') : String(x));row=[];return;}
          if(row.length!==headers.length) issues.push({row:rowNo,code:row.length<headers.length?'TooFewFields':'TooManyFields',expected:headers.length,actual:row.length});
          chunk.push(rowToObject(headers,row)); row=[];
          if(chunk.length>=4000){postMessage({type:'chunk',rows:chunk});chunk=[];}
        };
        const len=text.length;
        for(let i=0;i<len;i++){
          const ch=text[i];
          if(quoted){
            if(ch==='"'){
              if(text[i+1]==='"'){field+='"';i++;}
              else quoted=false;
            } else field+=ch;
          } else {
            if(ch==='"' && field==='') quoted=true;
            else if(ch===delimiter) flushField();
            else if(ch==='\n'){flushField();flushRow();}
            else if(ch==='\r') { if(text[i+1]!=='\n'){flushField();flushRow();} }
            else field+=ch;
          }
          if(i>0 && i%1000000===0) postMessage({type:'progress',pct:Math.min(88,5+i/len*82),rows:rowNo});
        }
        if(quoted) issues.push({row:rowNo+1,code:'UnclosedQuote'});
        if(field!=='' || row.length){flushField();flushRow();}
        if(chunk.length) postMessage({type:'chunk',rows:chunk});
        postMessage({type:'done',headers,issues,rowCount:Math.max(0,rowNo-1),delimiter});
      }
      onmessage = e => {
        try {
          const file=e.data.file;
          const reader=new FileReaderSync();
          let text=reader.readAsText(file,'utf-8');
          const replacements=(text.match(/\uFFFD/g)||[]).length;
          if(replacements>5) text=reader.readAsText(file,'windows-1252');
          const delimiter=detectDelimiter(text);
          parse(text,delimiter);
        } catch(err) { postMessage({type:'error',message:err && err.message ? err.message : String(err)}); }
      };
    `;
  }

  function parseFile(file, onProgress) {
    return new Promise((resolve,reject)=>{
      const blob=new Blob([workerSource()],{type:'text/javascript'});
      const url=URL.createObjectURL(blob);
      const worker=new Worker(url);
      const rows=[]; const issues=[];
      const cleanup=()=>{worker.terminate();URL.revokeObjectURL(url);};
      worker.onmessage=e=>{
        const m=e.data||{};
        if(m.type==='chunk') rows.push(...(m.rows||[]));
        else if(m.type==='progress') onProgress?.(m.pct, `${new Intl.NumberFormat('fr-FR').format(m.rows||0)} lignes lues…`);
        else if(m.type==='done'){if(m.issues?.length)issues.push(...m.issues);cleanup();resolve({rows,parseErrors:issues,delimiter:m.delimiter});}
        else if(m.type==='error'){cleanup();reject(new Error(m.message||'Erreur CSV.'));}
      };
      worker.onerror=e=>{cleanup();reject(new Error(e.message||'Erreur du moteur CSV local.'));};
      worker.postMessage({file});
    });
  }

  return { parseFile };
})();
