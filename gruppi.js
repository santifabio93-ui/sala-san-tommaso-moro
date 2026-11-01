// I gruppi sono distinti dai contatti e possono condividere le stesse persone.
export function creaGruppi({client,getState,contatti,esc,onChange,toast}) {
 const tipi={parrocchia:'Gruppo della Parrocchia',associazione:'Associazione',compagnia:'Compagnia o formazione',altro:'Altro gruppo'};
 const dialog=document.body.appendChild(Object.assign(document.createElement('dialog'),{id:'dlg-gruppo'}));
 dialog.setAttribute('aria-label','Gruppo e persone');
 const persone=()=>contatti().filter(c=>c.nome && !c.nascosto).sort((a,b)=>a.nome.localeCompare(b.nome,'it'));
 const dto=c=>({chiave:c.chiave,nome:c.nome,telefono:c.telefoni[0] || '',email:c.email[0] || '',ente:c.ente || '',categoria:c.categoria || 'Altro'});
 const nome=k=>getState().rubrica.find(c=>c.chiave===k)?.nome || k;
 function render(host){
  const S=getState();
  if(!S.datiCaricati){host.innerHTML='<p class="hint">Caricamento di gruppi e persone…</p>';return;}
  if(S.loadErr2?.gruppi){host.innerHTML='<p class="hint">Per gestire gruppi e persone applica la migrazione 040 e ricarica.</p>';return;}
  const q=(S.rbQ || '').trim().toLocaleLowerCase('it');
  const lista=(S.gruppi || []).filter(g=>(S.grArchiviati || !g.archiviato) && (!q || [g.nome,tipi[g.tipo],...(S.gruppiPersone || []).filter(m=>m.gruppo_id===g.id).map(m=>nome(m.persona_chiave))].join(' ').toLocaleLowerCase('it').includes(q))); 
  host.innerHTML=`<section class="panel"><div class="section-head"><h3>Gruppi e persone</h3><button class="btn" id="gr-nuovo">+ Nuovo gruppo</button></div><p class="hint">La stessa persona può appartenere a più gruppi. Il referente abituale è una proposta: ogni attività conserva la propria scelta.</p><div class="rb-lista">${lista.map(g=>`<div class="rb-card"><button type="button" class="rb-apri" data-gr="${g.id}"><b>${esc(g.nome)}${g.archiviato?' · archiviato':''}</b><span class="hint">${tipi[g.tipo]} · ${(S.gruppiPersone || []).filter(m=>m.gruppo_id===g.id).length} persone${g.referente_chiave?' · referente: '+esc(nome(g.referente_chiave)):''}</span></button></div>`).join('') || (q?'<p>Nessun gruppo con questa ricerca.</p>':'<p>Ancora nessun gruppo. Puoi creare prima le persone con «Nuovo contatto».</p>')}</div><label><input id="gr-archiviati" type="checkbox"${S.grArchiviati?' checked':''}> Mostra anche i gruppi archiviati</label></section>`;
  host.querySelector('#gr-nuovo').onclick=()=>apri(null);
  host.querySelector('#gr-archiviati').onchange=e=>{S.grArchiviati=e.target.checked;render(host);};
  host.querySelectorAll('[data-gr]').forEach(el=>el.onclick=()=>apri(S.gruppi.find(g=>g.id===el.dataset.gr)));
 }
 function apri(g){
  const S=getState(), scelta=new Set((S.gruppiPersone || []).filter(m=>m.gruppo_id===g?.id).map(m=>m.persona_chiave));
  // Mantieni visibili anche i contatti nascosti già appartenenti al gruppo.
  const lista=persone();
  for(const k of scelta)if(!lista.some(c=>c.chiave===k)){const c=S.rubrica.find(c=>c.chiave===k);if(c)lista.push({...c,telefoni:[c.telefono],email:[c.email]});}
  dialog.innerHTML=`<form id="gr-form" class="dlg"><div class="dlg-head"><h2>${g?'Modifica gruppo':'Nuovo gruppo'}</h2><button class="btn ghost" id="gr-chiudi" type="button">Chiudi</button></div><div class="form"><div class="field h"><label for="gr-nome">Nome del gruppo</label><input id="gr-nome" required minlength="2" maxlength="160" value="${esc(g?.nome || '')}"></div><div class="field h"><label for="gr-tipo">Tipo</label><select id="gr-tipo">${Object.entries(tipi).map(([k,v])=>`<option value="${k}"${g?.tipo===k?' selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label for="gr-cerca">Cerca le persone da aggiungere al gruppo</label><input id="gr-cerca" type="search" placeholder="Nome, telefono o email…"><div id="gr-persone">${lista.map(c=>`<label class="check" data-cerca="${esc([c.nome,...c.telefoni,...c.email].join(' '))}"><input type="checkbox" value="${esc(c.chiave)}"${scelta.has(c.chiave)?' checked':''}><span>${esc(c.nome)}${c.email[0]?' · '+esc(c.email[0]):c.telefoni[0]?' · '+esc(c.telefoni[0]):''}</span></label>`).join('') || '<p>Nessuna persona in rubrica.</p>'}</div><span class="hint">Spunta le persone del gruppo. I nuovi nominativi si inseriscono prima in Rubrica → Nuovo contatto.</span></div><div class="field"><label for="gr-referente">Referente abituale</label><select id="gr-referente"></select></div><div class="field"><label for="gr-note">Note interne sul gruppo</label><textarea id="gr-note" maxlength="2000">${esc(g?.note || '')}</textarea></div><label class="field"><span><input id="gr-archiviato" type="checkbox"${g?.archiviato?' checked':''}> Gruppo archiviato (resta nello storico)</span></label></div><p id="gr-error" role="alert" class="es-errore"></p><div class="dlg-foot"><button class="btn primary" type="submit">Salva gruppo</button></div></form>`;
  const membri=dialog.querySelector('#gr-persone'),ref=dialog.querySelector('#gr-referente');
  const selezionate=()=>[...membri.querySelectorAll('input:checked')];
  dialog.querySelector('#gr-cerca').oninput=e=>{const q=e.target.value.trim().toLocaleLowerCase('it');membri.querySelectorAll('label').forEach(el=>el.hidden=!el.dataset.cerca.toLocaleLowerCase('it').includes(q));};
  function aggiorna(value){ref.innerHTML='<option value="">Nessun referente abituale</option>'+selezionate().map(o=>`<option value="${esc(o.value)}">${esc(lista.find(c=>c.chiave===o.value)?.nome || o.textContent)}</option>`).join('');ref.value=selezionate().some(o=>o.value===value)?value:'';}
  aggiorna(g?.referente_chiave);membri.onchange=()=>aggiorna(ref.value);
  dialog.querySelector('#gr-chiudi').onclick=()=>dialog.close();
  dialog.querySelector('form').onsubmit=async e=>{
   e.preventDefault();const btn=dialog.querySelector('[type=submit]');btn.disabled=true;
   try{
    const {error}=await client().rpc('gruppo_salva',{p_id:g?.id || null,p_nome:dialog.querySelector('#gr-nome').value.trim(),p_tipo:dialog.querySelector('#gr-tipo').value,p_persone:selezionate().map(o=>dto(lista.find(c=>c.chiave===o.value))),p_referente:ref.value || null,p_note:dialog.querySelector('#gr-note').value.trim(),p_archiviato:dialog.querySelector('#gr-archiviato').checked,p_revisione:g?.revisione || null});
    if(error)throw error;await onChange();dialog.close();toast('Gruppo salvato');
   }catch(error){dialog.querySelector('#gr-error').textContent=error.code==='23505'?'Esiste già un gruppo con questo nome. Aprilo dalla rubrica.':error.message;}finally{btn.disabled=false;}
  };
  dialog.showModal();
 }
 // Le scelte popolano solo i campi della bozza corrente, mai altri eventi.
 function collega(host,prefix,source={},onPersona=()=>{}){
  if(!host){
   const field=document.getElementById(prefix==='b'?'b-referente':'ns-dest')?.closest('.field');
   if(!field)return;
   host=document.createElement('div');host.id=prefix+'-associazione';host.className='attivita-associazione';field.before(host);
  }

  const S=getState();
  if(S.loadErr2?.gruppi){host.innerHTML='<p class="hint">Gruppi non disponibili: puoi compilare il referente a mano.</p>';return;}
  const lista=persone();
  if(source.persona_chiave && !lista.some(c=>c.chiave===source.persona_chiave)){
   const c=S.rubrica.find(c=>c.chiave===source.persona_chiave);if(c)lista.push({...c,telefoni:[c.telefono],email:[c.email]});
  }
  host.innerHTML=`<div class="field h"><label for="${prefix}-gruppo">Gruppo (facoltativo)</label><select id="${prefix}-gruppo"><option value="">Nessun gruppo</option>${(S.gruppi || []).filter(g=>!g.archiviato || g.id===source.gruppo_id).map(g=>`<option value="${g.id}"${g.id===source.gruppo_id?' selected':''}>${esc(g.nome)}${g.archiviato?' (archiviato)':''}</option>`).join('')}</select></div><div class="field h"><label for="${prefix}-persona">Persona referente dalla rubrica</label><select id="${prefix}-persona"><option value="">Compila il referente a mano</option>${lista.map(c=>`<option value="${esc(c.chiave)}"${c.chiave===source.persona_chiave?' selected':''}>${esc(c.nome)}${c.email[0]?' · '+esc(c.email[0]):c.telefoni[0]?' · '+esc(c.telefoni[0]):''}</option>`).join('')}</select></div><p class="hint field">Il gruppo propone il referente abituale. Puoi sceglierne un altro per questa attività; i dati degli altri appuntamenti restano quelli salvati.</p>`;
  const gr=host.querySelector('select'),persona=host.querySelectorAll('select')[1];
  function opzioni(selected){
   const membri=new Set((S.gruppiPersone || []).filter(m=>m.gruppo_id===gr.value).map(m=>m.persona_chiave));
   const options=items=>items.map(c=>`<option value="${esc(c.chiave)}">${esc(c.nome)}${c.email[0]?' · '+esc(c.email[0]):c.telefoni[0]?' · '+esc(c.telefoni[0]):''}</option>`).join('');
   const interne=lista.filter(c=>membri.has(c.chiave)),altre=lista.filter(c=>!membri.has(c.chiave));
   persona.innerHTML='<option value="">Compila il referente a mano</option>'+(interne.length?`<optgroup label="Persone del gruppo">${options(interne)}</optgroup>`:'')+(altre.length?`<optgroup label="Altre persone della rubrica">${options(altre)}</optgroup>`:'');
   persona.value=selected || '';
  }
  opzioni(source.persona_chiave);

  const applica=()=>{const c=lista.find(c=>c.chiave===persona.value);onPersona(c ? dto(c) : {nome:'',telefono:'',email:''},S.gruppi.find(g=>g.id===gr.value));};
  persona.onchange=applica;
  gr.onchange=()=>{const g=S.gruppi.find(g=>g.id===gr.value);opzioni(g?.referente_chiave);applica();};
 }
 async function leggi(host){
  const selects=host.querySelectorAll('select');if(selects.length!==2)return {};
  const gruppo_id=selects[0].value || null,persona_chiave=selects[1].value || null;
  if(persona_chiave && !getState().rubrica.some(c=>c.chiave===persona_chiave)){
   const c=persone().find(c=>c.chiave===persona_chiave);if(!c)throw new Error('Contatto non più disponibile: ricarica la rubrica');
   const {error}=await client().from('rubrica').upsert(dto(c),{onConflict:'chiave',ignoreDuplicates:true});if(error)throw error;
  }
  return {gruppo_id,persona_chiave};
 }
 return {render,collega,leggi};
}
