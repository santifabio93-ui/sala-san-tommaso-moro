import { TIPI_EVENTO_SALA, SEZIONI_PER_TIPO, SEZIONI_EVENTO_SALA, campoEventoSala } from './evento-sala-campi.js?v=2026-11-01.86';

// Tutte le scritture passano dalle RPC: il link pubblico riceve un DTO separato.
export function creaEventiSala({ client, getState, esc, onChange, openCopyText, promozione }) {
 const dialog = document.getElementById('dlg-evento-sala') || document.body.appendChild(Object.assign(document.createElement('dialog'), {id:'dlg-evento-sala'}));
 dialog.setAttribute('aria-label', 'Organizzazione della Sala');
 const stato = (r) => !r ? 'Da preparare' : !r.interni_completi ? 'Parte interna da completare' : r.verificata_il ? 'Esigenze confermate dalla Sala' : r.stato_ospite === 'da_compilare' ? 'In attesa dell’ospite' : 'Da verificare dalla Sala';
 const riepilogo = (d, sezioni) => sezioni.map(s => {
  const sezione = SEZIONI_EVENTO_SALA[s];
  const righe = sezione.campi.filter(([k]) => d[k] !== undefined && d[k] !== '').map(([k,l]) => `<div><dt>${l}</dt><dd>${esc(d[k])}</dd></div>`).join('');
  return righe ? `<h4>${sezione.titolo}</h4><dl class="es-dati">${righe}</dl>` : '';
 }).join('') + (d.documento_tecnico_url ? `<p>Documento tecnico: ${esc(d.documento_tecnico_url)}</p>` : '');
 const lettura = (r) => `<p><b>Referente interno:</b> ${esc(r.interni.referente_interno || 'Da indicare')}<br><b>Ospite:</b> ${esc(r.interni.ospite_nome || 'Da indicare')} · ${esc(r.interni.ospite_contatto || '')}</p><p class="es-testo">${esc(r.interni.programma || 'Programma da completare')}</p><p>${esc(r.interni.durata_minuti || '—')} minuti · ${esc(r.interni.pubblico_n || '—')} partecipanti attesi</p>${r.interni.accessibilita ? `<p>Accessibilità: ${esc(r.interni.accessibilita)}</p>` : ''}${r.interni.note_interne ? `<details><summary>Note interne riservate</summary><p class="es-testo">${esc(r.interni.note_interne)}</p></details>` : ''}
 <details><summary>Esigenze raccolte dal referente interno</summary>${riepilogo(r.tecnica_sala, SEZIONI_PER_TIPO[r.tipo]) || '<p>Nessuna esigenza tecnica indicata.</p>'}</details>
 ${r.sezioni_ospite.length ? `<details${r.stato_ospite === 'da_verificare' ? ' open' : ''}><summary>Parte dell’ospite · ${r.sezioni_ospite.map(s => SEZIONI_EVENTO_SALA[s].titolo).join(', ')}</summary>${r.stato_ospite === 'da_compilare' ? '<p>Non ancora inviata.</p>' : `<p>Compilata da ${esc(r.ospite_nome)} · ${esc(r.ospite_contatto)}</p>${riepilogo(r.ospite_dati,r.sezioni_ospite)}`}</details>` : ''}
 ${r.verificata_il ? `<details><summary>Esigenze confermate</summary>${riepilogo(r.tecnica_confermata || {}, SEZIONI_PER_TIPO[r.tipo]) || '<p>Nessuna esigenza tecnica particolare.</p>'}</details>` : ''}`;
 async function carica(b) {
  const { data, error } = await client().from('eventi_sala').select('*').eq('booking_id', b.id).maybeSingle();
  if (error) throw error;
  return data;
 }
 async function renderPanel(b, host) {
  if (!getState().canWrite || !b.della_sala || b.stato === 'annullata') return;
  host.innerHTML = '<section class="panel es-panel"><h3>Organizzazione della Sala</h3><p>Caricamento informazioni…</p></section>';
  try {
   const r = await carica(b); if (!host.isConnected) return;
   host.innerHTML = `<section class="panel es-panel"><div class="section-head"><h3>Organizzazione della Sala</h3><span class="pill">${stato(r)}</span></div><p class="hint">${r ? TIPI_EVENTO_SALA[r.tipo] : 'Il referente interno raccoglie il programma e affida all’ospite soltanto le sezioni necessarie.'}</p>${r ? lettura(r) : ''}<div class="actions"><button class="btn" data-es="modifica">${r ? 'Modifica informazioni' : 'Prepara informazioni e invito'}</button>${r?.ospite_token ? '<button class="btn" data-es="invito">Prepara messaggio per l’ospite</button>' : ''}${r && !r.verificata_il ? '<button class="btn primary" data-es="conferma">Verifica e conferma esigenze</button>' : ''}${r?.verificata_il && r.interni.autorizza_promozione && getState().staff ? '<button class="btn" data-es="social">Prepara info per i social</button>' : ''}</div><p class="es-errore" role="alert"></p></section>`;
   host.querySelector('[data-es="modifica"]').onclick = () => apri(b,r,host);
   const invito = host.querySelector('[data-es="invito"]');
   if (invito) invito.onclick = () => {
    const url = new URL('modulo/ospite.html', location.href.split('#')[0]);
    url.search = new URLSearchParams({t:r.ospite_token,v:'2026-11-01.86'});
    openCopyText(`Ciao ${r.interni.ospite_nome || ''},\nper «${b.titolo}» del ${b.data} ti chiediamo di compilare queste parti: ${r.sezioni_ospite.map(s=>SEZIONI_EVENTO_SALA[s].titolo).join(', ')}.\n${url.href}\nLe esigenze saranno verificate dalla Sala prima della conferma. Grazie!`);
   };
   const conferma = host.querySelector('[data-es="conferma"]');
   if (conferma) conferma.onclick = async () => {
    conferma.disabled = true;
    const {error} = await client().rpc('evento_sala_conferma',{p_booking:b.id,p_revisione:r.revisione});
    if (error) { host.querySelector('.es-errore').textContent = error.message; conferma.disabled=false; }
    else { await renderPanel(b,host); onChange(); }
   };
   const social = host.querySelector('[data-es="social"]'); if (social) social.onclick = () => promozione(b,r.interni);
  } catch (error) {
   if (!host.isConnected) return;
   host.innerHTML = `<section class="panel"><h3>Organizzazione della Sala</h3><p role="alert">Informazioni non disponibili. Verifica che la migrazione 039 sia stata applicata e riprova.</p><button class="btn">Riprova</button></section>`;
   host.querySelector('button').onclick=()=>renderPanel(b,host);
  }
 }
 function apri(b,r,host) {
  let tipo = r?.tipo || 'conferenza', sezioni = new Set(r?.sezioni_ospite || []), tecnica = {...r?.tecnica_sala};
  const i = r?.interni || {referente_interno:getState().me?.nome || ''};
  const field = (k,l,type='text',max='') => `<div class="field${type==='textarea'?'':' h'}"><label for="es-${k}">${l}</label>${type==='textarea'?`<textarea id="es-${k}" data-interno="${k}" maxlength="5000">${esc(i[k] || '')}</textarea>`:`<input id="es-${k}" data-interno="${k}" type="${type}" value="${esc(i[k] || '')}" ${max}>`}</div>`;
  dialog.innerHTML = `<form id="es-form"><div class="dlg-head"><h2>Organizzazione della Sala</h2><button class="btn ghost" type="button" id="es-chiudi">Chiudi</button></div><p>${esc(b.titolo)} · ${esc(b.data)} · ${esc(b.inizio.slice(0,5))}–${esc(b.fine.slice(0,5))}</p><p class="hint">Puoi salvare anche una bozza. Per confermare servono referente interno, ospite e contatto, programma, durata e partecipanti attesi. Le date e gli accordi economici si gestiscono nella prenotazione.</p><div class="fields"><div class="field"><label for="es-tipo">Tipo di evento</label><select id="es-tipo">${Object.entries(TIPI_EVENTO_SALA).map(([k,v])=>`<option value="${k}"${k===tipo?' selected':''}>${v}</option>`).join('')}</select></div>${field('referente_interno','Referente interno alla Sala')}${field('ospite_nome','Ospite, gruppo o compagnia')}${field('ospite_contatto','Contatto dell’ospite')}${field('programma','Programma e accordi organizzativi','textarea')}${field('durata_minuti','Durata prevista (minuti)','number','min="1" max="1440" step="1"')}${field('pubblico_n','Partecipanti attesi','number','min="1" max="472" step="1"')}${field('accessibilita','Accessibilità e accoglienza','textarea')}${field('note_interne','Note e accordi riservati alla Sala','textarea')}</div><h3>Esigenze tecniche</h3><p class="hint">Compila ciò che serve oppure assegna la sezione all’ospite. Se cambi tipo o sezioni assegnate, il vecchio link viene revocato e le risposte dell’ospite vanno raccolte di nuovo.</p><div id="es-sezioni"></div><div class="field"><label for="es-documento">Link alla scheda tecnica (facoltativo)</label><input id="es-documento" type="url" value="${esc(tecnica.documento_tecnico_url || '')}"></div><details><summary>Materiali autorizzati per la promozione</summary><div class="fields">${field('descrizione_pubblica','Descrizione per il pubblico','textarea')}${field('nomi_pubblicabili','Nomi da pubblicare')}${field('materiali_pubblici','Link a locandina, foto o materiali','url')}</div><label><input id="es-promozione" type="checkbox"${i.autorizza_promozione?' checked':''}> Questi testi, nomi e materiali sono autorizzati per la promozione</label><p class="hint">Dopo la verifica potrai trasferirli alla scheda social con un’azione esplicita.</p></details><p id="es-error" class="es-errore" role="alert"></p><div class="actions"><button class="btn primary" id="es-salva" type="submit">Salva informazioni</button></div></form>`;
  const leggiTecnica = () => {
   dialog.querySelectorAll('[data-campo-tecnico]').forEach(el=> { if (el.value.trim() !== '') tecnica[el.dataset.campoTecnico]=el.value.trim(); else delete tecnica[el.dataset.campoTecnico]; });
  };
  function sezioniHtml() {
   dialog.querySelector('#es-sezioni').innerHTML = SEZIONI_PER_TIPO[tipo].map(s => `<details class="es-sezione" open><summary>${SEZIONI_EVENTO_SALA[s].titolo}</summary><label class="es-delega"><input type="checkbox" data-delega="${s}"${sezioni.has(s)?' checked':''}> Questa sezione la compila l’ospite</label><div class="fields"${sezioni.has(s)?' hidden':''}>${SEZIONI_EVENTO_SALA[s].campi.map(c=>campoEventoSala(c,tecnica[c[0]],esc)).join('')}</div>${sezioni.has(s)?'<p class="hint">Sarà compilata tramite il link personale dell’ospite.</p>':''}</details>`).join('');
   dialog.querySelectorAll('[data-delega]').forEach(el=>el.onchange=()=> {leggiTecnica(); if(el.checked)sezioni.add(el.dataset.delega);else sezioni.delete(el.dataset.delega);sezioniHtml();});
  }
  sezioniHtml();
  dialog.querySelector('#es-tipo').onchange = e => {
   leggiTecnica(); tipo=e.target.value; sezioni=new Set([...sezioni].filter(s=>SEZIONI_PER_TIPO[tipo].includes(s)));
   const allowed = new Set(SEZIONI_PER_TIPO[tipo].flatMap(s=>SEZIONI_EVENTO_SALA[s].campi.map(c=>c[0])));
   tecnica=Object.fromEntries(Object.entries(tecnica).filter(([k])=>allowed.has(k)||k==='documento_tecnico_url')); sezioniHtml();
  };
  dialog.querySelector('#es-chiudi').onclick=()=>dialog.close();
  dialog.querySelector('form').onsubmit = async e => {
   e.preventDefault(); leggiTecnica();
   tecnica.documento_tecnico_url=dialog.querySelector('#es-documento').value.trim();
   // Le sezioni delegate hanno una sola fonte: la risposta dell’ospite.
   const delegati = new Set([...sezioni].flatMap(s=>SEZIONI_EVENTO_SALA[s].campi.map(c=>c[0])));
   const propria=Object.fromEntries(Object.entries(tecnica).filter(([k])=>!delegati.has(k)));
   const interni=Object.fromEntries([...dialog.querySelectorAll('[data-interno]')].map(el=>[el.dataset.interno,el.value.trim()]));
   interni.autorizza_promozione=dialog.querySelector('#es-promozione').checked;
   const btn=dialog.querySelector('#es-salva'); btn.disabled=true;
   try {
    const {error}=await client().rpc('evento_sala_salva',{p_booking:b.id,p_tipo:tipo,p_interni:interni,p_tecnica:propria,p_sezioni:[...sezioni],p_revisione:r?.revisione || null});
    if(error)throw error;
    dialog.close(); await renderPanel(b,host); onChange();
   } catch(error){dialog.querySelector('#es-error').textContent=error.message;} finally{btn.disabled=false;}
  };
  dialog.showModal();
 }
 async function renderSerata(eventi,host) {
  const ids=eventi.filter(b=>b.della_sala).map(b=>b.id);
  if(!getState().canWrite || !ids.length)return;
  const {data,error}=await client().from('eventi_sala').select('*').in('booking_id',ids);
  if(!host.isConnected)return;
  if(error){host.textContent='Informazioni degli eventi Sala non disponibili.';return;}
  host.innerHTML=(data||[]).map(r=>`<article class="panel es-panel"><h3>${esc(eventi.find(b=>b.id===r.booking_id).titolo)} · organizzazione Sala</h3><p>${stato(r)}</p>${r.verificata_il ? `<p>Referente: ${esc(r.interni.referente_interno)} · ospite: ${esc(r.interni.ospite_nome)}</p><p class="es-testo">${esc(r.interni.programma)}</p>${riepilogo(r.tecnica_confermata || {},SEZIONI_PER_TIPO[r.tipo])}` : '<p class="hint">Consulta e completa la scheda evento prima di usare le esigenze operative.</p>'}<a href="#evento/${esc(r.booking_id)}">Apri la scheda evento</a></article>`).join('');
 }
 return {renderPanel,renderSerata};
}
