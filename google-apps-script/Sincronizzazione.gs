// © 2026 Fabio Santi, per la Sala San Tommaso Moro. Tutti i diritti riservati (vedi LICENSE).
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
 *                  anche la programmazione da Cinebot (es. "lettura+email+cinema"); aggiungi "+c1" per leggere
 *                  i riepiloghi C1 dalla cartella Drive e dagli allegati email (es. "lettura+email+cinema+c1")
 *   C1_CARTELLA    (facoltativo) id della cartella Drive con i C1; se manca si usa quella della sala
 *                  aggiungi "+primanota" per leggere la contabilità (file .xlsx nella cartella PRIMA NOTA)
 *   PRIMA_NOTA_FILE (facoltativo) id del file .xlsx della prima nota; se manca si usa il più recente della cartella
 *                  aggiungi "+sas" per copiare nell'app le email di ACEC Triveneta (conferme di programmazione e
 *                  risposte alle richieste di film); va messo nell'account che riceve le email del SAS
 *                  aggiungi "+foglietto" per mandare ogni giovedì mattina al parroco l'email con il programma della
 *                  settimana per il foglietto parrocchiale (destinatario e testo si impostano nell'app, in Sito web);
 *                  serve il permesso di inviare email (script.send_mail in appsscript.json)
 *                  aggiungi "+rubrica" (nell'account della sala) per portare nella rubrica dell'app le persone con cui
 *                  la sala ha scambiato email: solo le conversazioni in cui la sala ha scritto o risposto (niente
 *                  pubblicità né newsletter), con nome, indirizzo, telefono trovato nella firma e ultima email.
 *                  La prima volta legge tutta la posta inviata, un po' alla volta; poi ogni 6 ore le novità.
 *                  Se nell'account della sala lo script serve solo per questo, basta MODALITA = "rubrica": non tocca
 *                  il calendario e non legge le richieste (lo fa già l'altro account). Lo SYNC_TOKEN può essere lo stesso.
 *   CALENDARIO     (facoltativo) id del calendario; se manca si usa quello principale dell'account
 *   CALENDARIO_APP (per la modalità "+app") id di un SECONDO calendario, es. «Sala – App», che lo script tiene
 *                  allineato con l'app: prenotazioni nate nell'app o dalle email, proiezioni del cinema, sopralluoghi.
 *                  Il calendario principale resta in sola lettura. Serve il permesso di scrittura sul calendario
 *                  (in appsscript.json: calendar al posto di calendar.readonly). Lo script modifica e cancella solo
 *                  gli eventi che ha creato lui in quel calendario; quelli aggiunti a mano restano.
 *
 * PERMESSI: insieme a questo file va copiato anche "appsscript.json" (manifest), che limita lo script
 * alla SOLA LETTURA di calendario ed email. Google stesso impedisce allo script qualsiasi modifica.
 * (Solo per la modalità "calendario+email" va sostituito calendar.readonly con calendar.)
 *
 * Poi esegui una volta la funzione "installa": chiede i permessi e attiva il controllo ogni 15 minuti.
 */

const VERSIONE_SCRIPT = "2026-11-03.1"; // compare nel log: serve a capire se il codice incollato è l'ultimo
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
  // ogni parte va avanti anche se un'altra dà errore; gli errori finiscono nel log e alla fine fanno fallire l'esecuzione
  const errori = [];
  const prova = (nome, fn) => { try { fn(); } catch (e) { errori.push(nome + ": " + e.message); Logger.log("ERRORE " + nome + ": " + e.message); } };
  try {
    Logger.log("Script versione " + VERSIONE_SCRIPT + " · modalità: " + cfg.modalita);
    spostaMemoriaC1();
    const scrivi = cfg.modalita.indexOf("calendario") !== -1;
    if (scrivi || cfg.modalita.indexOf("lettura") !== -1) prova("calendario", () => sincronizzaCalendario(cfg, scrivi));
    if (cfg.modalita.indexOf("email") !== -1) prova("email", () => leggiEmail(cfg));
    if (cfg.modalita.indexOf("cinema") !== -1) prova("cinema", () => leggiCinebotSeServe(cfg));
    if (cfg.modalita.indexOf("c1") !== -1) prova("c1", () => leggiC1(cfg, 30));
    if (cfg.modalita.indexOf("primanota") !== -1) prova("prima nota", () => leggiPrimaNota(cfg, false));
    if (cfg.modalita.indexOf("sas") !== -1) prova("sas", () => leggiSas(cfg));
    if (/(^|\+)app(\+|$)/.test(cfg.modalita)) prova("calendario dell'app", () => sincronizzaCalendarioApp(cfg));
    if (cfg.modalita.indexOf("foglietto") !== -1) prova("foglietto", () => inviaFogliettoSeServe(cfg));
    if (cfg.modalita.indexOf("rubrica") !== -1) prova("rubrica", () => leggiRubricaSeServe(cfg));
  } finally {
    lock.releaseLock();
  }
  if (errori.length) throw new Error(errori.join(" | "));
}

// da eseguire a mano per verificare la lettura di Cinebot: ignora il limite di una volta all'ora
function provaCinebot() {
  const cfg = leggiImpostazioni();
  Logger.log("Modalità: " + cfg.modalita + (cfg.modalita.indexOf("cinema") === -1 ? "  ← manca «+cinema»: la lettura automatica non partirà" : ""));
  leggiCinebot(cfg);
  PropertiesService.getScriptProperties().setProperty("CINEBOT_ULTIMA", String(Date.now()));
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
    calendarioApp: p.CALENDARIO_APP || "",
    c1Cartella: p.C1_CARTELLA || C1_CARTELLA_SALA,
    primaNotaCartella: p.PRIMA_NOTA_CARTELLA || PRIMA_NOTA_CARTELLA,
    primaNotaFile: p.PRIMA_NOTA_FILE || "",
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

/* ---------------- secondo calendario, gestito dall'app ---------------- */
const CHIAVE_APP = "chiaveSalaApp"; // tag invisibile con la chiave dell'elemento dell'app (b:prenotazione, p:proiezione, s:sopralluogo)
function sincronizzaCalendarioApp(cfg) {
  if (!cfg.calendarioApp) throw new Error("Manca la proprietà CALENDARIO_APP (id del secondo calendario)");
  const cal = CalendarApp.getCalendarById(cfg.calendarioApp);
  if (!cal) throw new Error("Calendario dell'app non trovato: " + cfg.calendarioApp);
  const principale = calendario(cfg);
  if (principale && principale.getId() === cal.getId()) throw new Error("CALENDARIO_APP deve essere un calendario diverso da quello principale della sala");
  const voluti = rpc(cfg, "sync_calendario_app", {}) || [];
  const oggi = new Date(), da = new Date(oggi.getTime() - 31 * 864e5), a = new Date(oggi.getTime() + 367 * 864e5);
  const esistenti = {};
  cal.getEvents(da, a).forEach((e) => { const k = e.getTag(CHIAVE_APP); if (k) { if (esistenti[k]) e.deleteEvent(); else esistenti[k] = e; } });
  let creati = 0, aggiornati = 0, cancellati = 0, cambi = 0;
  const MAX = 80; // al massimo 80 modifiche per giro, il resto al giro dopo (limiti di Google Calendar)
  voluti.forEach((v) => {
    if (cambi >= MAX) return;
    const e = esistenti[v.chiave];
    delete esistenti[v.chiave];
    const inizio = v.giornata ? dataLocale(v.data, "00:00") : dataLocale(v.data, v.inizio);
    const fine = v.giornata ? null : dataLocale(v.data, v.fine > v.inizio ? v.fine : "23:59");
    if (e && e.isAllDayEvent() === !!v.giornata) {
      const ok = e.getTitle() === v.titolo && (e.getDescription() || "") === (v.descrizione || "") &&
        (v.giornata ? e.getAllDayStartDate().getTime() === inizio.getTime() : e.getStartTime().getTime() === inizio.getTime() && e.getEndTime().getTime() === fine.getTime());
      if (ok) return;
      e.setTitle(v.titolo); e.setDescription(v.descrizione || "");
      if (v.giornata) e.setAllDayDate(inizio); else e.setTime(inizio, fine);
      aggiornati++; cambi++;
      return;
    }
    if (e) { e.deleteEvent(); cambi++; }
    const nuovo = v.giornata ? cal.createAllDayEvent(v.titolo, inizio) : cal.createEvent(v.titolo, inizio, fine);
    nuovo.setDescription(v.descrizione || "");
    nuovo.setTag(CHIAVE_APP, v.chiave);
    creati++; cambi++;
    Utilities.sleep(120);
  });
  // ciò che non c'è più nell'app (annullato, spostato fuori periodo, cancellato): solo eventi creati dallo script
  Object.keys(esistenti).forEach((k) => { if (cambi < MAX) { esistenti[k].deleteEvent(); cancellati++; cambi++; } });
  Logger.log("Calendario dell'app: " + voluti.length + " elementi · creati " + creati + ", aggiornati " + aggiornati + ", cancellati " + cancellati + (cambi >= MAX ? " (continua al prossimo giro)" : ""));
}
// da eseguire a mano per provare il calendario dell'app
function provaCalendarioApp() {
  const cfg = leggiImpostazioni();
  Logger.log("Modalità: " + cfg.modalita + (/(^|\+)app(\+|$)/.test(cfg.modalita) ? "" : "  ← manca «+app»: l'aggiornamento automatico non partirà"));
  sincronizzaCalendarioApp(cfg);
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
    comune: p.comune,
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
  // serate della convenzione con il Comune: «Comune», «comunale» (Amministrazione comunale, Consiglio comunale…)
  const comune = /\b(comune|comunale|comunali)\b/i.test(t);
  return { titolo: titolo || t, referente: referente, telefono: telefono, stato: stato, comune: comune };
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
  const res = UrlFetchApp.fetch(CINEBOT_SITO + percorso, {
    muteHttpExceptions: true, followRedirects: true,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SalaSanTommasoMoro/1.0)", "Accept-Language": "it-IT,it;q=0.9" },
  });
  if (res.getResponseCode() !== 200) throw new Error("Cinebot " + percorso + " → HTTP " + res.getResponseCode() + " " + res.getContentText().slice(0, 200));
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
  Logger.log("Cinebot: pagina scaricata, " + home.length + " caratteri");
  const blocchi = home.match(/<a href="\/s\.tommasomoro\/(?:evento|titolo)\/\d+_[^"]*" class="eventi-item[\s\S]*?<\/a>/g) || [];
  blocchi.forEach((blk) => {
    const link = blk.match(/href="(\/s\.tommasomoro\/(evento|titolo)\/(\d+)_[^"]*)"/);
    const percorso = link[1], tipo = link[2], numero = link[3];
    const loc = blk.match(/src="(\/s\.tommasomoro\/titolo\/(\d+)\/locandina)"/);
    const idTitolo = loc ? loc[2] : (tipo === "titolo" ? numero : "evento-" + numero);
    const titolo = testoPulito((blk.match(/<h4 class="title">([\s\S]*?)<\/h4>/) || [])[1] || "");
    if (!titolo) return;
    // indizi per capire se è un film o un altro spettacolo: sottotitolo, prezzo, visto di censura (solo i film)
    const sotto = testoPulito((blk.match(/<h5 class="title">([\s\S]*?)<\/h5>/) || [])[1] || "");
    const prezzo = blk.match(/fa-shopping-cart"><\/i>\s*&euro;\s*([\d.,]+)/);
    const visto = testoPulito((blk.match(/class="film-classificazione-testo">([\s\S]*?)<\/div>/) || [])[1] || "");
    const f = films[idTitolo] || (films[idTitolo] = {
      cinebot_id: idTitolo, titolo: titolo,
      locandina: loc ? CINEBOT_SITO + loc[1] + "/hq" : "",
      url: CINEBOT_SITO + (tipo === "titolo" ? percorso : percorso),
      info: {},
      proiezioni: [],
    });
    if (sotto) f.info.sottotitolo = sotto;
    if (prezzo) f.info.prezzo = Number(prezzo[1].replace(",", "."));
    if (visto) f.info.classificazione = visto;
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

/* ---------------- foglietto parrocchiale ---------------- */

const GIORNI_IT = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const MESI_IT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
function dataIt(iso, conGiorno) {
  const p = iso.split("-").map(Number), d = new Date(p[0], p[1] - 1, p[2]);
  return (conGiorno ? GIORNI_IT[d.getDay()] + " " : "") + p[2] + " " + MESI_IT[p[1] - 1];
}

// il giovedì dalle 7, una volta sola: l'email al parroco con gli appuntamenti pubblici della settimana
function inviaFogliettoSeServe(cfg) {
  const ora = new Date();
  if (Utilities.formatDate(ora, FUSO, "u") !== "4" || Number(Utilities.formatDate(ora, FUSO, "H")) < 7) return;
  const d = rpc(cfg, "sync_foglietto", {});
  if (!d || !d.attivo || !d.email || d.inviato === d.oggi) return;
  mandaFoglietto(d, d.email);
  rpc(cfg, "sync_foglietto_inviato", {});
  Logger.log("Foglietto: email mandata a " + d.email);
}

// da eseguire a mano: manda l'email di prova a te (all'account dello script), non al parroco
function provaFoglietto() {
  const cfg = leggiImpostazioni();
  const d = rpc(cfg, "sync_foglietto", {});
  const me = Session.getEffectiveUser().getEmail();
  mandaFoglietto(d, me);
  Logger.log("Foglietto: email di prova mandata a " + me + (cfg.modalita.indexOf("foglietto") === -1 ? "  ← manca «+foglietto» nella MODALITA: il giovedì non partirà da sola" : ""));
}

function testoFoglietto(d) {
  // un rigo per giorno e titolo, con tutti gli orari
  const righe = [];
  (d.voci || []).forEach((v) => {
    const r = righe.find((x) => x.data === v.data && x.titolo === v.titolo);
    if (r) { if (v.ora) r.ore.push(v.ora); return; }
    righe.push({ data: v.data, titolo: v.titolo, tipo: v.tipo, ore: v.ora ? [v.ora] : [], prezzo: v.prezzo });
  });
  const riga = (r) => {
    const giorno = dataIt(r.data, true).replace(/^./, (c) => c.toUpperCase());
    const cosa = (["Sala", "Comune"].indexOf(r.tipo) === -1 ? r.tipo + ": " : "") + "«" + r.titolo + "»";
    const ore = r.ore.length ? ", ore " + r.ore.join(" e ") : "";
    const ingresso = r.prezzo === 0 ? " – ingresso libero" : r.prezzo > 0 ? " – ingresso " + String(r.prezzo).replace(".", ",") + " €" : "";
    return giorno + " – " + cosa + ore + ingresso;
  };
  const periodo = "da " + dataIt(d.dal, true) + " a " + dataIt(d.al, true);
  const saluto = "Caro " + (d.nome || "don Giorgio") + ",";
  const corpo = righe.length
    ? ["ecco gli appuntamenti della Sala San Tommaso Moro per il foglietto parrocchiale, " + periodo + ":", "", "SALA SAN TOMMASO MORO"].concat(righe.map(riga))
    : ["questa settimana (" + periodo + ") in Sala San Tommaso Moro non ci sono appuntamenti aperti al pubblico."];
  const testo = [saluto].concat(corpo, d.note ? ["", d.note] : [], ["", "Programma e biglietti: www.salasantommasomoro.it", "", "Grazie e buona giornata,", d.firma || "Sala San Tommaso Moro"]).join("\n");
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">' + testo.split("\n").map((l) => l === "SALA SAN TOMMASO MORO" ? "<b>" + l + "</b>" : esc(l)).join("<br>") + "</div>";
  return { oggetto: "Sala San Tommaso Moro – programma per il foglietto (" + dataIt(d.dal) + " – " + dataIt(d.al) + ")", testo: testo, html: html };
}

function mandaFoglietto(d, a) {
  const t = testoFoglietto(d);
  MailApp.sendEmail({ to: a, subject: t.oggetto, body: t.testo, htmlBody: t.html, name: "Sala San Tommaso Moro" });
}

/* ---------------- C1 (riepiloghi SIAE) ---------------- */

const C1_CARTELLA_SALA = "1LijEKEdzesBJlG57_fbOWlNcSnaQ05GL"; // cartella "C1" su Drive dell'account della sala
const C1_DAL = "2026-01-01";
const C1_RICERCA_EMAIL = "has:attachment filename:pdf newer_than:60d (C1 OR C1E OR riepilogo OR bordero OR borderò OR cinebot)";

// legge i PDF non ancora letti (cartella Drive e allegati email), al massimo `limite` per volta
function leggiC1(cfg, limite) {
  const props = memoriaC1();
  const fatti = (k) => props.getProperty("C1_" + k) === "1";
  const segna = (k) => props.setProperty("C1_" + k, "1");
  const daLeggere = [];

  // 1) cartella Drive (servizio DriveApp incluso in Apps Script, in sola lettura)
  const file = DriveApp.getFolderById(cfg.c1Cartella).getFilesByType(MimeType.PDF);
  while (file.hasNext()) {
    const f = file.next();
    const chiave = f.getId() + "_" + f.getLastUpdated().getTime();
    if (!fatti(chiave)) daLeggere.push({ chiave: chiave, nome: f.getName(), fonte: "drive", fonte_id: f.getId(), scarica: () => f.getBlob() });
  }

  // 2) allegati email
  const lista = Gmail.Users.Messages.list("me", { q: C1_RICERCA_EMAIL, maxResults: 50 });
  (lista.messages || []).forEach((m) => {
    if (fatti("mail_" + m.id)) return;
    const msg = Gmail.Users.Messages.get("me", m.id, { format: "full" });
    const allegati = [];
    const cerca = (p) => { if (p.filename && /\.pdf$/i.test(p.filename) && p.body && p.body.attachmentId) allegati.push(p); (p.parts || []).forEach(cerca); };
    cerca(msg.payload);
    if (!allegati.length) { segna("mail_" + m.id); return; }
    allegati.forEach((a, i) => daLeggere.push({
      chiave: i === allegati.length - 1 ? "mail_" + m.id : "mail_" + m.id + "_" + i, nome: a.filename, fonte: "email", fonte_id: m.id,
      scarica: () => Utilities.newBlob(byteDaGmail(Gmail.Users.Messages.Attachments.get("me", m.id, a.body.attachmentId).data), "application/pdf", a.filename),
    }));
  });

  const eventi = [], daSegnare = [];
  let letti = 0, scartati = 0;
  for (const f of daLeggere) {
    if (letti >= limite) break;
    letti++;
    try {
      const trovati = analizzaC1(testoDaPdfLocale(f.scarica().getBytes()));
      if (!trovati.length) scartati++;
      trovati.filter((e) => e.data >= C1_DAL).forEach((e) => eventi.push(Object.assign(e, { fonte: f.fonte, fonte_id: f.fonte_id, file_nome: f.nome })));
      daSegnare.push(f.chiave);
    } catch (err) {
      Logger.log("C1 non letto: " + f.nome + " → " + err.message);
    }
  }
  // i file si segnano come letti solo dopo che l'app ha ricevuto i dati: se l'invio fallisce, al giro dopo si riprova
  let esito = { c1: 0 };
  for (let i = 0; i < eventi.length; i += 25) {
    const r = rpc(cfg, "sync_c1_push", { p_items: eventi.slice(i, i + 25) });
    esito = { c1: esito.c1 + ((r && r.c1) || 0) };
  }
  daSegnare.forEach(segna);
  Logger.log("C1: file letti " + letti + " di " + daLeggere.length + " da leggere (" + scartati + " non sono C1), serate dal 2026 trovate " + eventi.length + " → " + JSON.stringify(esito));
}

// ---- decompressore DEFLATE minimo (formato zlib/FlateDecode), per leggere i PDF senza servizi esterni ----
function inflaZlib(dati) {
  const src = dati, out = [];
  let pos = 2, bitBuf = 0, bitCnt = 0; // salto l'intestazione zlib (2 byte)
  const bit = (n) => { while (bitCnt < n) { if (pos >= src.length) throw new Error("PDF troncato"); bitBuf |= (src[pos++] & 255) << bitCnt; bitCnt += 8; } const v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitCnt -= n; return v; };
  const costruisci = (lunghezze) => {
    const conta = new Array(16).fill(0), offs = new Array(16).fill(0), simboli = [];
    lunghezze.forEach((l) => conta[l]++); conta[0] = 0;
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + conta[i - 1];
    lunghezze.forEach((l, s) => { if (l) simboli[offs[l]++] = s; });
    return { conta, simboli };
  };
  const decodifica = (t) => {
    let codice = 0, primo = 0, indice = 0;
    for (let l = 1; l < 16; l++) {
      codice |= bit(1); const c = t.conta[l];
      if (codice - c < primo) return t.simboli[indice + (codice - primo)];
      indice += c; primo += c; primo <<= 1; codice <<= 1;
    }
    throw new Error("Codice non valido nel PDF");
  };
  const BASE_L = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const EXTRA_L = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const BASE_D = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const EXTRA_D = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const fissaL = costruisci(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)));
  const fissaD = costruisci(new Array(30).fill(5));
  let ultimo = 0;
  while (!ultimo) {
    ultimo = bit(1);
    const tipo = bit(2);
    if (tipo === 0) {
      bitBuf = 0; bitCnt = 0;
      const len = (src[pos] & 255) | ((src[pos + 1] & 255) << 8); pos += 4;
      for (let i = 0; i < len; i++) out.push(src[pos++] & 255);
      continue;
    }
    let tl, td;
    if (tipo === 1) { tl = fissaL; td = fissaD; }
    else if (tipo === 2) {
      const hl = bit(5) + 257, hd = bit(5) + 1, hc = bit(4) + 4;
      const ordine = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const lc = new Array(19).fill(0);
      for (let i = 0; i < hc; i++) lc[ordine[i]] = bit(3);
      const tc = costruisci(lc), lens = [];
      while (lens.length < hl + hd) {
        const s = decodifica(tc);
        if (s < 16) lens.push(s);
        else if (s === 16) { const p = lens[lens.length - 1]; for (let r = bit(2) + 3; r > 0; r--) lens.push(p); }
        else if (s === 17) { for (let r = bit(3) + 3; r > 0; r--) lens.push(0); }
        else { for (let r = bit(7) + 11; r > 0; r--) lens.push(0); }
      }
      tl = costruisci(lens.slice(0, hl)); td = costruisci(lens.slice(hl));
    } else throw new Error("Blocco compresso non valido");
    for (;;) {
      let s = decodifica(tl);
      if (s < 256) { out.push(s); continue; }
      if (s === 256) break;
      s -= 257;
      const len = BASE_L[s] + bit(EXTRA_L[s]);
      const ds = decodifica(td), dist = BASE_D[ds] + bit(EXTRA_D[ds]);
      for (let i = 0; i < len; i++) out.push(out[out.length - dist]);
    }
  }
  return out;
}

// estrae il testo dai PDF semplici (come i C1 di Cinebot/JasperReports): ricompone le righe in base alla posizione
function testoDaPdfLocale(byte) {
  const b = Array.from(byte, (x) => x & 255);
  const latin = (arr) => arr.map((c) => String.fromCharCode(c)).join("");
  const testo = latin(b);
  const pezzi = [];
  const reStream = /<<([^]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = reStream.exec(testo))) {
    const inizio = reStream.lastIndex, fine = testo.indexOf("endstream", inizio);
    if (fine < 0) break;
    let dati = b.slice(inizio, fine);
    if (/FlateDecode/.test(m[1])) { try { dati = inflaZlib(dati); } catch (e) { continue; } }
    else if (/\/Filter/.test(m[1])) continue;
    pezzi.push(latin(dati));
  }
  const voci = [];
  pezzi.forEach((p) => {
    const blocchi = p.split(/\bBT\b/).slice(1);
    blocchi.forEach((bl) => {
      const corpo = bl.split(/\bET\b/)[0];
      let x = 0, y = 0;
      const tm = corpo.match(/([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm/);
      if (tm) { x = +tm[5]; y = +tm[6]; }
      const td = corpo.match(/([-\d.]+)\s+([-\d.]+)\s+Td/);
      if (!tm && td) { x = +td[1]; y = +td[2]; }
      let s = "";
      const reStr = /\((?:\\.|[^\\)])*\)\s*Tj|\[(?:[^\]]*)\]\s*TJ/g;
      let k;
      while ((k = reStr.exec(corpo))) {
        const parti = k[0].match(/\((?:\\.|[^\\)])*\)/g) || [];
        s += parti.map((q) => q.slice(1, -1).replace(/\\([nrtbf()\\]|\d{1,3})/g, (_, e) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" }[e] || String.fromCharCode(parseInt(e, 8))))).join("");
      }
      if (s.trim()) voci.push({ x, y, s: s.trim() });
    });
  });
  // righe dall'alto in basso, parole da sinistra a destra (tolleranza di 3 punti sull'altezza)
  voci.sort((a, c) => c.y - a.y || a.x - c.x);
  const righe = [];
  voci.forEach((v) => {
    const r = righe.find((rr) => Math.abs(rr.y - v.y) <= 3);
    if (r) r.v.push(v); else righe.push({ y: v.y, v: [v] });
  });
  righe.sort((a, c) => c.y - a.y);
  return righe.map((r) => r.v.sort((a, c) => a.x - c.x).map((v) => v.s).join(" ")).join("\n");
}

// riconosce uno o più eventi in un riepilogo C1 (testo estratto dal PDF)
const NUM = "\\d{1,3}(?:\\.\\d{3})*,\\d{2}";
function numIt(s) { return Number(String(s).replace(/\./g, "").replace(",", ".")) || 0; }
function analizzaC1(testoGrezzo) {
  const t = testoGrezzo.replace(/\s+/g, " ");
  const parti = t.split(/Titolo dell'opera\s*\/\s*manifestazione:/i).slice(1);
  const eventi = [];
  const prima = t.split(/Titolo dell'opera\s*\/\s*manifestazione:/i);
  parti.forEach((p, i) => {
    const intestazione = prima[i];
    const tipo = (intestazione.match(/Tipo evento \(1\):\s*([^:]*?)\s*$/i) || [])[1] || "";
    const titolo = ((p.match(/^\s*(.*?)\s+Autore:/) || [])[1] || "").trim();
    const autore = ((p.match(/Autore:\s*(.*?)\s+Esecutore:/) || [])[1] || "").trim();
    const naz = ((p.match(/Nazionalit[àa]:\s*(.*?)\s+Numero opere/) || [])[1] || "").trim();
    const d = p.match(/Data evento:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    const o = p.match(/Ora evento:\s*(\d{1,2})[.:,](\d{2})/);
    if (!titolo || !d) return;
    const fine = p.search(/TOTALE GENERALE:/i);
    const corpo = fine >= 0 ? p.slice(0, fine + 200) : p;
    const reRiga = new RegExp("\\b([A-Z]{2})\\s+(\\d+)\\s+([A-Z]\\d{1,2})\\s+(?:([A-Za-zÀ-ú][A-Za-zÀ-ú .'-]*?)\\s+)?(" + NUM + ")\\s+(\\d+)\\s+(" + NUM + ")\\s+(" + NUM + ")\\s+(" + NUM + ")\\s+(" + NUM + ")\\s+(" + NUM + ")\\s+(" + NUM + ")\\s+(\\d+)", "g");
    const righe = [];
    const preassolta = corpo.search(/TOTALE IVA da assolvere:/i);
    let m;
    while ((m = reRiga.exec(corpo))) {
      righe.push({
        settore: m[1], capienza: Number(m[2]), codice: m[3], descrizione: (m[4] || "").trim(), prezzo: numIt(m[5]), n: Number(m[6]),
        lordo: numIt(m[7]), imponibile_iva: numIt(m[11]), iva: numIt(m[12]), annullati: Number(m[13]),
        iva_preassolta: preassolta >= 0 && m.index > preassolta,
      });
    }
    const tot = corpo.match(new RegExp("TOTALE GENERALE:\\s*(\\d+)\\s+(" + NUM + ")\\s+(" + NUM + ")\\s+(" + NUM + ")\\s+(" + NUM + ")\\s+(" + NUM + ")\\s+(" + NUM + ")", "i"));
    const omaggi = righe.filter((r) => r.prezzo === 0 || /^O/.test(r.codice)).reduce((s, r) => s + r.n, 0);
    const spettatori = tot ? Number(tot[1]) : righe.reduce((s, r) => s + r.n, 0);
    eventi.push({
      titolo, autore, nazionalita: naz, tipo_evento: tipo.replace(/^\d+\s*-?\s*/, "").trim(),
      data: d[3] + "-" + d[2] + "-" + d[1], ora: o ? ("0" + o[1]).slice(-2) + ":" + o[2] : "00:00",
      spettatori, omaggi, paganti: spettatori - omaggi, capienza: righe.reduce((mx, r) => Math.max(mx, r.capienza || 0), 0),
      lordo: tot ? numIt(tot[2]) : righe.reduce((s, r) => s + r.lordo, 0),
      imponibile_iva: tot ? numIt(tot[6]) : righe.reduce((s, r) => s + r.imponibile_iva, 0),
      iva: tot ? numIt(tot[7]) : righe.reduce((s, r) => s + r.iva, 0),
      righe,
    });
  });
  return eventi;
}

// dimentica quali C1 sono già stati letti: al prossimo giro vengono riletti tutti (nell'app non si duplicano)
function azzeraC1() {
  spostaMemoriaC1();
  const props = memoriaC1();
  const chiavi = Object.keys(props.getProperties()).filter((k) => k.indexOf("C1_") === 0);
  chiavi.forEach((k) => props.deleteProperty(k));
  Logger.log("Memoria dei C1 azzerata (" + chiavi.length + " voci): verranno riletti tutti");
}

// la memoria dei C1 già letti sta tra le proprietà dell'utente, così non riempie l'elenco delle Proprietà script
function memoriaC1() { return PropertiesService.getUserProperties(); }

// sposta la vecchia memoria dei C1 fuori dalle Proprietà script (le versioni precedenti la salvavano lì)
function spostaMemoriaC1() {
  const script = PropertiesService.getScriptProperties(), utente = memoriaC1();
  const vecchie = Object.keys(script.getProperties()).filter((k) => k.indexOf("C1_") === 0 && k !== "C1_CARTELLA");
  vecchie.forEach((k) => { utente.setProperty(k, script.getProperty(k)); script.deleteProperty(k); });
  return vecchie.length;
}

// da eseguire a mano una volta: ripulisce l'elenco delle Proprietà script e attiva tutte le letture
function sistemaProprieta() {
  const spostate = spostaMemoriaC1();
  const script = PropertiesService.getScriptProperties();
  const parti = (script.getProperty("MODALITA") || "").toLowerCase().split("+").filter(Boolean);
  if (parti.indexOf("calendario") === -1 && parti.indexOf("lettura") === -1) parti.unshift("lettura");
  ["email", "cinema", "c1", "primanota"].forEach((p) => { if (parti.indexOf(p) === -1) parti.push(p); });
  script.setProperty("MODALITA", parti.join("+"));
  Logger.log("Spostate " + spostate + " voci di memoria dei C1 fuori dall'elenco. Proprietà script rimaste: " + Object.keys(script.getProperties()).join(", "));
  Logger.log("MODALITA ora è: " + parti.join("+"));
}

// da eseguire a mano: azzera la memoria, mostra cosa legge dal C1 più recente, poi legge subito fino a 60 C1
function provaC1() {
  const cfg = leggiImpostazioni();
  azzeraC1();
  Logger.log("Script versione " + VERSIONE_SCRIPT + " · modalità: " + cfg.modalita + (cfg.modalita.indexOf("c1") === -1 ? "  ← manca «+c1»: la lettura automatica non partirà" : ""));
  const it = DriveApp.getFolderById(cfg.c1Cartella).getFilesByType(MimeType.PDF);
  let ultimo = null;
  while (it.hasNext()) { const f = it.next(); if (!ultimo || f.getLastUpdated() > ultimo.getLastUpdated()) ultimo = f; }
  if (ultimo) {
    const testo = testoDaPdfLocale(ultimo.getBlob().getBytes());
    Logger.log("Esempio (" + ultimo.getName() + "): " + testo.replace(/\s+/g, " ").slice(0, 700));
    Logger.log("Riconosciuto: " + JSON.stringify(analizzaC1(testo).map((e) => ({ titolo: e.titolo, data: e.data, ora: e.ora, spettatori: e.spettatori, lordo: e.lordo }))));
  } else Logger.log("Nella cartella C1 non trovo PDF: controlla C1_CARTELLA");
  leggiC1(cfg, 60);
}

/* ---------------- Prima nota (file Excel .xlsx su Drive) ---------------- */

const PRIMA_NOTA_CARTELLA = "14D2sZWpTAGwkIJi27V22NpWvVDkUkTF-"; // cartella "PRIMA NOTA" su Drive della sala

// legge la prima nota solo quando il file è cambiato (o sempre, con forza = true)
function leggiPrimaNota(cfg, forza) {
  const props = PropertiesService.getScriptProperties();
  const file = filePrimaNota(cfg);
  if (!file) { Logger.log("Prima nota: nessun file .xlsx nella cartella"); return; }
  const chiave = file.getId() + "_" + file.getLastUpdated().getTime();
  if (!forza && props.getProperty("PN_ULTIMO") === chiave) return;
  const righe = primaNotaDaXlsx(file.getBlob());
  if (!righe.length) throw new Error("Prima nota: nel file «" + file.getName() + "» non trovo il foglio «Prima nota» con i movimenti");
  const esito = rpc(cfg, "sync_prima_nota_push", { p_file: file.getName(), p_rows: righe });
  props.setProperty("PN_ULTIMO", chiave);
  const e = righe.reduce((s, r) => s + (r.entrate || 0), 0), u = righe.reduce((s, r) => s + (r.uscite || 0), 0);
  Logger.log("Prima nota «" + file.getName() + "»: " + righe.length + " movimenti, entrate " + e.toFixed(2) + ", uscite " + u.toFixed(2) + " → " + JSON.stringify(esito));
}

// il file .xlsx più recente nella cartella della prima nota (o quello indicato in PRIMA_NOTA_FILE)
function filePrimaNota(cfg) {
  if (cfg.primaNotaFile) return DriveApp.getFileById(cfg.primaNotaFile);
  const it = DriveApp.getFolderById(cfg.primaNotaCartella).getFiles();
  let migliore = null;
  while (it.hasNext()) {
    const f = it.next();
    if (!/\.xlsx$/i.test(f.getName())) continue;
    if (!migliore || f.getLastUpdated() > migliore.getLastUpdated()) migliore = f;
  }
  return migliore;
}

// apre il file Excel (è uno zip di file XML) e ne legge i fogli come tabelle di valori
function fogliXlsx(blob) {
  const voci = {};
  Utilities.unzip(Utilities.newBlob(blob.getBytes(), "application/zip", "file.zip")).forEach((b) => (voci[b.getName()] = b));
  const testo = (n) => (voci[n] ? voci[n].getDataAsString("UTF-8") : "");
  const xmlTesto = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
  const condivise = (testo("xl/sharedStrings.xml").match(/<si>[\s\S]*?<\/si>/g) || [])
    .map((si) => xmlTesto((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  const rels = {};
  (testo("xl/_rels/workbook.xml.rels").match(/<Relationship\b[^>]*>/g) || []).forEach((r) => {
    const id = (r.match(/Id="([^"]+)"/) || [])[1], t = (r.match(/Target="([^"]+)"/) || [])[1];
    if (id && t) rels[id] = t.replace(/^\/?(xl\/)?/, "xl/");
  });
  const fogli = {};
  (testo("xl/workbook.xml").match(/<sheet\b[^>]*>/g) || []).forEach((s) => {
    const nome = xmlTesto((s.match(/name="([^"]*)"/) || [])[1] || "");
    const rid = (s.match(/r:id="([^"]+)"/) || [])[1];
    const xml = testo(rels[rid] || "");
    const righe = [];
    (xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) || []).forEach((riga) => {
      const r = +((riga.match(/<row\b[^>]*\br="(\d+)"/) || [])[1]) || righe.length + 1;
      const valori = [];
      (riga.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) || []).forEach((c) => {
        const ref = (c.match(/\br="([A-Z]+)\d+"/) || [])[1];
        if (!ref) return;
        const col = ref.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const tipo = (c.match(/\bt="([^"]+)"/) || [])[1];
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = null;
        if (tipo === "s" && v != null) val = condivise[+v];
        else if (tipo === "inlineStr") val = xmlTesto((c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || "");
        else if (tipo === "str" || tipo === "e") val = v != null ? xmlTesto(v) : null;
        else if (tipo === "b") val = v === "1";
        else if (v != null) val = Number(v);
        valori[col] = val;
      });
      righe[r - 1] = valori;
    });
    fogli[nome] = righe;
  });
  return fogli;
}

// trasforma il foglio «Prima nota» in movimenti; nomi di settori e categorie dal foglio «Piano dei conti»
function primaNotaDaXlsx(blob) {
  const fogli = fogliXlsx(blob);
  const norm = (s) => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
  const nomeFoglio = (cerca) => Object.keys(fogli).find((n) => norm(n) === cerca) || Object.keys(fogli).find((n) => norm(n).indexOf(cerca) !== -1);
  const pn = fogli[nomeFoglio("primanota")] || [];
  const pc = fogli[nomeFoglio("pianodeiconti")] || [];
  const settori = {}, categorie = {};
  pc.forEach((r) => {
    if (!r) return;
    if (typeof r[0] === "number" && r[1]) settori[r[0]] = String(r[1]).trim();
    if (r[3] && /^[EU]\d+$/i.test(String(r[3]).trim()) && r[5]) categorie[String(r[3]).trim().toUpperCase()] = { tipo: String(r[4] || "").trim(), nome: String(r[5]).trim() };
  });
  const iHead = pn.findIndex((r) => r && r.some((v) => norm(v) === "data") && r.some((v) => norm(v).indexOf("entrate") === 0));
  if (iHead < 0) return [];
  const h = pn[iHead].map(norm);
  const col = (...nomi) => h.findIndex((x) => nomi.some((n) => x === n || x.indexOf(n) === 0));
  const C = {
    n: col("n"), data: col("data"), anno: col("annocompetenza"), sett: col("codsettore"), settNome: col("settore"), cat: col("codcat"), catNome: col("categoria"),
    contro: col("controparte"), descr: col("descrizione"), doc: col("ndocumento"), evento: col("eventotitolo", "evento"),
    entrate: col("entrate"), uscite: col("uscite"), tipo: col("tipomovimento"), file: col("documentoindrive"), note: col("note"),
  };
  const dataIso = (v) => {
    if (typeof v === "number") { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return d.toISOString().slice(0, 10); }
    const m = String(v || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2) : null;
  };
  const importo = (v) => (typeof v === "number" ? v : v ? Number(String(v).replace(/[€\s.]/g, "").replace(",", ".")) || 0 : 0);
  const txt = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : "");
  const out = [];
  pn.slice(iHead + 1).forEach((r) => {
    if (!r) return;
    const data = dataIso(r[C.data]);
    const e = importo(r[C.entrate]), u = importo(r[C.uscite]);
    if (!data || (!e && !u)) return;
    const cs = r[C.sett] != null && r[C.sett] !== "" ? Number(r[C.sett]) : null;
    const cc = txt(r, C.cat).toUpperCase();
    out.push({
      n: typeof r[C.n] === "number" ? r[C.n] : out.length + 1, data: data,
      anno: typeof r[C.anno] === "number" ? r[C.anno] : +data.slice(0, 4),
      cod_settore: cs, settore: settori[cs] || txt(r, C.settNome) || (cs != null ? "Settore " + cs : "Senza settore"),
      cod_cat: cc, categoria: (categorie[cc] && categorie[cc].nome) || txt(r, C.catNome) || cc || "Senza categoria",
      controparte: txt(r, C.contro), descrizione: txt(r, C.descr), n_documento: txt(r, C.doc), evento: txt(r, C.evento),
      entrate: Math.round(e * 100) / 100, uscite: Math.round(u * 100) / 100,
      tipo_movimento: txt(r, C.tipo) || "Movimento", documento: txt(r, C.file), note: txt(r, C.note),
    });
  });
  return out;
}

// da eseguire a mano: legge subito la prima nota e mostra i totali nel log
function provaPrimaNota() {
  const cfg = leggiImpostazioni();
  Logger.log("Script versione " + VERSIONE_SCRIPT + " · modalità: " + cfg.modalita + (cfg.modalita.indexOf("primanota") === -1 ? "  ← manca «+primanota»: la lettura automatica non partirà" : ""));
  const f = filePrimaNota(cfg);
  Logger.log("File trovato: " + (f ? f.getName() + " (modificato il " + f.getLastUpdated() + ")" : "nessuno"));
  leggiPrimaNota(cfg, true);
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

/* ---------------- email del SAS (ACEC Triveneta) ---------------- */
// copia nell'app le email arrivate da acectriveneta.it: l'app ne ricava programmazione confermata e risposte.
// La prima volta guarda un anno indietro, poi gli ultimi 30 giorni; gli id già consegnati restano in memoria.
const SAS_RICERCA = "from:(acectriveneta.it) -from:me";
function leggiSas(cfg) {
  const mem = PropertiesService.getUserProperties();
  const visti = JSON.parse(mem.getProperty("SAS_VISTI") || "[]");
  const prima = !mem.getProperty("SAS_INIZIATO");
  const lista = Gmail.Users.Messages.list("me", { q: SAS_RICERCA + (prima ? " newer_than:365d" : " newer_than:30d"), maxResults: prima ? 200 : 50 });
  const account = Session.getActiveUser().getEmail() || "account";
  const nuovi = (lista.messages || []).filter((m) => visti.indexOf(m.id) === -1);
  // Gmail a volte risponde «Internal error» su un messaggio: riprovo, poi lo salto e lo ritento ai giri successivi
  const falliti = JSON.parse(mem.getProperty("SAS_FALLITI") || "{}"), saltati = [];
  const leggi = (id) => {
    for (let i = 0; i < 3; i++) {
      try { return Gmail.Users.Messages.get("me", id, { format: "full" }); }
      catch (e) { if (i === 2) throw e; Utilities.sleep(1500 * (i + 1)); }
    }
  };
  const messaggi = nuovi.slice(0, 60).map((m) => {
    let msg;
    try { msg = leggi(m.id); }
    catch (e) {
      falliti[m.id] = (falliti[m.id] || 0) + 1;
      Logger.log("SAS: email " + m.id + " non leggibile (" + e.message + "), tentativo " + falliti[m.id] + " di 3");
      if (falliti[m.id] >= 3) saltati.push(m.id);
      return null;
    }
    delete falliti[m.id];
    const intestazione = (nome) => ((msg.payload.headers || []).find((h) => h.name.toLowerCase() === nome) || {}).value || "";
    return {
      id: m.id, thread_id: msg.threadId,
      data: new Date(Number(msg.internalDate)).toISOString(),
      mittente: intestazione("from"), oggetto: intestazione("subject"),
      testo: (corpoTesto(msg.payload) || msg.snippet || "").replace(/\r/g, "").slice(0, 20000),
      link: "https://mail.google.com/mail/?authuser=" + encodeURIComponent(account) + "#all/" + msg.threadId,
    };
  }).filter(Boolean);
  for (let i = 0; i < messaggi.length; i += 20) rpc(cfg, "sync_sas_push", { p_messaggi: messaggi.slice(i, i + 20) });
  // memoria degli ultimi 500 id consegnati (solo dopo l'invio riuscito) e di quelli lasciati perdere dopo 3 tentativi
  saltati.forEach((id) => delete falliti[id]);
  mem.setProperty("SAS_FALLITI", JSON.stringify(falliti));
  mem.setProperty("SAS_VISTI", JSON.stringify(messaggi.map((m) => m.id).concat(saltati, visti).slice(0, 500)));
  const resto = nuovi.length - Math.min(nuovi.length, 60);
  // il primo giro (un anno indietro) finisce solo quando non resta più niente da leggere
  if (!resto) mem.setProperty("SAS_INIZIATO", "1");
  Logger.log("SAS: " + messaggi.length + " email nuove consegnate" + (resto ? " (altre " + resto + " al prossimo giro)" : "") + (Object.keys(falliti).length ? ", " + Object.keys(falliti).length + " da riprovare" : ""));
}
// da eseguire a mano per provare la lettura delle email del SAS
function provaSas() {
  const cfg = leggiImpostazioni();
  Logger.log("Modalità: " + cfg.modalita + (cfg.modalita.indexOf("sas") === -1 ? "  ← manca «+sas»: la lettura automatica non partirà" : ""));
  leggiSas(cfg);
}

// il servizio Gmail di Apps Script restituisce i contenuti a volte già come byte, a volte come testo base64
function byteDaGmail(d) {
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object" && typeof d.length === "number") return Array.prototype.slice.call(d);
  let t = String(d || "").replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Utilities.base64Decode(t);
}

// testo semplice dell'email: la parte text/plain, altrimenti l'HTML ripulito
function corpoTesto(parte) {
  const decodifica = (d) => {
    try { return Utilities.newBlob(byteDaGmail(d)).getDataAsString("UTF-8"); }
    catch (e) { Logger.log("Testo email non decodificato (tipo " + typeof d + (d && d.length ? ", lunghezza " + d.length : "") + "): uso l'anteprima"); return ""; }
  };
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

/* ---------------- rubrica: le persone con cui la sala ha scambiato email ---------------- */
// Si guardano solo le conversazioni in cui la sala ha scritto o risposto (posta inviata): così pubblicità, newsletter
// e notifiche restano fuori. Per ogni persona: nome, indirizzo, prima e ultima email, oggetto e telefono della firma.
const RUBRICA_BLOCCO = 40; // conversazioni per giro (ogni 15 minuti) durante la prima lettura
const NON_PERSONE = /no-?reply|do-?not-?reply|newsletter|mailer-daemon|postmaster|notific|bounce|calendar|invitations|@(?:[\w-]+\.)*(?:google|googlemail|facebookmail|linkedin|paypal|amazon|apple|microsoft|github|mailchimp|sendgrid|brevo|sendinblue)\./i;
function leggiRubricaSeServe(cfg) {
  const mem = PropertiesService.getUserProperties();
  const fine = mem.getProperty("RUBRICA_FINE"), ultima = Number(mem.getProperty("RUBRICA_ULTIMA") || 0);
  if (fine && Date.now() - ultima < 6 * 3600e3) return;
  leggiRubrica(cfg, mem, !fine);
}
function leggiRubrica(cfg, mem, primaVolta) {
  const account = Session.getActiveUser().getEmail() || "account";
  let mie = [account.toLowerCase()];
  try { mie = mie.concat((Gmail.Users.Settings.SendAs.list("me").sendAs || []).map((a) => String(a.sendAsEmail).toLowerCase())); } catch (e) {}
  const pagina = primaVolta ? mem.getProperty("RUBRICA_PAGINA") || "" : "";
  const lista = Gmail.Users.Threads.list("me", Object.assign({ q: primaVolta ? "in:sent" : "in:sent newer_than:3d", maxResults: RUBRICA_BLOCCO }, pagina ? { pageToken: pagina } : {}));
  const persone = {};
  const indirizzi = (t) => {
    const out = [], re = /(?:"([^"]*)"\s*|([^"<>,;@]*?)\s*)<?([\w.+'-]+@[\w-]+(?:\.[\w-]+)+)>?/g;
    let m; while ((m = re.exec(String(t || "")))) out.push({ nome: (m[1] || m[2] || "").trim().replace(/^'+|'+$/g, ""), email: m[3].toLowerCase() });
    return out;
  };
  const aggiungi = (a, quando, oggetto, link, telefono) => {
    if (!a.email || mie.indexOf(a.email) !== -1 || NON_PERSONE.test(a.email)) return;
    const nome = a.nome && a.nome.indexOf("@") === -1 ? a.nome : "";
    const p = persone[a.email] || (persone[a.email] = { email: a.email, nome: "", telefono: "", oggetto: "", link: "", primo: quando, ultimo: quando });
    if (nome && (!p.nome || quando >= p.ultimo)) p.nome = nome;
    if (telefono && (!p.telefono || quando >= p.ultimo)) p.telefono = telefono;
    if (quando <= p.primo) p.primo = quando;
    if (quando >= p.ultimo) { p.ultimo = quando; p.oggetto = oggetto; p.link = link; }
  };
  (lista.threads || []).forEach((t) => {
    let th;
    try { th = Gmail.Users.Threads.get("me", t.id, { format: "full" }); } catch (e) { Logger.log("Rubrica: conversazione " + t.id + " non letta: " + e.message); return; }
    const link = "https://mail.google.com/mail/?authuser=" + encodeURIComponent(account) + "#all/" + t.id;
    (th.messages || []).forEach((msg) => {
      const h = (nome) => ((msg.payload.headers || []).find((x) => x.name.toLowerCase() === nome) || {}).value || "";
      const quando = new Date(Number(msg.internalDate)).toISOString(), oggetto = h("subject").slice(0, 200);
      const da = indirizzi(h("from"))[0];
      if (da && mie.indexOf(da.email) !== -1) indirizzi(h("to") + "," + h("cc")).forEach((a) => aggiungi(a, quando, oggetto, link, ""));
      else if (da) aggiungi(da, quando, oggetto, link, telefonoFirma(corpoTesto(msg.payload) || msg.snippet || ""));
    });
  });
  const items = Object.keys(persone).map((k) => persone[k]);
  for (let i = 0; i < items.length; i += 100) rpc(cfg, "sync_rubrica_push", { p_items: items.slice(i, i + 100) });
  if (primaVolta) {
    if (lista.nextPageToken) mem.setProperty("RUBRICA_PAGINA", lista.nextPageToken);
    else { mem.deleteProperty("RUBRICA_PAGINA"); mem.setProperty("RUBRICA_FINE", "1"); }
  }
  mem.setProperty("RUBRICA_ULTIMA", String(Date.now()));
  Logger.log("Rubrica: " + (lista.threads || []).length + " conversazioni lette, " + items.length + " contatti mandati all'app" + (primaVolta ? (lista.nextPageToken ? " (prima lettura: continua al prossimo giro)" : " (prima lettura finita)") : ""));
}
// il primo cellulare (o un fisso con «tel») nella parte nuova dell'email, senza il testo citato delle risposte
function telefonoFirma(testo) {
  const nuovo = String(testo).split(/\n\s*(?:Il .{3,120}ha scritto:|On .{3,120}wrote:|-{2,}\s*(?:Messaggio originale|Original Message)|Da:\s|From:\s)/i)[0]
    .split("\n").filter((r) => !/^\s*>/.test(r)).join("\n");
  const cell = nuovo.match(/(?:\+39[\s.]?)?\b3\d{2}[\s.\/-]?\d{3}[\s.-]?\d{3,4}\b/);
  if (cell) return cell[0].trim();
  const fisso = nuovo.match(/\b(?:tel|telefono|tel\.)\s*[:.]?\s*((?:\+39[\s.]?)?0\d{1,3}[\s.\/-]?\d{5,8})\b/i);
  return fisso ? fisso[1].trim() : "";
}
// da eseguire a mano: legge subito un blocco di posta (la prima volta riparte dall'inizio) e scrive nel log cosa trova
function provaRubrica() {
  const cfg = leggiImpostazioni(), mem = PropertiesService.getUserProperties();
  Logger.log("Script versione " + VERSIONE_SCRIPT + " · modalità: " + cfg.modalita + (cfg.modalita.indexOf("rubrica") === -1 ? "  ← manca «+rubrica»: la lettura automatica non partirà" : ""));
  leggiRubrica(cfg, mem, !mem.getProperty("RUBRICA_FINE"));
  Logger.log(JSON.stringify(["Mario Rossi\nCoro San Biagio\ncell. 347 123 4567", "Grazie!\n\nIl giorno lun 3 nov, Sala ha scritto:\n> 333 0000000", "Tel. 049 9365111"].map(telefonoFirma)));
}

/* ---------------- prova manuale ---------------- */

function provaRiconoscimento() {
  Logger.log(JSON.stringify(trovaDataOra("data evento: 4 dicembre 2026 ore 20.45; luogo: Sala San Tommaso Moro", new Date())));
  Logger.log(JSON.stringify(analizzaTitolo("Conferenza astronomica del Prof. Barbieri a cura dell'Associazione Palladio (galleria 124 ps). Ref. Carnio Valerio 333-3899850")));
  Logger.log(JSON.stringify(analizzaTitolo("Evento AIDO - In Sala Luigi Bacialli. Ref. Guerra Dario 340-9500022.  EVENTO DA PERFEZIONARE!!!")));
}
