// CSV privati: lettura sul dispositivo e scelta di contatti già visibili allo staff.
// Le righe del file sono dati, mai codice HTML o istruzioni da eseguire.
export function leggiCollegamentiCSV(testo) {
 if(testo.length>512000)throw new Error('Il file è troppo grande (massimo 500 KB).');
 testo=testo.replace(/^\uFEFF/,'');
 const righe=[];let riga=[],campo='',citato=false,chiuso=false;
 for(let i=0;i<testo.length;i++){
  const c=testo[i];
  if(citato){if(c==='"'){if(testo[i+1]==='"'){campo+='"';i++;}else{citato=false;chiuso=true;}}else campo+=c;continue;}
  if(c==='"'){if(campo || chiuso)throw new Error('Virgolette non valide nel CSV.');citato=true;}
  else if(c===';' || c==='\n' || c==='\r'){
   riga.push(campo);campo='';chiuso=false;
   if(c!==';'){if(c==='\r' && testo[i+1]==='\n')i++;if(riga.some(v=>v.trim()))righe.push(riga);riga=[];}
  }else{if(chiuso && c.trim())throw new Error('Testo inatteso dopo le virgolette nel CSV.');if(!chiuso)campo+=c;}
 }
 if(citato)throw new Error('Virgolette non chiuse nel CSV.');
 if(campo || riga.length || chiuso){riga.push(campo);if(riga.some(v=>v.trim()))righe.push(riga);}
 if(righe.length<2)throw new Error('Il CSV non contiene collegamenti.');
 const intestazione=righe.shift().map(v=>v.trim().toLocaleLowerCase('it'));
 const indice=k=>intestazione.indexOf(k);
 if(['stato','persona','gruppo','tipo gruppo'].some(k=>indice(k)<0))throw new Error('Servono le colonne Stato, Persona, Gruppo e Tipo gruppo, separate da punto e virgola.');
 if(new Set(intestazione).size!==intestazione.length)throw new Error('Il CSV contiene colonne duplicate.');
 if(righe.length>500)throw new Error('Il CSV contiene troppe righe (massimo 500).');
 let escluse=0;
 const dati=[];
 for(const r of righe){
  if(r.length!==intestazione.length)throw new Error('Il numero di colonne non coincide con l’intestazione.');
  const get=k=>r[indice(k)].trim();
  if(!['CONFERMATO','ESPRESSO NEL FILE'].includes(get('stato').toUpperCase())){escluse++;continue;}
  const persona=get('persona'),gruppo=get('gruppo'),tipo=get('tipo gruppo').toLowerCase();
  if(!persona || persona.length>120 || gruppo.length<2 || gruppo.length>160 || !['parrocchia','associazione','compagnia','altro'].includes(tipo))throw new Error('Controlla nome della persona, gruppo e tipo nelle righe confermate.');
  dati.push({persona,gruppo,tipo});
 }
 if(!dati.length)throw new Error('Non ci sono righe confermate da importare.');
 if(dati.length>200)throw new Error('Importa al massimo 200 collegamenti alla volta.');
 return {dati,escluse};
}

export function creaImportatoreGruppi({client,getState,contatti,esc,onChange,toast}) {
 const dlg=document.body.appendChild(Object.assign(document.createElement('dialog'),{id:'dlg-importa-gruppi'}));
 dlg.setAttribute('aria-label','Importa collegamenti persone e gruppi');
 let sessione=0;
 const normalizza=s=>String(s || '').normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('it');
 return function apri(){
  const S=getState();if(!S.canWrite)return;const correnteSessione=++sessione;
  const lista=contatti().filter(c=>c.nome && !c.nascosto).sort((a,b)=>a.nome.localeCompare(b.nome,'it'));
  dlg.innerHTML='<div class="dlg"><div class="dlg-head"><h2>Importa collegamenti</h2><button class="btn ghost" id="gi-chiudi" type="button">Chiudi</button></div><p>Carica il CSV dei collegamenti confermati. Le persone vengono scelte dalla rubrica; puoi correggere i gruppi o escludere una riga prima di salvare.</p><p class="hint">L’importazione aggiunge le appartenenze. Referenti abituali, note e attività già registrate restano quelli salvati. Dopo potrai cambiare tutto dalla scheda del gruppo.</p><div class="field"><label for="gi-file">File CSV dei collegamenti</label><input id="gi-file" type="file" accept=".csv,text/csv"></div><p id="gi-info" role="status"></p><div id="gi-righe"></div><p class="es-errore" id="gi-error" role="alert"></p><div class="actions"><button class="btn primary" id="gi-salva" type="button" disabled>Importa i collegamenti selezionati</button></div></div>';
  const file=dlg.querySelector('#gi-file'),salva=dlg.querySelector('#gi-salva'),errori=dlg.querySelector('#gi-error'),info=dlg.querySelector('#gi-info');
  let righe=[],lettura=0,gruppiAnteprima=[];
  dlg.oncancel=e=>{if(file.disabled)e.preventDefault();};
  const opzioni=nome=>{
   const candidati=lista.filter(c=>normalizza(c.nome)===normalizza(nome));
   const selezionato=candidati.length===1?candidati[0].chiave:'';
   return `<option value="">${candidati.length>1?'Più persone con questo nome: scegli quella corretta':'Scegli una persona dalla rubrica'}</option>`+lista.map(c=>`<option value="${esc(c.chiave)}"${c.chiave===selezionato?' selected':''}>${esc(c.nome)}${c.email[0]?' · '+esc(c.email[0]):c.telefoni[0]?' · '+esc(c.telefoni[0]):''}</option>`).join('');
  };
  const controlla=()=>{
   const attive=[...dlg.querySelectorAll('[data-gi-riga]')].filter(el=>el.querySelector('[data-gi-usa]').checked);
   salva.disabled=!attive.length || attive.some(el=>{
    const nome=el.querySelector('[data-gi-gruppo]').value.trim();
    return !el.querySelector('[data-gi-persona]').value || nome.length<2 || gruppiAnteprima.some(g=>g.archiviato && g.nome.trim().toLowerCase()===nome.toLowerCase());
   });
  };
  file.onchange=async()=>{
   const corrente=++lettura;
   righe=[];salva.disabled=true;errori.textContent='';info.textContent='';dlg.querySelector('#gi-righe').innerHTML='';
   try{
    const f=file.files[0];if(!f)return;if(f.size>512000)throw new Error('Il file è troppo grande (massimo 500 KB).');
    const testo=await f.text();if(corrente!==lettura || correnteSessione!==sessione || !dlg.open)return;const risultato=leggiCollegamentiCSV(testo);righe=risultato.dati;gruppiAnteprima=S.gruppi.map(g=>({...g}));
    info.textContent=`${righe.length} collegamenti confermati${risultato.escluse?` · ${risultato.escluse} righe non confermate escluse`:''}. Controlla le persone selezionate prima di importare.`;
    dlg.querySelector('#gi-righe').innerHTML=`<datalist id="gi-gruppi">${gruppiAnteprima.filter(g=>!g.archiviato).map(g=>`<option value="${esc(g.nome)}"></option>`).join('')}</datalist>`+righe.map((r,i)=>`<section data-gi-riga="${i}" class="gi-riga"><label class="check"><input type="checkbox" data-gi-usa checked> ${esc(r.persona)}</label><div class="form"><div class="field"><label for="gi-persona-${i}">Persona in rubrica</label><select id="gi-persona-${i}" data-gi-persona>${opzioni(r.persona)}</select></div><div class="field h"><label for="gi-gruppo-${i}">Gruppo</label><input id="gi-gruppo-${i}" data-gi-gruppo list="gi-gruppi" maxlength="160" value="${esc(r.gruppo)}"></div><div class="field h"><label for="gi-tipo-${i}">Tipo per un nuovo gruppo</label><select id="gi-tipo-${i}" data-gi-tipo>${Object.entries({parrocchia:'Gruppo della Parrocchia',associazione:'Associazione',compagnia:'Compagnia o formazione',altro:'Altro gruppo'}).map(([k,v])=>`<option value="${k}"${k===r.tipo?' selected':''}>${v}</option>`).join('')}</select></div><p class="hint field" data-gi-destinazione></p></div></section>`).join('');
    for(const el of dlg.querySelectorAll('[data-gi-riga]')){
     const descrivi=()=>{
      const gruppo=gruppiAnteprima.find(g=>g.nome.trim().toLowerCase()===el.querySelector('[data-gi-gruppo]').value.trim().toLowerCase());
      el.querySelector('[data-gi-destinazione]').textContent=gruppo?(gruppo.archiviato?'Gruppo archiviato: scegli un’altra destinazione o riattivalo prima.':'Gruppo già presente: conserva membri, tipo e referente abituale.'):'Verrà creato un nuovo gruppo, senza referente abituale assegnato.';
      controlla();
     };
     el.onchange=descrivi;el.querySelector('[data-gi-gruppo]').oninput=descrivi;descrivi();
    }
   }catch(error){errori.textContent=error.message;}
  };
  salva.onclick=async()=>{
   errori.textContent='';salva.disabled=true;file.disabled=true;dlg.querySelector('#gi-chiudi').disabled=true;
   dlg.querySelectorAll('#gi-righe input,#gi-righe select').forEach(el=>el.disabled=true);
   try{
    const dati=[...dlg.querySelectorAll('[data-gi-riga]')].filter(el=>el.querySelector('[data-gi-usa]').checked).map(el=>{
     const c=lista.find(c=>c.chiave===el.querySelector('[data-gi-persona]').value);if(!c)throw new Error('Scegli una persona per ogni riga selezionata.');
     const nome=el.querySelector('[data-gi-gruppo]').value.trim(),g=gruppiAnteprima.find(g=>g.nome.trim().toLowerCase()===nome.toLowerCase());
     return {gruppo:nome,tipo:el.querySelector('[data-gi-tipo]').value,persona:{chiave:c.chiave,nome:c.nome,telefono:c.telefoni[0] || '',email:c.email[0] || '',ente:c.ente || '',categoria:c.categoria || 'Altro'},revisione_gruppo:g?.revisione || null};
    });
    const {data,error}=await client().rpc('gruppi_importa_collegamenti',{p_collegamenti:dati});if(error)throw error;
    await onChange();dlg.close();toast(`Importazione completata: ${data.collegamenti_aggiunti} collegamenti aggiunti, ${data.gia_presenti} già presenti. Puoi modificarli aprendo i gruppi.`);
   }catch(error){errori.textContent=error.code==='PGRST202'?'Prima dell’importazione applica la migrazione 041 e ricarica.':error.message;controlla();}
   finally{file.disabled=false;dlg.querySelector('#gi-chiudi').disabled=false;dlg.querySelectorAll('#gi-righe input,#gi-righe select').forEach(el=>el.disabled=false);}
  };
  dlg.querySelector('#gi-chiudi').onclick=()=>dlg.close();
  dlg.showModal();
 };
}
