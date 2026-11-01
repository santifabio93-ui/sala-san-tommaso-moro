// Stati operativi condivisi: i dati mancanti non diventano mai un semaforo verde.
export const COMPITI = { volontari: 'Volontari', tecnico: 'Tecnico e attrezzature', chiavi: 'Apertura e chiavi', allestimento: 'Allestimento', cassa: 'Postazione cassa' };
export const STATI_PREPARAZIONE = { da_fare: 'Da fare', in_corso: 'In corso', pronto: 'Pronto', non_serve: 'Non serve', problema: 'Problema' };
const colore = { da_fare: 'giallo', in_corso: 'giallo', pronto: 'verde', non_serve: 'neutro', problema: 'rosso' };
export const chiaveEvento = e => e.film_id ? 'p:' + e.id : 'b:' + e.id;

export function analizzaPreparazione(S, e, h) {
 const proiezione = !!e.film_id, voci = [], chiave = chiaveEvento(e);
 const add = (id, titolo, tono, testo, href) => voci.push({ id, titolo, tono, testo, href });
 const sconosciuto = (id, titolo, href) => add(id, titolo, 'ignoto', 'Dati non disponibili', href);
 const link = proiezione ? '#cinema' : '#evento/' + e.id;
 if (proiezione) {
  if(S.loadErr?.proiezioni)sconosciuto('conferma','Programmazione','#cinema');
  else add('conferma', 'Programmazione', 'verde', 'Proiezione in programma', '#cinema');
  const f = S.films.find(f => f.id === e.film_id);
  if (S.loadErr?.films || !f) sconosciuto('informazioni', 'Supporto e prova', '#cinema');
  else add('informazioni', 'Supporto e prova', f.prova_esito === 'problemi' ? 'rosso' : f.acquisizione === 'disponibile' && f.prova_esito === 'ok' && f.provato_il ? 'verde' : 'giallo',
   f.prova_esito === 'problemi' ? 'Problemi nella prova di proiezione' : f.acquisizione !== 'disponibile' ? 'Supporto da procurare o in arrivo' : !f.provato_il || f.prova_esito !== 'ok' ? 'Prova di proiezione da completare' : 'Supporto disponibile e prova riuscita', '#cinema');
 } else {
  if (S.loadErr?.bookings) sconosciuto('conferma', 'Conferma evento', link);
  else add('conferma', 'Conferma evento', e.stato === 'confermata' ? 'verde' : e.stato === 'annullata' ? 'rosso' : 'giallo', e.stato === 'confermata' ? 'Evento confermato' : e.stato === 'annullata' ? 'Evento annullato' : 'Prenotazione ancora in opzione', link);
  if (S.canWrite) {
   const s = h.schedaDi(e);
   if (e.della_sala) {
    const r = S.organizzazioneSala?.find(r => r.booking_id === e.id);
    if (S.loadErr2?.organizzazioneSala) sconosciuto('informazioni', 'Informazioni evento', link);
    else add('informazioni', 'Informazioni evento', r?.interni_completi && r.verificata_il ? 'verde' : 'giallo', !r?.interni_completi ? 'Programma e referente interno da completare' : !r.verificata_il ? 'Esigenze da confermare dalla Sala' : 'Programma ed esigenze confermati', link);
   } else if (S.loadErr?.schede) sconosciuto('informazioni', 'Scheda di richiesta', link);
   else if (s) add('informazioni', 'Scheda di richiesta', s.stato === 'respinta' || s.sicurezza === 'non_compatibile' ? 'rosso' : ['approvata','non_serve'].includes(s.stato) ? 'verde' : 'giallo',
    ({approvata:'Scheda approvata',non_serve:'Scheda non richiesta',compilata:'Risposte da verificare',respinta:'Risposte da correggere',inviata:'In attesa di compilazione',aperta:'In attesa di compilazione',da_inviare:'Scheda da inviare'})[s.stato] || 'Scheda da verificare', link);
   else if (h.isRecurring(e) || /cinema|proiezion|cineforum/i.test((e.tipo || '') + ' ' + e.titolo)) add('informazioni','Scheda di richiesta','neutro','Non prevista per questo tipo di evento',link);
   else add('informazioni','Scheda di richiesta','giallo','Scheda da richiedere',link);
  }
  if (S.loadErr?.signups || S.loadErr?.bookings) sconosciuto('turni','Volontari','#turni/' + e.id);
  else {
   const c = h.coverage(e), n = Math.max(0, c.need - c.have);
   add('turni','Volontari',!c.need || n ? 'giallo' : 'verde', !c.need ? 'Turni da pianificare' : n ? `${n} ${n === 1 ? 'posto da coprire' : 'posti da coprire'}` : 'Tutti i posti coperti','#turni/' + e.id);
  }
 }
 for (const [id,titolo] of Object.entries(COMPITI)) {
  if(id === 'volontari' && !proiezione)continue;
  const r = (S.preparazione || []).find(r => r.compito === id && (proiezione ? r.proiezione_id === e.id : r.booking_id === e.id));
  if (!S.datiCaricati || S.loadErr2?.preparazione) voci.push({id,titolo,tono:'ignoto',testo:'Dati non disponibili',manuale:true,href:link});
  else {
   const spostato = r && (r.data_evento !== e.data || r.ora_evento?.slice(0,5) !== (e.ora || e.inizio)?.slice(0,5));
   const stato = r?.stato || 'da_fare';
   voci.push({ id,titolo,tono:spostato ? 'ignoto' : colore[stato] || 'ignoto',testo:spostato ? 'Evento spostato: ricontrollare' : STATI_PREPARAZIONE[stato] || 'Da verificare',responsabile:r?.responsabile || '',record:r,manuale:true,href:link });
  }
 }
 const aperte = voci.filter(v => ['rosso','giallo','ignoto'].includes(v.tono));
 const tono = voci.some(v => v.tono === 'rosso') ? 'rosso' : voci.some(v => v.tono === 'ignoto') ? 'ignoto' : aperte.length ? 'giallo' : 'verde';
 return { chiave,voci,aperte,tono,testo:tono === 'verde' ? S.canWrite ? 'Preparazione completa' : 'Preparazione operativa completa' : tono === 'rosso' ? 'Problemi da risolvere' : tono === 'ignoto' ? 'Verifiche da completare' : `${aperte.length} ${aperte.length === 1 ? 'voce da preparare' : 'voci da preparare'}` };
}

export function creaPreparazione({ client,getState,helpers,esc,onChange,toast }) {
 const statoHTML = (tono,testo) => `<span class="prep-stato prep-${tono}"><i aria-hidden="true"></i>${esc(testo)}</span>`;
 const trova = chiave => { const [tipo,id] = chiave.split(':'); return (tipo === 'p' ? getState().proiezioni : getState().bookings).find(e => e.id === id); };
 const analizza = e => analizzaPreparazione(getState(),e,helpers);
 function pannello(e) {
  const S = getState(), p = analizza(e), annullato = e.stato === 'annullata';
  const apriDati = v => {
   if(e.film_id || v.id === 'turni')return `<a class="btn sm ghost" href="${v.href}">${e.film_id ? 'Apri cinema' : 'Apri turni'}</a>`;
   if(!S.canWrite || annullato || v.tono === 'ignoto')return '';
   const s = helpers.schedaDi(e);
   const azione = v.id === 'conferma' ? 'edit' : e.della_sala ? 'organizzazione' : s ? 'document' : helpers.isRecurring(e) || /cinema|proiezion|cineforum/i.test((e.tipo || '') + ' ' + e.titolo) ? 'documenti' : 'send-document';
   return `<button class="btn sm ghost" type="button" data-event-action="${azione}">${v.id === 'conferma' ? 'Rivedi evento' : e.della_sala ? 'Apri organizzazione' : s ? 'Apri scheda' : azione === 'documenti' ? 'Vedi dettagli' : 'Prepara scheda'}</button>`;
  };
  return `<section class="panel prep-panel" id="evento-preparazione" aria-labelledby="prep-title"><div class="section-head"><h3 id="prep-title">Preparazione evento</h3>${statoHTML(p.tono,annullato ? 'Evento annullato' : p.testo)}</div>
   <p class="hint">Conferma, informazioni e volontari si aggiornano dai dati dell’app. Le altre voci sono confermate dal responsabile.${!S.canWrite ? ' Le note interne restano riservate.' : ''}</p>
   ${S.loadErr2?.preparazione ? `<p class="warn">Preparazione non disponibile.${S.canWrite ? ' Verifica che sia stato eseguito l’aggiornamento 044_preparazione_eventi.sql e riprova.' : ' Chiedi al responsabile della Sala.'}</p>` : ''}
   <div class="prep-voci">${p.voci.map(v => `<div class="prep-voce" data-prep-voce="${v.id}"><div><b>${esc(v.titolo)}</b>${statoHTML(v.tono,v.testo)}${v.responsabile ? `<p class="hint">Se ne occupa: ${esc(v.responsabile)}</p>` : v.manuale && v.record?.stato !== 'non_serve' ? '<p class="hint">Responsabile da assegnare</p>' : ''}${S.canWrite && v.record?.note ? `<p class="prep-note">${esc(v.record.note)}</p>` : ''}</div>
   ${v.manuale ? S.canWrite && !annullato ? `<button type="button" class="btn sm" data-prep-compito="${v.id}" data-prep-evento="${p.chiave}"${!S.datiCaricati || S.loadErr2?.preparazione ? ' disabled' : ''}>Aggiorna</button>` : '' : apriDati(v)}</div>`).join('')}</div></section>`;
 }
 function scheda(e) {
  const S = getState(), p = analizza(e), proiezione = !!e.film_id, f = proiezione && S.films.find(f => f.id === e.film_id);
  const titolo = proiezione ? f?.titolo || 'Proiezione' : e.titolo;
  const persone = !proiezione && !S.loadErr?.signups ? helpers.turni(e).map(t => ({...t,persone:helpers.signupsFor(e.id,t.id)})) : [];
  const r = S.canWrite && !proiezione ? S.organizzazioneSala?.find(r => r.booking_id === e.id) : null;
  const referente = S.canWrite && !proiezione ? r?.interni?.referente_interno || e.referente : '';
  return `<article class="panel sala-evento" data-oggi-evento="${p.chiave}"><div class="section-head"><span class="eyebrow">${proiezione ? esc(e.ora) + ' · Cinema' : e.giornata_intera ? 'Tutta la giornata' : esc(e.inizio + '–' + e.fine)}</span>${statoHTML(p.tono,p.testo)}</div><h3>${esc(titolo)}</h3>
   ${referente ? `<p class="hint">Referente: ${esc(referente)}</p>` : ''}
   <div class="prep-semafori">${p.voci.map(v => `<span title="${esc(v.titolo + ': ' + v.testo)}">${statoHTML(v.tono,v.titolo + ' · ' + (v.manuale ? v.testo : ({verde:'OK',giallo:'Da completare',rosso:'Problema',ignoto:'Da verificare',neutro:'Non prevista'})[v.tono]))}</span>`).join('')}</div>
   ${persone.length ? `<div class="sala-persone">${persone.map(t => `<p><b>${esc(t.label)}</b> <span class="hint">${esc(t.inizio)}–${esc(t.fine)}</span><br>${t.persone.length ? t.persone.map(s => esc(s.nome)).join(' · ') : '<span class="hint">Nessuno ancora assegnato</span>'}</p>`).join('')}</div>` : ''}
   ${p.aperte.length ? `<p class="sala-manca"><b>Da preparare:</b> ${esc(p.aperte.slice(0,3).map(v => v.titolo + ': ' + v.testo + (v.responsabile ? ' · ' + v.responsabile : '')).join(', '))}${p.aperte.length > 3 ? '…' : ''}</p>` : ''}
   <div class="actions"><a class="btn${proiezione ? '' : ' primary'}" href="${proiezione ? '#cinema' : '#evento/' + e.id}">${proiezione ? 'Apri cinema' : 'Apri scheda evento'}</a>${proiezione ? `<button class="btn primary" type="button" data-prep-apri="${p.chiave}">Preparazione</button>` : `<a class="btn" href="#turni/${e.id}">Turni</a>`}</div></article>`;
 }
 function collega(root) {
  root.querySelectorAll('[data-prep-compito]').forEach(b => b.onclick = () => { const e = trova(b.dataset.prepEvento); if(e) modifica(e,b.dataset.prepCompito); });
  root.querySelectorAll('[data-prep-apri]').forEach(b => b.onclick = () => { const e = trova(b.dataset.prepApri); if(e) apri(e); });
 }
 const dialog = document.createElement('dialog'); dialog.id = 'dlg-preparazione'; dialog.setAttribute('aria-label','Preparazione evento'); document.body.append(dialog);
 dialog.addEventListener('click', ev => { if(ev.target.closest('a'))dialog.close(); });
 function apri(e) {
  dialog.innerHTML = `<div class="section-head"><h2>Preparazione proiezione</h2><button class="btn ghost" type="button" data-prep-chiudi>Chiudi</button></div>${pannello(e)}`;
  dialog.querySelector('[data-prep-chiudi]').onclick = () => dialog.close(); collega(dialog); if(!dialog.open)dialog.showModal();
 }
 function modifica(e,compito) {
  const S = getState(); if(!S.canWrite || S.loadErr2?.preparazione || !S.datiCaricati)return;
  const r = analizza(e).voci.find(v => v.id === compito)?.record;
  const nomi = [...new Set([...(S.volontari || []).filter(v => v.attivo).map(v => v.nome),...(S.profiles || []).filter(p => ['admin','coordinatore','segreteria'].includes(p.ruolo)).map(p => p.nome)])].filter(Boolean).sort();
  dialog.innerHTML = `<form id="prep-form"><h2>${esc(COMPITI[compito])}</h2><p>${esc(e.film_id ? S.films.find(f => f.id === e.film_id)?.titolo : e.titolo)}</p><div class="form"><div class="field"><label for="prep-stato">Stato</label><select id="prep-stato">${Object.entries(STATI_PREPARAZIONE).map(([k,v]) => `<option value="${k}"${k === (r?.stato || 'da_fare') ? ' selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label for="prep-responsabile">Chi se ne occupa</label><input id="prep-responsabile" list="prep-persone" maxlength="120" value="${esc(r?.responsabile || '')}" placeholder="Scegli o scrivi un nome"><datalist id="prep-persone">${nomi.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist><span class="hint">Il nome è visibile ai volontari; non invia notifiche.</span></div><div class="field"><label for="prep-note">Note interne per i responsabili</label><textarea id="prep-note" maxlength="2000">${esc(r?.note || '')}</textarea></div></div><p class="hint">${compito === 'volontari' ? 'Controlla i turni della serata e conferma qui la copertura di questa proiezione.' : compito === 'cassa' ? 'Indica se la postazione è pronta: questo stato non apre la cassa e non registra incassi.' : 'Segna “Non serve” quando questa attività non è necessaria per l’evento.'}</p><p id="prep-error" role="alert"></p><div class="actions"><button class="btn primary" type="submit">Salva preparazione</button><button class="btn" type="button" id="prep-annulla">Annulla</button></div></form>`;
  const form = dialog.querySelector('form'); let salvando = false;
  dialog.oncancel = ev => { if(salvando)ev.preventDefault(); };
  dialog.querySelector('#prep-annulla').onclick = () => dialog.close();
  form.onsubmit = async ev => {
   ev.preventDefault(); salvando = true; form.querySelectorAll('button').forEach(b => b.disabled = true);
   try {
    const {error} = await client().rpc('preparazione_salva',{p_booking:e.film_id ? null : e.id,p_proiezione:e.film_id ? e.id : null,p_compito:compito,p_data:e.data,p_ora:e.ora || e.inizio,p_stato:form.querySelector('#prep-stato').value,p_responsabile:form.querySelector('#prep-responsabile').value.trim(),p_note:form.querySelector('#prep-note').value.trim(),p_revisione:r?.revisione || null});
    if(error)throw error;
    dialog.close(); await onChange(); toast('Preparazione aggiornata');
   } catch(error) { form.querySelector('#prep-error').textContent = error.message || 'Salvataggio non riuscito. Riprova.'; }
   finally { salvando = false; form.querySelectorAll('button').forEach(b => b.disabled = false); }
  };
  if(!dialog.open)dialog.showModal();
 }
 return {analizza,pannello,scheda,collega};
}
