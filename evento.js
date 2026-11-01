import { riepilogoDanza } from "./danza.js?v=2026-11-01.89";
// Scheda unica di una prenotazione: usa soltanto i dati già caricati e i permessi della vista.
export function schedaEvento(S, b, h) {
  const { esc, money, fmtDay, orario, coverage, turni, signupsFor, schedaDi, siaeStato, residuo, isRecurring } = h;
  const staff = S.canWrite, cancellato = b.stato === 'annullata';
  const schedeDisponibili = !S.loadErr?.schede;
  const s = staff && schedeDisponibili ? schedaDi(b) : null, d = s?.dati || {};
  const c = coverage(b), mancanti = Math.max(0, c.need - c.have);
  const nonRichiesta = b.della_sala || isRecurring(b) || /cinema|proiezion|cineforum/i.test((b.tipo || '') + ' ' + b.titolo);
  const azioni = [];
  const button = (action, text, primary = false) => `<button class="btn${primary ? ' primary' : ''}" type="button" data-event-action="${action}">${esc(text)}</button>`;
  const badge = (text, tipo = 'annullata') => `<span class="pill ${tipo}">${esc(text)}</span>`;
  const sicuro = (value) => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? esc(u.href) : ''; } catch { return ''; } };
  const link = (url, label) => sicuro(url) ? `<a class="btn sm" href="${sicuro(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
  const panel = (id, title, content) => `<section class="panel evento-panel" id="evento-${id}" aria-labelledby="evento-title-${id}"><h3 id="evento-title-${id}">${title}</h3>${content}</section>`;
  const next = (text, action, label) => { if (!cancellato) azioni.push({ text, action, label }); };
  if (staff && b.stato === 'opzione') next('La prenotazione è ancora da confermare.', 'edit', 'Rivedi prenotazione');
  let programma = '', documenti = '', pagamenti = '', contatti = '', materiali = '', collegati = '';
  if (staff) {
    let statoScheda, tipoScheda = 'acconto';
    if (!schedeDisponibili) statoScheda = 'Dati non disponibili';
    else if (s) {
      statoScheda = ({ da_inviare: 'Da inviare', inviata: 'In attesa di compilazione', aperta: 'Aperta dall’organizzatore', compilata: 'Da verificare', approvata: 'Approvata', respinta: 'Da correggere', non_serve: 'Non richiesta' })[s.stato] || 'Da verificare';
      if (['approvata', 'non_serve'].includes(s.stato)) tipoScheda = 'saldato';
    } else { statoScheda = nonRichiesta ? 'Non richiesta per questo tipo di evento' : 'Da richiedere'; tipoScheda = nonRichiesta ? 'annullata' : 'acconto'; }
    const conRisposte = s && ['compilata', 'approvata', 'respinta'].includes(s.stato);
    if (schedeDisponibili && !nonRichiesta && !['approvata', 'non_serve'].includes(s?.stato)) {
      next(`Scheda di richiesta: ${statoScheda.toLowerCase()}.`, conRisposte ? 'document' : 'send-document', conRisposte ? 'Apri risposte' : 'Prepara link scheda');
    }
    const siae = !schedeDisponibili ? '' : b.della_sala ? 'sala' : siaeStato(d, s);
    const statoSiae = ({ allegato: 'Permesso allegato', da_ricevere: 'Permesso da ricevere', non_serve: 'Non necessaria (dichiarata)', sala: 'A carico della Sala' })[siae] || 'Da verificare';
    if (siae === 'da_ricevere') next('Il permesso SIAE è da ricevere.', conRisposte ? 'document' : 'send-document', conRisposte ? 'Apri documenti' : 'Prepara link scheda');
    documenti = panel('documenti', 'Scheda e documenti', `<div class="sr-riga"><span>Scheda di richiesta</span><div>${badge(statoScheda, tipoScheda)}</div></div>
      <div class="sr-riga"><span>SIAE</span><div>${badge(statoSiae, ['allegato', 'non_serve'].includes(siae) ? 'saldato' : 'acconto')}${siae === 'sala' ? '<p class="hint">La gestione è della Sala; questo stato non conferma il rilascio del permesso.</p>' : ''}</div></div>
      ${s?.sicurezza ? `<div class="sr-riga"><span>Parere di sicurezza</span><div>${esc(({ compatibile: 'Compatibile', condizioni: 'Compatibile con condizioni', non_compatibile: 'Non compatibile' })[s.sicurezza] || s.sicurezza)}${s.sicurezza_note ? `<p>${esc(s.sicurezza_note)}</p>` : ''}</div></div>` : ''}
      <div class="actions">${conRisposte ? button('document', s.stato === 'compilata' ? 'Verifica risposte e allegati' : 'Apri risposte e allegati') : ''}${schedeDisponibili && !nonRichiesta && s?.stato !== 'non_serve' ? button('send-document', s ? 'Copia link scheda' : 'Prepara link scheda') : ''}</div>`);
    if (s?.percorso === 'parrocchia') {
      const sale = { galleria: 'Galleria', platea: 'Platea con palco', tutta: 'Platea e galleria' };
      const disposizione = { seduti: 'Partecipanti seduti', tavolo: 'Riunione attorno a un tavolo', gruppi: 'Lavoro in piccoli gruppi', altro: 'Altro allestimento da concordare' };
      const righe = [
        ['Che cosa faranno', d.descrizione], ['Sala richiesta', sale[d.fascia] || d.fascia], ['Come useranno gli spazi', d.utilizzo_spazi],
        ['Allestimento', [disposizione[d.disposizione], d.disposizione_dettagli].filter(Boolean).join(' · ')],
        ['Partecipanti', d.pubblico_n ? `${d.pubblico_n} complessivi${d.minori === 'si' ? ' · presenti minori' : ''}` : ''],
        ['Palco', d.palco === 'si' ? `${d.palco_n} persone · ${d.palco_uso || ''}` : d.palco === 'no' ? 'Non richiesto' : ''],
        ['Accessibilità', [d.carrozzina_n ? `${d.carrozzina_n} persone in carrozzina` : '', d.accessibilita].filter(Boolean).join(' · ')],
        ['Dotazioni richieste', [d.proiettore ? 'Proiettore' : '', d.audio ? 'Impianto audio' : '', d.mic_filo ? `${d.mic_filo_n || '?'} microfoni a filo` : '', d.radiomic ? `${d.radiomic_n || '?'} radiomicrofoni` : '', d.mic_tavolo ? `${d.mic_tavolo_n || '?'} microfoni da tavolo` : '', d.tavolo ? `Tavolo relatori (${d.tavolo_n || '?'} posti)` : '', d.luci ? 'Luci di scena' : '', d.sipario ? 'Sipario e quinte' : ''].filter(Boolean).join(' · ')],
        ['Proiezione', [d.contenuti_proiezione, d.collegamento_video].filter(Boolean).join(' · ')], ['Audio', d.audio_uso],
        ['Attrezzature proprie', d.attrezzature === 'si' ? `${d.attrezzature_quali || ''}${d.potenza_w ? ' · ' + d.potenza_w + ' W' : ''}` : ''],
        ['Materiali e scenografie', d.scenografie === 'si' ? d.scenografie_quali : ''],
        ['Tecnico del gruppo', d.tecnico === 'nostro' ? [d.tecnico_nome, d.tecnico_cell].filter(Boolean).join(' · ') : ''],
        ['Apertura e assistenza da concordare', d.esigenze_apertura], ['Variazioni tra incontri', d.variazioni_incontri], ['Altre esigenze', d.altre_esigenze]
      ];
      programma = panel('programma', 'Attività, sala ed esigenze', `<dl class="evento-info">${righe.filter(([, valore]) => valore).map(([label, valore]) => `<dt>${esc(label)}</dt><dd class="evento-note">${esc(valore)}</dd>`).join('')}</dl><p class="hint">Dotazioni, allestimenti e assistenza sono le richieste del gruppo: verificare quanto concordato prima dell’apertura.</p>`);
    }
    if (d.tipo === 'danza') programma = panel('programma', 'Saggio di danza', riepilogoDanza(d, esc));
    const prezzo = Number(b.prezzo) || 0, incassato = Number(b.incassato) || 0;
    if (prezzo > 0 && residuo(b) > 0) next(`Restano ${money(residuo(b))} da incassare.`, 'payment', 'Registra incasso');
    pagamenti = panel('pagamenti', 'Pagamenti', `<dl class="evento-totali"><div><dt>Importo previsto</dt><dd>${money(prezzo)}</dd></div><div><dt>Incassato</dt><dd>${money(incassato)}</dd></div><div><dt>Da incassare</dt><dd>${money(residuo(b))}</dd></div></dl>
      <p>${b.scheda_parrocchia_id ? badge('Attività della Parrocchia · gratuita', 'saldato') : prezzo > 0 ? badge(residuo(b) ? 'Da saldare' : 'Saldato', residuo(b) ? 'acconto' : 'saldato') : '<span class="hint">Importo non indicato o evento senza addebito.</span>'}</p>${!cancellato && !b.scheda_parrocchia_id ? button('payment', 'Aggiorna pagamento') : ''}`);
    const telefono = String(d.cellulare || b.telefono || '').replace(/[^\d+]/g, '');
    contatti = panel('contatti', 'Organizzatore e informazioni', `<dl class="evento-info">
      ${b.gruppo_id ? `<dt>Gruppo</dt><dd>${esc((S.gruppi || []).find(g => g.id === b.gruppo_id)?.nome || 'Gruppo collegato')}</dd>` : ''}
      <dt>Organizzatore</dt><dd>${esc(d.ente || b.referente || 'Non indicato')}</dd>
      ${d.ente && b.referente ? `<dt>Referente</dt><dd>${esc(b.referente)}</dd>` : ''}
      ${telefono ? `<dt>Telefono</dt><dd><a href="tel:${telefono}">${esc(d.cellulare || b.telefono)}</a></dd>` : ''}
      ${b.email ? `<dt>Email</dt><dd>${esc(b.email)}</dd>` : ''}
      ${d.resp_sera ? `<dt>Responsabile in sala</dt><dd>${esc(d.resp_sera)}${d.resp_cell ? ` · ${esc(d.resp_cell)}` : ''}</dd>` : ''}
      ${d.tecnico_nome ? `<dt>Tecnico</dt><dd>${esc(d.tecnico_nome)}${d.tecnico_cell ? ` · ${esc(d.tecnico_cell)}` : ''}</dd>` : ''}
      ${b.note ? `<dt>Note</dt><dd class="evento-note">${esc(b.note)}</dd>` : ''}</dl>`);
    if (S.staff) {
      const info = S.eventiInfo?.['b:' + b.id];
      materiali = panel('materiali', 'Locandina e materiali', S.loadErr2?.eventiInfo ? '<p class="hint">Informazioni non disponibili.</p>' : `<p>${info?.descrizione ? esc(info.descrizione) : 'Nessuna descrizione inserita.'}</p><div class="actions">${link(info?.locandina, 'Apri locandina')}${link(info?.materiali, 'Apri cartella materiali')}${button('social', 'Gestisci informazioni e materiali')}</div>${info?.note ? `<p class="evento-note">${esc(info.note)}</p>` : ''}`);
    }
    const richieste = S.requests.filter((r) => r.booking_id === b.id);
    const sopralluoghi = S.sopralluoghi.filter((r) => r.booking_id === b.id);
    collegati = panel('collegamenti', 'Richiesta e sopralluoghi', `${richieste.map((r) => `<details><summary>${esc(r.oggetto || 'Richiesta di sala')} · ${esc(r.mittente || '')}</summary><p class="evento-note">${esc(r.testo || '')}</p>${link(r.link, 'Apri email originale')}</details>`).join('')}
      ${sopralluoghi.map((r) => `<div class="sr-riga"><span>${esc(fmtDay(r.data))} · ${esc(r.ora?.slice(0, 5) || '')}</span><div>${esc(r.nome)} · ${esc(({ da_fare: 'Da fare', fatto: 'Fatto', annullato: 'Annullato' })[r.stato] || r.stato)} ${button('sop-' + r.id, 'Apri sopralluogo')}</div></div>`).join('')}
      ${!richieste.length && !sopralluoghi.length ? '<p class="hint">Nessuna richiesta o sopralluogo collegato a questa prenotazione.</p>' : ''}`);
  }
  if (!S.loadErr?.signups && !turni(b).length) next('I turni non sono ancora pianificati.', staff ? 'edit' : 'shifts', staff ? 'Pianifica turni' : 'Apri turni');
  else if (!S.loadErr?.signups && mancanti) next(`${mancanti === 1 ? 'Manca una persona' : `Mancano ${mancanti} persone`} nei turni.`, 'shifts', 'Apri turni dell’evento');
  const turniHtml = panel('turni', 'Turni e persone', `${S.loadErr?.signups ? '<p class="warn">Impossibile leggere le iscrizioni: la copertura dei turni non è verificabile.</p>' : turni(b).length ? `<p>${badge(mancanti ? `${mancanti} posti da coprire` : 'Tutti i posti coperti', mancanti ? 'acconto' : 'saldato')}</p>${turni(b).map((t) => {
    const persone = signupsFor(b.id, t.id), n = Math.max(0, (Number(t.posti) || 0) - persone.length);
    return `<div class="sr-turno"><h4>${esc(t.label)}</h4><p class="hint">${esc(t.inizio)}–${esc(t.fine)} · ${persone.length}/${Number(t.posti) || 0} persone</p><div>${persone.map((p) => `<span class="person solo">${esc(p.nome)}</span>`).join(' ')}${n ? ` ${badge(`${n} posti liberi`, 'acconto')}` : ''}</div></div>`;
  }).join('')}` : '<p class="hint">Nessuna fascia oraria pianificata.</p>'}<div class="actions">${!cancellato && turni(b).length ? button('shifts', staff ? 'Gestisci turni dell’evento' : 'Segnati ai turni') : ''}${staff && !cancellato ? button('edit', 'Modifica fasce') : ''}</div>`);
  return `${S.loadErr?.bookings ? '<p class="warn" role="status">Impossibile aggiornare la prenotazione: sono mostrati gli ultimi dati disponibili.</p>' : ''}<div class="toolbar evento-header"><div><a href="#${staff ? 'prenotazioni' : 'calendario'}">← ${staff ? 'Prenotazioni' : 'Calendario'}</a><p class="eyebrow">Scheda evento</p><h2 id="evento-titolo" tabindex="-1">${esc(b.titolo)}</h2><p>${esc(fmtDay(b.data))} · ${esc(orario(b))}${b.tipo ? ` · ${esc(b.tipo)}` : ''}</p>${badge(({ opzione: 'Opzione', confermata: 'Confermata', annullata: 'Annullata' })[b.stato] || b.stato, b.stato)}</div><div class="actions">${staff ? button('edit', 'Modifica prenotazione') + (!cancellato && !b.scheda_parrocchia_id ? button('quote', 'Prepara preventivo') : '') : ''}${button('serata', 'La serata di questa data')}</div></div>
    ${cancellato ? '<div class="warn" role="status">Evento annullato: le informazioni restano consultabili.</div>' : `<section id="evento-prossime" class="panel evento-prossime" aria-labelledby="evento-prossime-title"><h3 id="evento-prossime-title">Prossime azioni</h3>${azioni.length ? `<ul>${azioni.map((a) => `<li><span>${esc(a.text)}</span>${button(a.action, a.label)}</li>`).join('')}</ul>` : '<p>Nessuna azione segnalata dai dati disponibili. Controlla comunque documenti e dettagli prima dell’apertura.</p>'}</section>`}
    <div class="evento-grid">${programma}${documenti}${turniHtml}${pagamenti}${contatti}${materiali}${collegati}</div>`;
}
