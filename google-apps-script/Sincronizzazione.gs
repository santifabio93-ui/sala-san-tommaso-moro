/**
 * Sala San Tommaso Moro — sincronizzazione automatica con l'app.
 *
 * Va copiato in Google Apps Script (https://script.google.com) in ciascun account Google:
 *  - salatommasomoro@gmail.com  → MODALITA = "lettura+email"    (legge il calendario, non lo modifica mai + email della sala)
 *                                  poi, se vuoi, "calendario+email" (anche le prenotazioni create nell'app finiscono nel calendario)
 *  - santifabio93@gmail.com     → MODALITA = "email"            (solo le email che parlano della sala)
 *
 * SICUREZZA DEL CALENDARIO
 *  - In "lettura" lo script non scrive, non modifica e non cancella nulla nel calendario.
 *  - In "calendario" lo script modifica o cancella SOLO gli eventi che ha creato lui (contrassegnati
 *    con un'etichetta invisibile). Gli eventi esistenti o creati a mano non vengono mai toccati.
 *
 * Impostazioni (Impostazioni progetto → Proprietà script):
 *   SUPABASE_URL   https://uayqjbzpumsnynuoeayo.supabase.co
 *   SUPABASE_KEY   la chiave pubblica (sb_publishable_...)
 *   SYNC_TOKEN     il codice di sincronizzazione mostrato dallo script SQL 002
 *   MODALITA       "lettura+email", "calendario+email" oppure "email"; aggiungi "+cinema" per leggere
 *                  anche la programmazione da Cinebot (es. "lettura+email+cinema")
 *   CALENDARIO     (facoltativo) id del calendario; se manca si usa quello principale dell'account
 *
 * PERMESSI: insieme a questo file va copiato anche "appsscript.json" (manifest), che limita lo script
 * alla SOLA LETTURA di calendario ed email. Google stesso impedisce allo script qualsiasi modifica.
 * (Solo per la modalità "calendario+email" va sostituito calendar.readonly con calendar.)
 *
 * Poi esegui una volta la funzione "installa": chiede i permessi e attiva il controllo ogni 15 minuti.
 */

const FUSO = "Europe/Rome";
const GIORNI_INDIETRO = 60;
const GIORNI_AVANTI = 400;
const CONTRASSEGNO = "creatoDallAppSala"; // tag invisibile sugli eventi creati dall'app
// email che parlano della sala e sembrano richieste; quelle con un'etichetta Gmail "Sala-Richieste" messa a mano entrano sempre
const RICERCA_EMAIL =
  '-from:me newer_than:21d -category:promotions -category:social ' +
  '(label:sala-richieste OR (("tommaso moro" OR "sala") ' +
  '(richiesta OR richiedere OR prenotare OR prenotazione OR disponibilità OR disponibile OR utilizzo OR conferenza OR evento OR serata OR incontro)))';

function installa() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("sincronizza").timeBased().everyMinutes(15).create();
  sincronizza();
  Logger.log("Installato: la sincronizzazione girerà ogni 15 minuti.");
}

function sincronizza() {
  const cfg = leggiImpostazioni();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const scrivi = cfg.modalita.indexOf("calendario") !== -1;
    if (scrivi || cfg.modalita.indexOf("lettura") !== -1) sincronizzaCalendario(cfg, scrivi);
    if (cfg.modalita.indexOf("email") !== -1) leggiEmail(cfg);
    if (cfg.modalita.indexOf("cinema") !== -1) leggiCinebotSeServe(cfg);
  } finally {
    lock.releaseLock();
  }
}

function leggiImpostazioni() {
  const p = PropertiesService.getScriptProperties().getProperties();
  ["SUPABASE_URL", "SUPABASE_KEY", "SYNC_TOKEN"].forEach((k) => {
    if (!p[k]) throw new Error("Manca la proprietà dello script " + k);
  });
  return {
    url: p.SUPABASE_URL.replace(/\/$/, ""),
    key: p.SUPABASE_KEY,
    token: p.SYNC_TOKEN,
    modalita: (p.MODALITA || "email").toLowerCase(),
    calendario: p.CALENDARIO || "",
  };
}

function rpc(cfg, nome, corpo) {
  const res = UrlFetchApp.fetch(cfg.url + "/rest/v1/rpc/" + nome, {
    method: "post",
    contentType: "application/json",
    headers: { apikey: cfg.key },
    payload: JSON.stringify(Object.assign({ p_token: cfg.token }, corpo)),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 300) throw new Error(nome + " → HTTP " + code + ": " + res.getContentText());
  const testo = res.getContentText();
  return testo ? JSON.parse(testo) : null;
}

/* ---------------- calendario ---------------- */

function calendario(cfg) {
  return cfg.calendario ? CalendarApp.getCalendarById(cfg.calendario) : CalendarApp.getDefaultCalendar();
}

const creatoDallApp = (e) => e && e.getTag(CONTRASSEGNO) === "1";

function sincronizzaCalendario(cfg, scrivi) {
  const cal = calendario(cfg);
  if (!cal) throw new Error("Calendario non trovato: " + cfg.calendario);
  const scritti = [], cancellati = [];

  // 1. solo in modalità "calendario": scrivo le prenotazioni create o modificate nell'app
  const pending = scrivi ? rpc(cfg, "sync_calendar_pending", {}) : {};
  (pending.scrivi || []).forEach((b) => {
    try {
      const ev = b.gcal_id ? cal.getEventById(b.gcal_id) : null;
      if (ev && !creatoDallApp(ev)) {
        // evento nato sul calendario: non lo tocco, segno solo che è allineato
        scritti.push({ id: b.id });
        return;
      }
      const titolo = titoloCalendario(b);
      let e = ev;
      if (b.giornata_intera) {
        const giorno = dataLocale(b.data, "00:00");
        if (e) { e.setAllDayDate(giorno); e.setTitle(titolo); }
        else e = cal.createAllDayEvent(titolo, giorno);
      } else {
        const inizio = dataLocale(b.data, b.inizio), fine = dataLocale(b.data, b.fine);
        if (e) { e.setTime(inizio, fine); e.setTitle(titolo); }
        else e = cal.createEvent(titolo, inizio, fine);
      }
      e.setTag(CONTRASSEGNO, "1");
      e.setDescription(b.note || "");
      scritti.push({ id: b.id, gcal_id: e.getId() });
    } catch (err) {
      Logger.log("Non scritto " + b.titolo + ": " + err);
    }
  });
  (pending.cancella || []).forEach((id) => {
    try {
      const e = cal.getEventById(id);
      if (creatoDallApp(e)) e.deleteEvent(); // gli eventi nati sul calendario non vengono mai cancellati
      cancellati.push(id);
    } catch (err) {
      Logger.log("Non cancellato " + id + ": " + err);
    }
  });
  if (scritti.length || cancellati.length) rpc(cfg, "sync_calendar_ack", { p_written: scritti, p_deleted: cancellati });

  // 2. poi leggo il calendario e aggiorno l'app
  const oggi = new Date();
  const da = new Date(oggi.getTime() - GIORNI_INDIETRO * 864e5);
  const a = new Date(oggi.getTime() + GIORNI_AVANTI * 864e5);
  const eventi = cal.getEvents(da, a).map(eventoPerApp).filter(Boolean);
  const esito = rpc(cfg, "sync_calendar_pull", {
    p_from: Utilities.formatDate(da, FUSO, "yyyy-MM-dd"),
    p_to: Utilities.formatDate(a, FUSO, "yyyy-MM-dd"),
    p_events: eventi,
  });
  Logger.log("Calendario: scritti " + scritti.length + ", cancellati " + cancellati.length + ", dall'app → " + JSON.stringify(esito));
}

function eventoPerApp(e) {
  const titoloGrezzo = (e.getTitle() || "").trim();
  if (!titoloGrezzo) return null;
  const giornata = e.isAllDayEvent();
  const inizio = giornata ? e.getAllDayStartDate() : e.getStartTime();
  const fine = giornata ? null : e.getEndTime();
  const data = Utilities.formatDate(inizio, FUSO, "yyyy-MM-dd");
  let oraFine = giornata ? "23:59" : Utilities.formatDate(fine, FUSO, "HH:mm");
  const oraInizio = giornata ? "00:00" : Utilities.formatDate(inizio, FUSO, "HH:mm");
  if (!giornata && (Utilities.formatDate(fine, FUSO, "yyyy-MM-dd") !== data || oraFine <= oraInizio)) oraFine = "23:59";
  const p = analizzaTitolo(titoloGrezzo);
  // gli eventi ricorrenti (es. cineforum) hanno lo stesso id per tutte le date: aggiungo la data
  const id = e.isRecurringEvent() ? e.getId() + "|" + data : e.getId();
  return {
    gcal_id: id,
    titolo: p.titolo,
    referente: p.referente,
    telefono: p.telefono,
    tipo: indovinaTipo(p.titolo),
    stato: p.stato,
    data: data,
    inizio: oraInizio,
    fine: oraFine,
    giornata_intera: giornata,
    note: (e.getDescription() || "").replace(/<[^>]+>/g, " ").trim().slice(0, 2000),
  };
}

// "Conferenza ... Ref. Carnio Valerio 333-3899850 EVENTO DA PERFEZIONARE!!!"
function analizzaTitolo(t) {
  let stato = "confermata", titolo = t, referente = "", telefono = "";
  if (/^\s*annullat[oa]\b/i.test(titolo)) { stato = "annullata"; titolo = titolo.replace(/^\s*annullat[oa]\s*[–-]?\s*/i, ""); }
  if (/^\s*opzione\b/i.test(titolo)) { stato = "opzione"; titolo = titolo.replace(/^\s*opzione\s*[–-]?\s*/i, ""); }
  if (/da perfezionare/i.test(titolo)) { stato = "opzione"; titolo = titolo.replace(/\.?\s*evento da perfezionare!*/i, ""); }
  const m = titolo.match(/\bref\.?\s*([^0-9+]{2,60}?)\s*((?:\+39\s?)?[0-9][0-9 .\/-]{6,})/i);
  if (m) {
    referente = m[1].replace(/[.,;:\s]+$/, "").trim();
    telefono = m[2].trim();
    titolo = titolo.replace(m[0], "");
  }
  titolo = titolo.replace(/\s{2,}/g, " ").replace(/[\s.,;]+$/, "").trim();
  return { titolo: titolo || t, referente: referente, telefono: telefono, stato: stato };
}

function titoloCalendario(b) {
  let t = b.titolo;
  if (b.referente) t += ". Ref. " + b.referente + (b.telefono ? " " + b.telefono : "");
  if (b.stato === "opzione") t = "OPZIONE – " + t;
  if (b.stato === "annullata") t = "ANNULLATO – " + t;
  return t;
}

function indovinaTipo(t) {
  const s = t.toLowerCase();
  if (/cineforum|proiezione|film|cinema/.test(s)) return "Cinema / proiezione";
  if (/teatro|spettacolo|concerto|musical/.test(s)) return "Spettacolo / concerto";
  if (/conferenza|incontro|serata|relatore|humanitas|aido/.test(s)) return "Conferenza / incontro";
  if (/catechismo|parrocchi|fidanzati|messa|genitori/.test(s)) return "Attività parrocchiale";
  if (/corso|laboratorio/.test(s)) return "Corso / laboratorio";
  if (/assemblea|riunione/.test(s)) return "Riunione / assemblea";
  return "";
}

function dataLocale(giorno, ora) {
  return Utilities.parseDate(giorno + " " + ora, FUSO, "yyyy-MM-dd HH:mm");
}

/* ---------------- cinema (Cinebot) ---------------- */

const CINEBOT_SITO = "https://ticket.cinebot.it";
const CINEBOT_SALA = "/s.tommasomoro/";
const CINEBOT_OGNI_MINUTI = 60;

// la programmazione cambia di rado: la leggo al massimo una volta all'ora
function leggiCinebotSeServe(cfg) {
  const props = PropertiesService.getScriptProperties();
  const ultima = Number(props.getProperty("CINEBOT_ULTIMA") || 0);
  if (Date.now() - ultima < CINEBOT_OGNI_MINUTI * 60000) return;
  leggiCinebot(cfg);
  props.setProperty("CINEBOT_ULTIMA", String(Date.now()));
}

function scaricaPagina(percorso) {
  const res = UrlFetchApp.fetch(CINEBOT_SITO + percorso, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error("Cinebot " + percorso + " → HTTP " + res.getResponseCode());
  return res.getContentText("UTF-8");
}

function testoPulito(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&egrave;/g, "è").replace(/&agrave;/g, "à").replace(/&ograve;/g, "ò").replace(/&igrave;/g, "ì").replace(/&ugrave;/g, "ù").replace(/&eacute;/g, "é")
    .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// le date di Cinebot non hanno l'anno: scelgo l'anno che le rende più vicine a oggi (al massimo 2 mesi nel passato)
function annoPer(giorno, mese, oggi) {
  const y = oggi.getFullYear();
  const d = new Date(y, mese - 1, giorno);
  return d < new Date(y, oggi.getMonth() - 2, oggi.getDate()) ? y + 1 : y;
}

function leggiCinebot(cfg) {
  const oggi = new Date();
  const home = scaricaPagina(CINEBOT_SALA);
  const films = {};
  const blocchi = home.match(/<a href="\/s\.tommasomoro\/(?:evento|titolo)\/\d+_[^"]*" class="eventi-item[\s\S]*?<\/a>/g) || [];
  blocchi.forEach((blk) => {
    const link = blk.match(/href="(\/s\.tommasomoro\/(evento|titolo)\/(\d+)_[^"]*)"/);
    const percorso = link[1], tipo = link[2], numero = link[3];
    const loc = blk.match(/src="(\/s\.tommasomoro\/titolo\/(\d+)\/locandina)"/);
    const idTitolo = loc ? loc[2] : (tipo === "titolo" ? numero : "evento-" + numero);
    const titolo = testoPulito((blk.match(/<h4 class="title">([\s\S]*?)<\/h4>/) || [])[1] || "");
    if (!titolo) return;
    const f = films[idTitolo] || (films[idTitolo] = {
      cinebot_id: idTitolo, titolo: titolo,
      locandina: loc ? CINEBOT_SITO + loc[1] + "/hq" : "",
      url: CINEBOT_SITO + (tipo === "titolo" ? percorso : percorso),
      proiezioni: [],
    });
    const aggiungi = (key, data, ora) => { if (!f.proiezioni.some((p) => p.key === key)) f.proiezioni.push({ key: key, data: data, ora: ora }); };
    if (tipo === "evento") {
      // "Dom 01/11 21:00"
      const q = blk.match(/fa-calendar"><\/i>\s*[A-Za-zÀ-ú]+\s+(\d{1,2})\/(\d{1,2})\s+(\d{1,2}:\d{2})/);
      if (q) {
        const g = +q[1], m = +q[2];
        aggiungi("ev" + numero, annoPer(g, m, oggi) + "-" + ("0" + m).slice(-2) + "-" + ("0" + g).slice(-2), ("0" + q[3]).slice(-5));
      }
    } else {
      // pagina del titolo: una riga per ogni spettacolo, con data completa e ora
      const pagina = scaricaPagina(percorso);
      const righe = pagina.match(/<tr[^>]*data-date="\d{2}\/\d{2}\/\d{4}"[\s\S]*?<\/tr>/g) || [];
      righe.forEach((r) => {
        const d = r.match(/data-date="(\d{2})\/(\d{2})\/(\d{4})"/);
        const ev = r.match(/\/evento\/(\d+)/);
        const ora = r.match(/fa-clock"><\/i>\s*(\d{1,2}:\d{2})/);
        if (d && ev && ora) aggiungi("ev" + ev[1], d[3] + "-" + d[2] + "-" + d[1], ("0" + ora[1]).slice(-5));
      });
      f.url = CINEBOT_SITO + percorso;
    }
  });
  const elenco = Object.keys(films).map((k) => films[k]);
  if (!elenco.length) { Logger.log("Cinebot: nessun film trovato, la pagina potrebbe essere cambiata"); return; }
  const esito = rpc(cfg, "sync_cinebot_push", { p_films: elenco });
  Logger.log("Cinebot: " + JSON.stringify(esito));
}

/* ---------------- email ---------------- */

// legge le email con il servizio Gmail in sola lettura (non sposta, non etichetta, non cancella nulla)
function leggiEmail(cfg) {
  const account = Session.getActiveUser().getEmail() || "account";
  const lista = Gmail.Users.Threads.list("me", { q: RICERCA_EMAIL, maxResults: 30 });
  const items = [];
  (lista.threads || []).forEach((t) => {
    const msg = Gmail.Users.Threads.get("me", t.id, { format: "full" }).messages[0];
    const intestazione = (nome) => ((msg.payload.headers || []).find((h) => h.name.toLowerCase() === nome) || {}).value || "";
    const da = intestazione("from"), oggetto = intestazione("subject");
    if (/noreply|no-reply|newsletter|brevosend|mailchimp|notifiche|notification/i.test(da)) return;
    const ricevuta = new Date(Number(msg.internalDate));
    const testo = (corpoTesto(msg.payload) || msg.snippet || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    const quando = trovaDataOra(oggetto + "\n" + testo, ricevuta);
    const nome = (da.match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || "";
    const email = (da.match(/<([^>]+)>/) || [null, da])[1].trim();
    items.push({
      thread_id: t.id,
      link: "https://mail.google.com/mail/?authuser=" + encodeURIComponent(account) + "#all/" + t.id,
      mittente: nome || email,
      mittente_email: email,
      oggetto: oggetto,
      testo: testo.slice(0, 4000),
      data_proposta: quando.data,
      ora_proposta: quando.ora,
      ricevuta: ricevuta.toISOString(),
    });
  });
  const nuove = items.length ? rpc(cfg, "sync_email_push", { p_account: account, p_items: items }) : 0;
  Logger.log("Email: controllate " + items.length + ", nuove richieste " + nuove);
}

// testo semplice dell'email: la parte text/plain, altrimenti l'HTML ripulito
function corpoTesto(parte) {
  const decodifica = (d) => Utilities.newBlob(Utilities.base64DecodeWebSafe(d)).getDataAsString("UTF-8");
  const trova = (p, tipo) => {
    if (p.mimeType === tipo && p.body && p.body.data) return decodifica(p.body.data);
    for (const sub of p.parts || []) { const r = trova(sub, tipo); if (r) return r; }
    return "";
  };
  const plain = trova(parte, "text/plain");
  if (plain) return plain;
  return trova(parte, "text/html").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]{2,}/g, " ");
}

const MESI = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };

// riconosce "4 dicembre 2026", "giovedì 4 dicembre", "04/12/2026", "4/12" e "ore 20.45", "alle 20:30", "dalle 18"
function trovaDataOra(testo, ricevuta) {
  const s = testo.toLowerCase();
  let g = null, m = null, y = null;
  let r = s.match(/\b(\d{1,2})\s*(?:°|º)?\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?/);
  if (r) { g = +r[1]; m = MESI[r[2]]; y = r[3] ? +r[3] : null; }
  else {
    r = s.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
    if (r && +r[2] >= 1 && +r[2] <= 12 && +r[1] >= 1 && +r[1] <= 31) { g = +r[1]; m = +r[2]; y = r[3] ? (+r[3] < 100 ? 2000 + +r[3] : +r[3]) : null; }
  }
  let data = "";
  if (g && m) {
    if (!y) {
      y = ricevuta.getFullYear();
      const prova = new Date(y, m - 1, g);
      if (prova < new Date(ricevuta.getFullYear(), ricevuta.getMonth(), ricevuta.getDate())) y++;
    }
    data = y + "-" + ("0" + m).slice(-2) + "-" + ("0" + g).slice(-2);
  }
  let ora = "";
  const o = s.match(/\b(?:ore|alle|dalle|h\.?)\s*(\d{1,2})(?:[.:,](\d{2}))?\b/);
  if (o && +o[1] < 24) ora = ("0" + o[1]).slice(-2) + ":" + (o[2] || "00");
  return { data: data, ora: ora };
}

/* ---------------- prova manuale ---------------- */

function provaRiconoscimento() {
  Logger.log(JSON.stringify(trovaDataOra("data evento: 4 dicembre 2026 ore 20.45; luogo: Sala San Tommaso Moro", new Date())));
  Logger.log(JSON.stringify(analizzaTitolo("Conferenza astronomica del Prof. Barbieri a cura dell'Associazione Palladio (galleria 124 ps). Ref. Carnio Valerio 333-3899850")));
  Logger.log(JSON.stringify(analizzaTitolo("Evento AIDO - In Sala Luigi Bacialli. Ref. Guerra Dario 340-9500022.  EVENTO DA PERFEZIONARE!!!")));
}
