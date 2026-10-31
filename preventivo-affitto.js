// Preventivo per il cliente: anteprima e stampa, senza scritture sulla prenotazione.
export function creaPreventivi({ getState, calcolaTariffa, esc, iso, fmtDay }) {
  const dialog = document.getElementById('dlg-preventivo-affitto'), bozze = new Map();
  const euro = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
  const spazi = { galleria: 'Galleria', platea: 'Platea', tutta: 'Platea e galleria' };
  const supplementi = { biglietteria: 'Biglietteria', tappeto: 'Tappeto danza', commerciale: 'Attività commerciale' };
  let bozza, chiave;
  const field = (id, label, value, type = 'text') => `<div class="field h"><label for="qa-${id}">${label}</label><input id="qa-${id}" type="${type}" value="${esc(value || '')}"></div>`;
  function leggi() {
    const val = (id) => dialog.querySelector('#qa-' + id).value.trim();
    for (const id of ['intestazione', 'destinatario', 'contatto', 'titolo', 'data', 'inizio', 'fine', 'emesso', 'validita', 'condizioni', 'note', 'modo', 'spazio']) bozza[id] = val(id);
    bozza.importo = Number(val('importo'));
    bozza.importoVuoto = val('importo') === '';
    for (const id of Object.keys(supplementi)) bozza[id] = dialog.querySelector('#qa-' + id).checked;
    bozze.set(chiave, { ...bozza });
  }
  function calcolo() {
    if (bozza.modo === 'concordato') return !bozza.importoVuoto && Number.isFinite(bozza.importo) && bozza.importo >= 0
      ? { righe: [['Importo complessivo concordato', Math.round(bozza.importo * 100) / 100]], totale: Math.round(bozza.importo * 100) / 100 } : null;
    const S = getState();
    return S.tariffeDb && !S.loadErr?.settings ? calcolaTariffa({ spazio: bozza.spazio, ...Object.fromEntries(Object.keys(supplementi).map((k) => [k, bozza[k]])) }) : null;
  }
  function errore(c) {
    if (!bozza.intestazione || !bozza.destinatario || !bozza.titolo || !bozza.data || !bozza.emesso) return 'Completa intestazione, destinatario, evento, data dell’evento e data di emissione.';
    if (!bozza.inizio || !bozza.fine || bozza.fine <= bozza.inizio) return 'Controlla gli orari: la fine deve essere dopo l’inizio.';
    if (bozza.validita && bozza.validita < bozza.emesso) return 'La validità non può precedere la data di emissione.';
    if (!c) return bozza.modo === 'tariffa' ? 'Scegli lo spazio e verifica che le tariffe siano disponibili.' : 'Inserisci un importo valido, maggiore o uguale a zero.';
    if (!Number.isFinite(c.totale) || c.totale < 0 || c.righe.some((r) => !Number.isFinite(r[1]) || r[1] < 0)) return 'Controlla gli importi e le tariffe prima della stampa.';
    return '';
  }
  function documento(c) {
    if (!c) return '<p>Scegli lo spazio o indica l’importo concordato per preparare il preventivo.</p>';
    return `<header><p class="quote-brand">${esc(bozza.intestazione)}</p><h1>Preventivo utilizzo sala</h1><p>Emesso il ${esc(bozza.emesso ? fmtDay(bozza.emesso) : '—')}${bozza.validita ? ` · Valido fino al ${esc(fmtDay(bozza.validita))}` : ''}</p></header>
      <section><h2>Destinatario</h2><p>${esc(bozza.destinatario || 'Da indicare')}${bozza.contatto ? `<br>${esc(bozza.contatto)}` : ''}</p><h2>${esc(bozza.titolo || 'Evento da indicare')}</h2><p>${esc(bozza.data ? fmtDay(bozza.data) : 'Data da indicare')} · ${esc(bozza.inizio || '—')}–${esc(bozza.fine || '—')}${bozza.modo === 'tariffa' ? `<br>Spazio: ${esc(spazi[bozza.spazio])} · tariffa a giornata` : ''}</p></section>
      <table><thead><tr><th scope="col">Voce</th><th scope="col">Importo</th></tr></thead><tbody>${c.righe.map(([nome, n]) => `<tr><td>${esc(nome)}</td><td>${euro(n)}</td></tr>`).join('')}</tbody><tfoot><tr><th scope="row">Totale preventivo</th><td>${euro(c.totale)}</td></tr></tfoot></table>
      ${bozza.modo === 'concordato' ? '<p class="quote-small">Importo complessivo concordato. Dettaglio IVA non scorporato.</p>' : ''}
      ${bozza.condizioni ? `<section><h2>Condizioni</h2><p class="quote-lines">${esc(bozza.condizioni)}</p></section>` : ''}
      ${bozza.note ? `<section><h2>Note al preventivo</h2><p class="quote-lines">${esc(bozza.note)}</p></section>` : ''}
      <footer>Questo documento è un preventivo, non una ricevuta di pagamento.</footer>`;
  }
  function aggiorna() {
    leggi();
    const c = calcolo(), message = errore(c);
    dialog.querySelector('#qa-preview').innerHTML = documento(c);
    dialog.querySelector('#qa-errors').textContent = message;
    dialog.querySelector('#qa-print').disabled = !!message;
    dialog.querySelector('#qa-tariffe').hidden = bozza.modo !== 'tariffa';
    dialog.querySelector('#qa-custom').hidden = bozza.modo !== 'concordato';
    const diverso = c && bozza.originale > 0 && Math.abs(c.totale - bozza.originale) > 0.005;
    dialog.querySelector('#qa-differenza').textContent = diverso ? `Il preventivo è di ${euro(c.totale)}; nella prenotazione sono indicati ${euro(bozza.originale)}. La prenotazione non viene modificata.` : '';
  }
  function stampa() {
    aggiorna();
    const c = calcolo(); if (errore(c)) return;
    const w = window.open('', '_blank');
    if (!w) { dialog.querySelector('#qa-errors').textContent = 'Consenti l’apertura della finestra di stampa nel browser e riprova.'; return; }
    w.opener = null;
    w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc('Preventivo - ' + bozza.titolo)}</title><style>${stileDocumento}</style></head><body><article class="quote-document">${documento(c)}</article></body></html>`);
    w.document.close(); w.focus(); w.print();
  }
  return function apri(source, key = source.id) {
    if (!getState().canWrite) return;
    chiave = key;
    const S = getState(), scheda = S.schede.filter((s) => s.booking_id === source.id).sort((a, b) => b.creato.localeCompare(a.creato))[0];
    const tariffa = source.tariffa || {}, spazio = tariffa.spazio || scheda?.dati?.fascia || '';
    const proposta = calcolaTariffa({ ...tariffa, spazio });
    const concordato = Number(source.prezzo) > 0 && (!proposta || Math.abs(proposta.totale - Number(source.prezzo)) > 0.005);
    bozza = bozze.get(chiave) || { intestazione: 'Sala San Tommaso Moro', destinatario: scheda?.dati?.ente || source.referente || '', contatto: source.email || '', titolo: source.titolo || '', data: source.data || '', inizio: source.giornata_intera ? '00:00' : source.inizio || '', fine: source.giornata_intera ? '23:59' : source.fine || '', emesso: iso(new Date()), validita: '', condizioni: 'Utilizzo nel rispetto delle regole della sala riportate nella scheda di richiesta.\nSe portate un vostro tecnico o materiale tecnico, allegate la scheda tecnica.', note: '', modo: concordato ? 'concordato' : 'tariffa', spazio, importo: Number(source.prezzo) || 0, originale: Number(source.prezzo) || 0, ...Object.fromEntries(Object.keys(supplementi).map((k) => [k, !!tariffa[k]])) };
    bozza.originale = Number(source.prezzo) || 0;
    dialog.innerHTML = `<div class="dlg quote-dialog"><div class="dlg-head"><h2>Prepara preventivo</h2><button class="btn ghost sm" type="button" id="qa-close">Chiudi</button></div>
      <p class="hint">Controlla dati e condizioni, poi scegli «Salva come PDF» nella finestra di stampa. La bozza resta disponibile finché questa pagina rimane aperta.</p>
      <div class="form">${field('intestazione', 'Intestazione', bozza.intestazione)}${field('destinatario', 'Destinatario', bozza.destinatario)}${field('contatto', 'Email o contatto del destinatario', bozza.contatto)}${field('titolo', 'Evento', bozza.titolo)}${field('data', 'Data dell’evento', bozza.data, 'date')}${field('emesso', 'Data di emissione', bozza.emesso, 'date')}${field('inizio', 'Dalle', bozza.inizio, 'time')}${field('fine', 'Alle', bozza.fine, 'time')}${field('validita', 'Valido fino al (facoltativo)', bozza.validita, 'date')}
      <div class="field h"><label for="qa-modo">Importi da usare</label><select id="qa-modo"><option value="tariffa">Tariffe attuali della sala</option><option value="concordato">Importo complessivo concordato</option></select></div>
      <div class="field" id="qa-tariffe"><label for="qa-spazio">Spazio</label><select id="qa-spazio"><option value="">Scegli lo spazio…</option>${Object.entries(spazi).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><div class="quote-supplementi">${Object.entries(supplementi).map(([k, v]) => `<label class="check"><input type="checkbox" id="qa-${k}"${bozza[k] ? ' checked' : ''}> ${v}</label>`).join('')}</div><p class="hint">Tariffe a giornata e IVA dalle impostazioni della sala. Controlla le voci prima di inviare.</p></div>
      <div class="field" id="qa-custom"><label for="qa-importo">Importo complessivo (€)</label><input id="qa-importo" type="number" min="0" step="0.01" inputmode="decimal" value="${bozza.importoVuoto ? '' : bozza.importo}"><p class="hint">Usa questa modalità per il prezzo concordato. Il PDF non mostrerà uno scorporo IVA calcolato.</p></div>
      <div class="field"><label for="qa-condizioni">Condizioni</label><span class="hint">Proposta dalle regole della sala: controlla e adatta agli accordi con il cliente.</span><textarea id="qa-condizioni" placeholder="Inserisci le condizioni concordate, le scadenze e gli eventuali servizi inclusi.">${esc(bozza.condizioni)}</textarea></div>
      <div class="field"><label for="qa-note">Note da includere nel preventivo</label><textarea id="qa-note">${esc(bozza.note)}</textarea><span class="hint">Le note interne della prenotazione non vengono copiate nel documento.</span></div></div>
      <p id="qa-differenza" class="hint" role="status"></p><p id="qa-errors" class="hint" role="status"></p>
      <section aria-label="Anteprima preventivo"><h3>Anteprima del documento</h3><article id="qa-preview" class="quote-document"></article></section>
      <div class="dlg-foot"><span class="hint">Non modifica prenotazioni o incassi e non invia email.</span><button class="btn primary" type="button" id="qa-print">Stampa / Salva PDF</button></div></div>`;
    dialog.querySelector('#qa-modo').value = bozza.modo;
    dialog.querySelector('#qa-spazio').value = bozza.spazio;
    dialog.querySelectorAll('input, select, textarea').forEach((el) => { el.addEventListener('input', aggiorna); el.addEventListener('change', aggiorna); });
    dialog.querySelector('#qa-print').onclick = stampa;
    dialog.querySelector('#qa-close').onclick = () => dialog.close();
    aggiorna(); dialog.showModal();
  };
}
const stileDocumento = `@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#17212a;margin:0;font-size:11pt;line-height:1.5}.quote-document{max-width:760px;margin:auto}h1{font-size:23pt}h2{font-size:12pt;margin:20px 0 6px}p{overflow-wrap:anywhere}.quote-brand{font-size:14pt;font-weight:bold;color:#163e3b}header{border-bottom:2px solid #163e3b;padding-bottom:12px}table{width:100%;border-collapse:collapse;margin:22px 0}th,td{padding:10px 6px;border-bottom:1px solid #ccc;text-align:left;overflow-wrap:anywhere}th:last-child,td:last-child{text-align:right;white-space:nowrap}tfoot{font-weight:bold;font-size:14pt}.quote-lines{white-space:pre-wrap}.quote-small,footer{font-size:9pt;color:#555}footer{margin-top:30px;border-top:1px solid #ccc;padding-top:10px}tr{break-inside:avoid}thead{display:table-header-group}`;
