// Il percorso deriva dalla scheda assegnata dal gestore, mai da un parametro del link.
export function avviaParrocchia({ info, token, sb, esc, fmtData, mostra, BOZZA, rigaOrari }) {
  const tipi = [['consiglio_pastorale','Consiglio pastorale'],['catechismo','Catechismo'],['conferenza','Conferenza o incontro parrocchiale'],['fidanzati','Corso fidanzati'],['altra_parrocchia','Altra attività parrocchiale da valutare']];
  if (info.chiusa) {
    const d = info.dati || {}, spazi = { galleria: 'Galleria', platea: 'Platea con palco', tutta: 'Platea e galleria' };
    const disposizioni = { seduti: 'Riunione / conferenza con partecipanti seduti', tavolo: 'Riunione attorno a un tavolo', gruppi: 'Lavoro in piccoli gruppi', altro: 'Altro allestimento da concordare' };
    const siNo = (v) => v === 'si' || v === true ? 'Sì' : v === 'no' || v === false ? 'No' : 'Non indicato';
    const voce = (nome, valore) => `<dt>${esc(nome)}</dt><dd>${esc(valore || 'Non indicato nella richiesta')}</dd>`;
    const sezione = (titolo, righe) => `<section class="sez riepilogo-richiesta"><h3>${titolo}</h3><dl>${righe.map(([nome,valore]) => voce(nome,valore)).join('')}</dl></section>`;
    const dotazioni = [d.proiettore ? 'Proiettore e schermo' : '', d.audio ? 'Impianto audio' : '', d.mic_filo ? `${d.mic_filo_n || '?'} microfoni a filo` : '', d.radiomic ? `${d.radiomic_n || '?'} radiomicrofoni` : '', d.mic_tavolo ? `${d.mic_tavolo_n || '?'} microfoni da tavolo` : '', d.tavolo ? `Tavolo relatori (${d.tavolo_n || '?'} posti)` : '', d.luci ? 'Luci di scena' : '', d.sipario ? 'Sipario e quinte' : ''].filter(Boolean).join(' · ');
    const attuali = Array.isArray(info.incontri), incontri = attuali ? info.incontri : d.orari || [];
    mostra(`<div class="ok-note"><h2>Richiesta parrocchiale approvata</h2><p>Utilizzo gratuito. Il riepilogo è consultabile; per modificare o integrare le esigenze contattate chi gestisce la sala.</p></div>
      ${sezione('Attività e persone', [['Attività',Object.fromEntries(tipi)[d.attivita_parrocchiale]],['Gruppo',d.gruppo],['Titolo',d.titolo || info.titolo],['Cosa farete',d.descrizione],['Referente',d.referente],['Cellulare',d.cellulare],['Email',d.email],['Responsabile presente',[d.resp_sera,d.resp_cell].filter(Boolean).join(' · ')]])}
      <section class="sez"><h3>${attuali ? 'Orari di occupazione in calendario' : 'Orari indicati nella richiesta'}</h3><p>Compresi preparazione e riordino. Eventuali variazioni vanno concordate con la sala.</p>${incontri.length ? `<ul>${incontri.map((o) => `<li>${esc(fmtData(o.data))} · ${esc(o.inizio)}–${esc(o.fine)}${o.stato === 'annullata' ? ' · annullato' : ''}</li>`).join('')}</ul>` : '<p>Nessun incontro presente in calendario: contattate la sala.</p>'}</section>
      ${sezione('Sala e allestimento', [['Spazio richiesto',spazi[d.fascia] || d.fascia],['Come userete gli spazi scelti?',d.utilizzo_spazi],['Allestimento',disposizioni[d.disposizione]],['Dettagli e arredi',d.disposizione_dettagli],['Uso del palco',siNo(d.palco)],...(d.palco === 'si' ? [['Persone sul palco',d.palco_n],['Attività sul palco',d.palco_uso]] : []),['Partecipanti complessivi',d.pubblico_n],['Presenza di minori',siNo(d.minori)],['Accessibilità',d.accessibilita]])}
      ${sezione('Attrezzature ed esigenze dichiarate', [['Dotazioni richieste',dotazioni || 'Nessuna dotazione selezionata'],...(d.proiettore ? [['Contenuti da proiettare',d.contenuti_proiezione],['Dispositivo e collegamento',d.collegamento_video]] : []),...(d.audio ? [['Utilizzo dell’audio',d.audio_uso]] : []),['Gestione tecnica',d.tecnico === 'nostro' ? [d.tecnico_nome,d.tecnico_cell].filter(Boolean).join(' · ') : 'Uso semplice, senza tecnico proprio'],...(d.attrezzature === 'si' ? [['Attrezzature proprie',d.attrezzature_quali],['Potenza indicata',d.potenza_w ? d.potenza_w + ' W' : 'Non indicata']] : []),...(d.scenografie === 'si' ? [['Materiali e collocazione',d.scenografie_quali]] : []),['Musica o opere protette',siNo(d.siae)],...(d.siae === 'si' ? [['Opere previste',d.siae_opere]] : []),['Apertura, accoglienza e assistenza',d.esigenze_apertura],['Variazioni tra incontri',d.variazioni_incontri],['Altre esigenze',d.altre_esigenze]])}
      <p class="hint">Le dotazioni riportano le richieste presentate: per condizioni di approvazione e disponibilità concordate fate riferimento al gestore. Se un dettaglio non era stato compilato, viene indicato come mancante.</p>`);
    return;
  }
  let d = info.dati || {};
  try { const draft = JSON.parse(localStorage.getItem(BOZZA) || 'null'); if (draft && (!info.compilata_il || draft._bozza_compilata_il === info.compilata_il)) d = { ...d, ...draft }; } catch {}
  const stessoResponsabile = d.stesso_responsabile ?? (!d.resp_sera || (d.resp_sera === (d.referente || info.referente) && (!d.resp_cell || d.resp_cell === (d.cellulare || info.telefono))));
  const input = (name, label, value = '', type = 'text', required = false) => `<div class="campo"><label for="p-${name}" class="${required ? 'obbl' : ''}">${label}</label><input id="p-${name}" name="${name}" type="${type}" value="${esc(value ?? '')}"${required ? ' required' : ''}></div>`;
  const radio = (name, label, options, selected) => `<div class="campo full"><span class="lbl obbl">${label}</span><div class="scelte">${options.map(([value, text]) => `<label><input type="radio" name="${name}" value="${value}"${value === selected ? ' checked' : ''}> ${text}</label>`).join('')}</div></div>`;
  const testo = (name, label, value, placeholder = '', required = false) => `<div class="campo full"><label for="p-${name}" class="${required ? 'obbl' : ''}">${label}</label><textarea id="p-${name}" name="${name}" placeholder="${esc(placeholder)}">${esc(value || '')}</textarea></div>`;
  const dotazione = (name, label, number, max) => `<div class="campo"><label class="voce"><input type="checkbox" name="${name}"${d[name] ? ' checked' : ''}> ${label}</label>${number ? `<div id="parrocchia-${name}-numero">${input(number, name === 'tavolo' ? 'Posti al tavolo relatori (massimo ' + max + ')' : 'Quanti (massimo ' + max + ')', d[number], 'number', true)}</div>` : ''}</div>`;
  const orari = d.orari?.length ? d.orari : [{ data: info.data || '', inizio: info.inizio || '', fine: info.fine || '' }];
  const stato = info.stato === 'compilata' ? 'Richiesta ricevuta, in attesa di approvazione. Potete correggerla e reinviarla.' : info.stato === 'respinta' ? 'La sala ha chiesto chiarimenti: controllate la richiesta e reinviatela.' : 'L’invio non conferma la prenotazione: tutti gli incontri devono essere approvati dalla sala.';
  mostra(`<div class="ok-note"><h2>Attività della Parrocchia</h2><p>Parrocchia di San Biagio · utilizzo sempre gratuito.</p></div><p class="warn" role="status">${stato}</p><p>Per consiglio pastorale, catechismo, conferenze e corso fidanzati della Parrocchia. Le feste private sono escluse; i corsi esterni non sono attivi.</p>
    <form id="parrocchia-form" novalidate>
      <section class="sez"><h2>1 · Gruppo e responsabili</h2><p>I dati anagrafici della Parrocchia sono già predisposti: non occorrono codice fiscale e indirizzo del singolo gruppo.</p><div class="griglia">
      ${radio('attivita_parrocchiale','Attività',tipi,d.attivita_parrocchiale)}${input('gruppo','Gruppo o associazione della Parrocchia',d.gruppo,'text',true)}${input('titolo','Titolo dell’attività',d.titolo || info.titolo,'text',true)}
      ${input('referente','Referente',d.referente || info.referente,'text',true)}${input('cellulare','Cellulare del referente',d.cellulare || info.telefono,'tel',true)}${input('email','Email del referente',d.email || info.email,'email')}
      <label class="accetta full"><input type="checkbox" name="stesso_responsabile"${stessoResponsabile ? ' checked' : ''}> Il referente sarà anche il responsabile presente agli incontri</label>
      <div id="parrocchia-responsabile" class="full"><div class="griglia">${input('resp_sera','Responsabile presente',d.resp_sera,'text',true)}${input('resp_cell','Cellulare del responsabile',d.resp_cell,'tel',true)}</div></div>
      <div class="campo full"><label for="p-descrizione" class="obbl">Descrivete concretamente cosa farete</label><textarea id="p-descrizione" name="descrizione" placeholder="Spiegate lo svolgimento dell’incontro: argomenti, attività dei partecipanti, interventi, momenti di preghiera o proiezioni. Non basta il nome del gruppo.">${esc(d.descrizione || '')}</textarea></div></div></section>
      <section class="sez"><h2>2 · Incontri richiesti</h2><p class="hint">Da 1 a 52 incontri. Indicate anche preparazione e riordino: la disponibilità sarà verificata prima dell’approvazione.</p><div id="orari">${orari.map(rigaOrari).join('')}</div><button class="btn sm" type="button" id="parrocchia-aggiungi">+ Aggiungi un incontro</button></section>
      <section class="sez"><h2>3 · Sala, utilizzo e allestimento</h2><div class="griglia">
      ${radio('fascia','Spazio richiesto',[['galleria','Galleria (fino a 134)'],['platea','Platea (fino a 338)'],['tutta','Platea e galleria (fino a 472)']],d.fascia)}${testo('utilizzo_spazi','Come userete gli spazi scelti?',d.utilizzo_spazi,'Indicate dove si svolgeranno le attività, se lavorerete tutti insieme o in gruppi e come saranno usati platea e galleria.',true)}${radio('disposizione','Allestimento richiesto',[['seduti','Riunione / conferenza con partecipanti seduti'],['tavolo','Riunione attorno a un tavolo'],['gruppi','Lavoro in piccoli gruppi'],['altro','Altro allestimento da concordare']],d.disposizione)}${testo('disposizione_dettagli','Dettagli dell’allestimento e altri arredi richiesti',d.disposizione_dettagli,'Indicate disposizione e quantità di tavoli o altri arredi richiesti; la disponibilità deve essere verificata.')}${radio('palco','Serve utilizzare il palco?',[['si','Sì, in platea'],['no','No']],d.palco)}<div id="parrocchia-palco" class="full"><div class="griglia">${input('palco_n','Persone previste sul palco',d.palco_n,'number',true)}${testo('palco_uso','Come sarà usato il palco?',d.palco_uso,'Relatori, presentazione, attività o altro utilizzo da valutare.',true)}</div></div><p class="hint full">La galleria è destinata a conferenze e incontri e non dispone del palco. Eventuali altri spazi non sono inclusi automaticamente.</p>${input('pubblico_n','Partecipanti complessivi, compresi organizzatori e relatori',d.pubblico_n,'number',true)}
      ${input('carrozzina_n','Persone in carrozzina (se noto)',d.carrozzina_n,'number')}
      ${radio('minori','Sono presenti minori?',[['si','Sì'],['no','No']],d.minori)}<div class="campo full"><label for="p-accessibilita">Esigenze di accessibilità</label><textarea id="p-accessibilita" name="accessibilita" placeholder="Indicate le esigenze, senza nomi o dati sanitari dei partecipanti.">${esc(d.accessibilita || '')}</textarea></div></div></section>
      <section class="sez"><h2>4 · Attrezzature e assistenza tecnica</h2><p class="hint">Indicate tutto ciò che chiedete alla sala. La richiesta non conferma disponibilità di attrezzature o personale.</p><div class="griglia">
      ${dotazione('proiettore','Proiettore e schermo (HDMI)')}
      <div id="parrocchia-proiezione" class="full"><div class="griglia">${testo('contenuti_proiezione','Che cosa sarà proiettato?',d.contenuti_proiezione,'Slide, video, film o altri materiali. Indicate anche chi li prepara.',true)}${input('collegamento_video','Dispositivo e collegamento da usare',d.collegamento_video,'text',true)}</div></div>
      ${dotazione('audio','Impianto audio')}
      <div id="parrocchia-audio" class="full"><div class="griglia">${testo('audio_uso','Per che cosa serve l’audio?',d.audio_uso,'Voce dei relatori, musica registrata, video o altro.',true)}${dotazione('mic_filo','Microfoni a filo','mic_filo_n',5)}${dotazione('radiomic','Radiomicrofoni','radiomic_n',2)}${dotazione('mic_tavolo','Microfoni da tavolo','mic_tavolo_n',3)}</div></div>
      ${dotazione('tavolo','Tavolo relatori','tavolo_n',10)}${dotazione('luci','Luci di scena')}${dotazione('sipario','Sipario e quinte')}
      ${radio('tecnico','Gestione tecnica',[['nessuno','Uso semplice, senza un nostro tecnico'],['nostro','Portiamo un nostro tecnico']],d.tecnico)}<p class="hint full">La sala non ha un tecnico da assegnare automaticamente. Impianti e attrezzature si usano con il personale della sala; l’assistenza va concordata.</p>
      <div id="parrocchia-tecnico" class="full"><div class="griglia">${input('tecnico_nome','Nome del tecnico',d.tecnico_nome,'text',true)}${input('tecnico_cell','Cellulare del tecnico',d.tecnico_cell,'tel',true)}</div></div>
      ${radio('attrezzature','Portate attrezzature elettriche vostre?',[['no','No'],['si','Sì']],d.attrezzature)}<div id="parrocchia-attrezzature" class="full"><div class="griglia">${testo('attrezzature_quali','Quali attrezzature portate e come saranno collegate?',d.attrezzature_quali,'PC, mixer, amplificatori o altro: indicate tipo e quantità.',true)}${input('potenza_w','Potenza complessiva in Watt (se nota)',d.potenza_w,'number')}</div></div>
      ${radio('scenografie','Portate materiali, decorazioni, pannelli o scenografie?',[['no','No'],['si','Sì']],d.scenografie)}<div id="parrocchia-materiali" class="full">${testo('scenografie_quali','Descrivete materiali e collocazione',d.scenografie_quali,'Indicate ingombro, posizione e modalità di montaggio. Non sono ammesse fiamme o materiali non conformi alle regole.',true)}</div></div>
      ${radio('siae','Sono previste musica, proiezioni o altre opere protette?',[['si','Sì'],['no','No']],d.siae)}<div id="parrocchia-opere" class="campo"><label for="p-siae_opere">Quali opere o proiezioni?</label><textarea id="p-siae_opere" name="siae_opere">${esc(d.siae_opere || '')}</textarea><p class="hint">La gratuità non esonera dalla verifica dei diritti: la sala valuterà le autorizzazioni necessarie.</p></div>
      ${testo('esigenze_apertura','Apertura, accoglienza e assistenza da concordare',d.esigenze_apertura,'Indicate chi arriva per primo, quando occorre accedere e se chiedete aiuto per apertura, preparazione o utilizzo degli impianti.')}
      ${testo('variazioni_incontri','Ci sono esigenze diverse tra un incontro e l’altro?',d.variazioni_incontri,'Specificate le date a cui si riferiscono variazioni di attività, allestimento o dotazioni. Eventuali spazi aggiuntivi vanno approvati.')}
      ${testo('altre_esigenze','Altri spazi o esigenze da valutare',d.altre_esigenze,'Indicate ogni altra necessità: nessuno spazio, arredo o servizio aggiuntivo è confermato automaticamente.')}</section>
      <section class="sez"><h2>5 · Regole e invio</h2><div class="regole"><p>Capienze e vie di uscita vanno rispettate. Uscite e percorsi devono restare liberi. Impianti e attrezzature si usano con il personale della sala. Non sono ammessi fiamme, fumo, cibo e bevande in sala. I passeggini non sono ammessi; sono ammesse carrozzine per persone con disabilità e cani guida o di assistenza. A fine incontro la sala va lasciata in ordine entro l’orario di riordino.</p><a href="scheda-manifestazioni.html" target="_blank" rel="noopener">Leggi le regole complete della sala</a></div>
      <label class="accetta"><input type="checkbox" name="conferma_esigenze"${d.conferma_esigenze ? ' checked' : ''}> Ho indicato tutte le esigenze: spazi, allestimenti, attrezzature e assistenza devono essere verificati e confermati dalla sala</label>
      <label class="accetta"><input type="checkbox" name="ok_regole"${d.ok_regole ? ' checked' : ''}> Abbiamo letto le regole e ci impegniamo a rispettarle</label><label class="accetta"><input type="checkbox" name="ok_privacy"${d.ok_privacy ? ' checked' : ''}> I dati sono usati dalla Parrocchia di San Biagio per gestire la richiesta e gli incontri; non inserisco nomi o dati sanitari dei partecipanti</label>
      ${input('firma','Nome e cognome di chi invia',d.firma,'text',true)}</section><div id="errori" role="status"></div><div class="invia"><button class="btn primary" type="submit" id="parrocchia-invia">Invia richiesta per approvazione</button><span class="hint">Gratuita · nessuna prenotazione automatica</span></div></form>`);
  const form = document.getElementById('parrocchia-form');
  function leggi() {
    const result = {};
    for (const el of form.elements) {
      if (!el.name || el.name.startsWith('o_') || el.disabled) continue;
      if (el.type === 'radio') { if (el.checked) result[el.name] = el.value; }
      else result[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
    }
    if (result.stesso_responsabile) { result.resp_sera = result.referente; result.resp_cell = result.cellulare; }
    result.orari = [...form.querySelectorAll('.riga-orari')].map((row) => Object.fromEntries(['data','all_da','all_a','porte','inizio','fine','sgombero'].map((k) => [k,row.querySelector(`[name="o_${k}"]`).value])));
    result.ente = 'Parrocchia di San Biagio'; result.a_titolo = 'parrocchia'; result.tipo = 'conferenza';
    return result;
  }
  function salva() {
    const condizione = (id, attiva) => { const section = document.getElementById(id); section.hidden = !attiva; section.querySelectorAll('input,textarea,select').forEach((el) => { el.disabled = !attiva; }); };
    condizione('parrocchia-responsabile', !form.elements.stesso_responsabile.checked);
    condizione('parrocchia-palco', form.elements.palco.value === 'si');
    condizione('parrocchia-proiezione', form.elements.proiettore.checked);
    condizione('parrocchia-audio', form.elements.audio.checked);
    for (const name of ['mic_filo','radiomic','mic_tavolo']) condizione('parrocchia-' + name + '-numero', form.elements.audio.checked && form.elements[name].checked);
    condizione('parrocchia-tavolo-numero', form.elements.tavolo.checked);
    condizione('parrocchia-tecnico', form.elements.tecnico.value === 'nostro');
    condizione('parrocchia-attrezzature', form.elements.attrezzature.value === 'si');
    condizione('parrocchia-materiali', form.elements.scenografie.value === 'si');
    condizione('parrocchia-opere', form.elements.siae.value === 'si');
    document.getElementById('parrocchia-aggiungi').disabled = form.querySelectorAll('.riga-orari').length >= 52;
    try { localStorage.setItem(BOZZA, JSON.stringify({ ...leggi(), _bozza_compilata_il: info.compilata_il || null })); } catch {}
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
