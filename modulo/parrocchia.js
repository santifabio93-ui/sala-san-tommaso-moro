// Il percorso deriva dalla scheda assegnata dal gestore, mai da un parametro del link.
export function avviaParrocchia({ info, token, sb, esc, fmtData, mostra, BOZZA, rigaOrari }) {
  const tipi = [['consiglio_pastorale','Consiglio pastorale'],['catechismo','Catechismo'],['conferenza','Conferenza o incontro parrocchiale'],['fidanzati','Corso fidanzati'],['altra_parrocchia','Altra attività parrocchiale da valutare']];
  if (info.chiusa) { mostra(`<div class="esito"><h2>Richiesta parrocchiale approvata</h2><p>Utilizzo gratuito. Per modificare gli incontri contattate chi gestisce la sala.</p><p>Orari di occupazione della sala, inclusi preparazione e riordino.</p>${!info.incontri?.length ? '<p>Nessun incontro presente in calendario: contattate la sala.</p>' : ''}<ul>${(info.incontri || []).map((o) => `<li>${esc(fmtData(o.data))} · ${esc(o.inizio)}–${esc(o.fine)}${o.stato === 'annullata' ? ' · annullato' : ''}</li>`).join('')}</ul></div>`); return; }
  let d = info.dati || {};
  try { const draft = JSON.parse(localStorage.getItem(BOZZA) || 'null'); if (draft && !info.compilata_il) d = { ...d, ...draft }; } catch {}
  const input = (name, label, value = '', type = 'text', required = false) => `<div class="campo"><label for="p-${name}" class="${required ? 'obbl' : ''}">${label}</label><input id="p-${name}" name="${name}" type="${type}" value="${esc(value ?? '')}"${required ? ' required' : ''}></div>`;
  const radio = (name, label, options, selected) => `<div class="campo full"><span class="lbl obbl">${label}</span><div class="scelte">${options.map(([value, text]) => `<label><input type="radio" name="${name}" value="${value}"${value === selected ? ' checked' : ''}> ${text}</label>`).join('')}</div></div>`;
  const orari = d.orari?.length ? d.orari : [{ data: info.data || '', inizio: info.inizio || '', fine: info.fine || '' }];
  const stato = info.stato === 'compilata' ? 'Richiesta ricevuta, in attesa di approvazione. Potete correggerla e reinviarla.' : info.stato === 'respinta' ? 'La sala ha chiesto chiarimenti: controllate la richiesta e reinviatela.' : 'L’invio non conferma la prenotazione: tutti gli incontri devono essere approvati dalla sala.';
  mostra(`<div class="ok-note"><h2>Attività della Parrocchia</h2><p>Parrocchia di San Biagio · utilizzo sempre gratuito.</p></div><p class="warn" role="status">${stato}</p><p>Per consiglio pastorale, catechismo, conferenze e corso fidanzati della Parrocchia. Le feste private sono escluse; i corsi esterni non sono attivi.</p>
    <form id="parrocchia-form" novalidate>
      <section class="sez"><h2>1 · Gruppo e responsabili</h2><p>I dati anagrafici della Parrocchia sono già predisposti: non occorrono codice fiscale e indirizzo del singolo gruppo.</p><div class="griglia">
      ${radio('attivita_parrocchiale','Attività',tipi,d.attivita_parrocchiale)}${input('gruppo','Gruppo o associazione della Parrocchia',d.gruppo,'text',true)}${input('titolo','Titolo dell’attività',d.titolo || info.titolo,'text',true)}
      ${input('referente','Referente',d.referente || info.referente,'text',true)}${input('cellulare','Cellulare del referente',d.cellulare || info.telefono,'tel',true)}${input('email','Email del referente',d.email || info.email,'email')}
      <label class="accetta full"><input type="checkbox" name="stesso_responsabile"${d.stesso_responsabile !== false ? ' checked' : ''}> Il referente sarà anche il responsabile presente agli incontri</label>
      <div id="parrocchia-responsabile" class="full"><div class="griglia">${input('resp_sera','Responsabile presente',d.resp_sera,'text',true)}${input('resp_cell','Cellulare del responsabile',d.resp_cell,'tel',true)}</div></div>
      <div class="campo full"><label for="p-descrizione">Descrizione (obbligatoria per altre attività)</label><textarea id="p-descrizione" name="descrizione">${esc(d.descrizione || '')}</textarea></div></div></section>
      <section class="sez"><h2>2 · Incontri richiesti</h2><p class="hint">Da 1 a 52 incontri. Indicate anche preparazione e riordino: la disponibilità sarà verificata prima dell’approvazione.</p><div id="orari">${orari.map(rigaOrari).join('')}</div><button class="btn sm" type="button" id="parrocchia-aggiungi">+ Aggiungi un incontro</button></section>
      <section class="sez"><h2>3 · Partecipanti e spazio</h2><div class="griglia">
      ${radio('fascia','Spazio richiesto',[['galleria','Galleria (fino a 134)'],['platea','Platea (fino a 338)'],['tutta','Platea e galleria (fino a 472)']],d.fascia)}${input('pubblico_n','Numero previsto di partecipanti',d.pubblico_n,'number',true)}
      ${radio('minori','Sono presenti minori?',[['si','Sì'],['no','No']],d.minori)}<div class="campo full"><label for="p-accessibilita">Esigenze di accessibilità</label><textarea id="p-accessibilita" name="accessibilita" placeholder="Indicate le esigenze, senza nomi o dati sanitari dei partecipanti.">${esc(d.accessibilita || '')}</textarea></div></div></section>
      <section class="sez"><h2>4 · Attrezzature ed esigenze</h2><div class="voci">${[['proiettore','Proiettore'],['audio','Impianto audio / microfoni'],['tavolo','Tavolo relatori']].map(([name,text]) => `<label class="voce"><input type="checkbox" name="${name}"${d[name] ? ' checked' : ''}> ${text}</label>`).join('')}</div>
      ${radio('siae','Sono previste musica, proiezioni o altre opere protette?',[['si','Sì'],['no','No']],d.siae)}<div id="parrocchia-opere" class="campo"><label for="p-siae_opere">Quali opere o proiezioni?</label><textarea id="p-siae_opere" name="siae_opere">${esc(d.siae_opere || '')}</textarea><p class="hint">La gratuità non esonera dalla verifica dei diritti: la sala valuterà le autorizzazioni necessarie.</p></div>
      <div class="campo"><label for="p-altre_esigenze">Altre attrezzature o esigenze tecniche da valutare</label><textarea id="p-altre_esigenze" name="altre_esigenze">${esc(d.altre_esigenze || '')}</textarea></div></section>
      <section class="sez"><h2>5 · Regole e invio</h2><div class="regole"><p>Capienze e vie di uscita vanno rispettate. Uscite e percorsi devono restare liberi. Impianti e attrezzature si usano con il personale della sala. Non sono ammessi fiamme, fumo, cibo e bevande in sala. I passeggini non sono ammessi; sono ammesse carrozzine per persone con disabilità e cani guida o di assistenza. A fine incontro la sala va lasciata in ordine entro l’orario di riordino.</p><a href="scheda-manifestazioni.html" target="_blank" rel="noopener">Leggi le regole complete della sala</a></div>
      <label class="accetta"><input type="checkbox" name="ok_regole"${d.ok_regole ? ' checked' : ''}> Abbiamo letto le regole e ci impegniamo a rispettarle</label><label class="accetta"><input type="checkbox" name="ok_privacy"${d.ok_privacy ? ' checked' : ''}> I dati sono usati dalla Parrocchia di San Biagio per gestire la richiesta e gli incontri; non inserisco nomi o dati sanitari dei partecipanti</label>
      ${input('firma','Nome e cognome di chi invia',d.firma,'text',true)}</section><div id="errori" role="status"></div><div class="invia"><button class="btn primary" type="submit" id="parrocchia-invia">Invia richiesta per approvazione</button><span class="hint">Gratuita · nessuna prenotazione automatica</span></div></form>`);
  const form = document.getElementById('parrocchia-form');
  function leggi() {
    const result = {};
    for (const el of form.elements) {
      if (!el.name || el.name.startsWith('o_')) continue;
      if (el.type === 'radio') { if (el.checked) result[el.name] = el.value; }
      else result[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
    }
    if (result.stesso_responsabile) { result.resp_sera = result.referente; result.resp_cell = result.cellulare; }
    result.orari = [...form.querySelectorAll('.riga-orari')].map((row) => Object.fromEntries(['data','all_da','all_a','porte','inizio','fine','sgombero'].map((k) => [k,row.querySelector(`[name="o_${k}"]`).value])));
    result.ente = 'Parrocchia di San Biagio'; result.a_titolo = 'parrocchia'; result.tipo = 'conferenza';
    return result;
  }
  function salva() {
    document.getElementById('parrocchia-responsabile').hidden = form.elements.stesso_responsabile.checked;
    document.getElementById('parrocchia-opere').hidden = form.elements.siae.value !== 'si';
    document.getElementById('parrocchia-aggiungi').disabled = form.querySelectorAll('.riga-orari').length >= 52;
    try { localStorage.setItem(BOZZA, JSON.stringify(leggi())); } catch {}
  }
  form.addEventListener('input', salva); form.addEventListener('change', salva);
  document.getElementById('parrocchia-aggiungi').onclick = () => { const n = form.querySelectorAll('.riga-orari').length; if (n < 52) document.getElementById('orari').insertAdjacentHTML('beforeend',rigaOrari({},n)); salva(); };
  document.getElementById('orari').onclick = (e) => { const button = e.target.closest('[data-togli]'); if (button) { button.closest('.riga-orari').remove(); salva(); } };
  salva();
  form.onsubmit = async (e) => {
    e.preventDefault(); const dati = leggi(), errori = document.getElementById('errori'), button = document.getElementById('parrocchia-invia');
    if (!dati.firma || dati.firma.length < 3) { errori.textContent = 'Indica nome e cognome di chi invia.'; return; }
    button.disabled = true; errori.textContent = 'Invio in corso…';
    const { error } = await sb.rpc('scheda_invia',{p_token:token,p_dati:dati,p_firma:dati.firma});
    if (error) { button.disabled = false; errori.textContent = 'Richiesta non inviata: ' + error.message; return; }
    try { localStorage.removeItem(BOZZA); } catch {}
    mostra(`<div class="esito"><h2>Richiesta inviata, in attesa di approvazione</h2><p>La sala deve verificare e approvare tutti gli incontri. Non sono ancora prenotati. L’utilizzo approvato sarà gratuito.</p><p>Potete correggere la richiesta riaprendo questo link, finché non sarà approvata.</p></div>`); window.scrollTo(0,0);
  };
}
