// © 2026 Fabio Santi, per la Sala San Tommaso Moro. Tutti i diritti riservati (vedi LICENSE).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

// Turni dei volontari: ognuno apre il suo link personale (?t=codice), senza account, e si segna o si toglie.
// Il telefono si ricorda il codice: anche il link generico (senza codice) porta ai propri turni. Chi ha perso il link
// lo recupera con cellulare e data di nascita.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cfg = window.SALA_CONFIG || {};
const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false } });
const CHIAVE = "sala-stm-turni";
const ricorda = { get: () => { try { return localStorage.getItem(CHIAVE) || ""; } catch (e) { return ""; } }, set: (v) => { try { v ? localStorage.setItem(CHIAVE, v) : localStorage.removeItem(CHIAVE); } catch (e) {} } };
const dalLink = new URLSearchParams(location.search).get("t");
let token = dalLink || ricorda.get();
// il codice va sempre nell'indirizzo, così «Aggiungi alla schermata Home» salva il link giusto
const conCodice = (t) => { const u = new URL(location.href); u.search = "?t=" + t; u.hash = ""; return u.href; };
if (token && !dalLink) history.replaceState(null, "", conCodice(token));
const giorno = (d) => new Date(d + "T12:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); }
const mostra = (html) => { $("#app").innerHTML = html; };

let dati = null, stasera = [], badge = "", cambi = [];
let benvenuto = false; // appena ritrovato il link: si ricorda come salvarlo
async function carica() {
  if (!token) { recupero(); return; }
  const { data, error } = await sb.rpc("turni_apri", { p_token: token });
  if (error && !data) { if (!dati) mostra(`<div class="esito"><h2>Connessione assente</h2><p>Non riesco a leggere i turni: controlla la connessione e riprova.</p><button class="btn primary" type="button" onclick="location.reload()">Riprova</button></div>`); return; }
  if (!data) { ricorda.set(""); recupero("Questo link non è più valido (forse è stato rinnovato)."); return; }
  ricorda.set(token);
  dati = data;
  // il giorno di un evento: il contapersone per la porta (aggiornamento 26)
  const oggi = await sb.rpc("conta_oggi", { p_token: token });
  stasera = (oggi.data && oggi.data.eventi) || [];
  // il badge della Sala per la cassa (aggiornamento 30)
  const bg = await sb.rpc("turni_badge", { p_token: token });
  badge = (bg.data && bg.data.badge) || "";
  // scambi di turno chiesti dai volontari (aggiornamento 32)
  const cb = await sb.rpc("turni_cambi_aperti", { p_token: token });
  cambi = cb.data || [];
  disegna();
}

// senza codice o con un codice scaduto: il volontario ritrova il suo link da solo
function recupero(perche = "") {
  dati = null;
  mostra(`<div class="panel" style="margin-top:6px"><h2>Ritrova il tuo link dei turni</h2>
    <p class="hint">${perche ? esc(perche) + " " : ""}Scrivi il cellulare e la data di nascita che hai dato alla sala: ti riporto subito ai tuoi turni.</p>
    <form id="rec" class="form" novalidate style="margin-top:12px">
      <div class="field"><label for="rec-cell">Cellulare</label><input id="rec-cell" type="tel" inputmode="tel" autocomplete="tel" placeholder="Es. 333 1234567"></div>
      <div class="field"><label for="rec-nascita">Data di nascita</label><input id="rec-nascita" type="date" autocomplete="bday"></div>
      <div class="field"><div id="rec-err"></div><button class="btn primary" type="submit">Apri i miei turni</button></div>
    </form>
    <p class="hint" style="margin-top:12px">Non funziona? Forse in sala non hanno ancora il tuo cellulare o la data di nascita: chiedi il link a chi organizza i turni.</p></div>`);
  $("#rec").onsubmit = async (e) => {
    e.preventDefault();
    const cell = $("#rec-cell").value.trim(), nascita = $("#rec-nascita").value, err = $("#rec-err");
    if (cell.replace(/\D/g, "").length < 8 || !nascita) { err.innerHTML = `<div class="warn">Scrivi il cellulare e la data di nascita.</div>`; return; }
    const btn = e.target.querySelector("button"); btn.disabled = true; err.innerHTML = "";
    const { data, error } = await sb.rpc("turni_recupera", { p_cellulare: cell, p_nascita: nascita });
    btn.disabled = false;
    if (error) { err.innerHTML = `<div class="warn">${esc(/Troppi/.test(error.message) ? error.message : "Non riesco a controllare adesso: riprova tra poco.")}</div>`; return; }
    if (!data) { err.innerHTML = `<div class="warn">Non ho trovato nessun volontario con questi dati. Controlla il numero e la data, oppure chiedi il link a chi organizza i turni.</div>`; return; }
    token = data;
    history.replaceState(null, "", conCodice(token));
    benvenuto = true;
    carica();
  };
}
// come tenere il link a portata di mano: icona sulla schermata Home
function salvaLink() {
  try { if (localStorage.getItem(CHIAVE + "-home") && !benvenuto) return ""; } catch (e) {}
  if (window.matchMedia && matchMedia("(display-mode: standalone)").matches) return "";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `<div class="salva" id="salva">${benvenuto ? "<b>Eccoti!</b> " : ""}<b>Tieni il link a portata di mano:</b> ${ios ? "tocca <b>Condividi</b> ⬆︎ in basso e poi <b>«Aggiungi alla schermata Home»</b>" : "tocca <b>⋮</b> in alto a destra e poi <b>«Aggiungi a schermata Home»</b>"}: avrai l'icona della sala tra le app.
    <div class="actions" style="margin-top:8px"><button class="btn sm" type="button" id="copia-link">Copia il mio link</button><button class="btn ghost sm" type="button" id="salva-ok">Fatto, non mostrarlo più</button></div></div>`;
}

/* ---------- i turni nel calendario del telefono ---------- */
const IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const DOVE = "Sala San Tommaso Moro, Piombino Dese";
const stamp = (d, t) => d.replace(/-/g, "") + "T" + t.replace(":", "") + "00";
const giornoDopo = (d) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); };
// inizio e fine di una fascia; se finisce dopo mezzanotte, la fine è il giorno dopo
const orari = (f) => ({ da: stamp(f.data, f.inizio), a: stamp(f.fine <= f.inizio ? giornoDopo(f.data) : f.data, f.fine) });
const descrizione = (f) => [`Turno «${f.fascia}» per ${f.titolo}.`, f.nomi.length ? `In turno: ${f.nomi.join(", ")}.` : "", `I tuoi turni: ${conCodice(token)}`].filter(Boolean).join("\n");
const icsTesto = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
function ics(lista) {
  const ora = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const righe = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sala San Tommaso Moro//Turni//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE", "TZID:Europe/Rome",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
    "END:VTIMEZONE"];
  for (const f of lista) {
    const o = orari(f);
    righe.push("BEGIN:VEVENT", `UID:turno-${f.booking_id}-${f.slot_id}@salasantommasomoro`, `DTSTAMP:${ora}`,
      `DTSTART;TZID=Europe/Rome:${o.da}`, `DTEND;TZID=Europe/Rome:${o.a}`,
      `SUMMARY:${icsTesto(`Turno in sala: ${f.titolo}`)}`, `LOCATION:${icsTesto(DOVE)}`, `DESCRIPTION:${icsTesto(descrizione(f))}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsTesto(`Tra un'ora sei in sala: ${f.titolo}`)}`, "TRIGGER:-PT1H", "END:VALARM", "END:VEVENT");
  }
  righe.push("END:VCALENDAR");
  return righe.join("\r\n");
}
function nelCalendario(lista) {
  // su iPhone il file .ics apre «Aggiungi al calendario»; altrove si scarica e si apre con il calendario
  const url = URL.createObjectURL(new Blob([ics(lista)], { type: "text/calendar;charset=utf-8" }));
  if (IOS) { location.href = url; return; }
  const a = Object.assign(document.createElement("a"), { href: url, download: lista.length === 1 ? "turno-sala.ics" : "turni-sala.ics" });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
// Google Calendar (Android, computer): apre l'evento già compilato
const linkGoogle = (f) => { const o = orari(f); return "https://calendar.google.com/calendar/render?" + new URLSearchParams({ action: "TEMPLATE", text: `Turno in sala: ${f.titolo}`, dates: `${o.da}/${o.a}`, ctz: "Europe/Rome", location: DOVE, details: descrizione(f) }); };

// il badge a tutto schermo, da avvicinare al lettore della cassa
async function mostraBadge() {
  try {
    const m = await import("../badge.js?v=" + (document.querySelector('script[src*="turni.js"]').src.split("v=")[1] || ""));
    await m.caricaQr();
    const d = document.createElement("div");
    d.className = "badge-schermo";
    d.innerHTML = `<div class="bs-carta"><small>Sala San Tommaso Moro · Volontario</small><b>${esc(dati.nome)}</b>${m.qrSvg(badge, { lato: 9 })}${m.codice39Svg(badge, { altezza: 70, modulo: 2 })}<span>${esc(badge)}</span>
      <p class="hint">Alza la luminosità dello schermo e avvicinalo al lettore.</p><button class="btn primary" type="button">Chiudi</button></div>`;
    d.querySelector("button").onclick = () => d.remove();
    document.body.appendChild(d);
  } catch (e) { toast("Non riesco a mostrare il badge: controlla la connessione"); }
}

// colore di una persona, sempre uguale per lo stesso nome
const tinta = (n) => { let h = 0; for (const c of String(n)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const tra = (d) => { const g = Math.round((new Date(d + "T12:00:00") - new Date(new Date().toDateString() + " 12:00")) / 864e5); return g <= 0 ? "oggi" : g === 1 ? "domani" : `tra ${g} giorni`; };
const giornoBreve = (d) => new Date(d + "T12:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
let filtro = "", conferma = null;

function disegna() {
  const io = dati.nome, fasce = dati.fasce || [], mie = fasce.filter((f) => f.mio);
  const manca = (f) => Math.max(0, f.posti - f.presi);
  const urgente = (f) => manca(f) > 0 && !f.mio && (new Date(f.data + "T12:00:00") - new Date()) / 864e5 < 3;
  const servono = fasce.filter((f) => manca(f) > 0 && !f.mio);
  if (!filtro) filtro = "tutti"; // si vedono anche le fasce al completo, dove ci si aggiunge come aiuto
  const visibili = filtro === "servo" ? fasce.filter((f) => manca(f) > 0 || f.mio) : fasce;
  // giorni → eventi → fasce
  const giorni = [];
  for (const f of visibili) {
    let g = giorni.find((x) => x.data === f.data); if (!g) giorni.push((g = { data: f.data, eventi: [] }));
    let ev = g.eventi.find((x) => x.id === f.booking_id); if (!ev) g.eventi.push((ev = { id: f.booking_id, titolo: f.titolo, ora: f.giornata_intera ? "" : f.inizio_evento, fasce: [] }));
    ev.fasce.push(f);
  }
  const prossimo = mie[0];
  const daPrendere = cambi.filter((c) => !c.mia && !c.gia_dentro);
  const posti = (f) => Array.from({ length: Math.max(f.posti, f.nomi.length) }, (_, i) => f.nomi[i]
    ? `<span class="av${f.mio && f.nomi[i] === io ? " io" : ""}${i >= f.posti ? " aiuto" : ""}" style="--h:${tinta(f.nomi[i])}">${esc(f.nomi[i])}${i >= f.posti ? "<small>aiuto</small>" : ""}</span>`
    : `<span class="av vuoto">libero</span>`).join("");
  const azione = (f) => {
    const k = fasce.indexOf(f);
    if (f.mio) return conferma === k ? `<button class="tb togli" type="button" data-k="${k}" data-si="0">Toglimi</button>` : `<button class="tb ci-sei" type="button" data-chiedi="${k}">✓ Ci sei</button>`;
    return manca(f) ? `<button class="tb ci-sono" type="button" data-k="${k}" data-si="1">Ci sono</button>`
      : `<button class="tb ci-sono anche" type="button" data-k="${k}" data-si="1">+ Come aiuto</button>`;
  };
  mostra(`
    <section class="ciao">
      <div class="ciao-t"><small>Turni della Sala</small><h2>Ciao ${esc(io.split(" ")[0])} 👋</h2>
        <p>${mie.length ? `Sei in <b>${mie.length}</b> ${mie.length === 1 ? "turno" : "turni"}${prossimo ? ` · il prossimo è <b>${esc(tra(prossimo.data))}</b>, ${esc(giornoBreve(prossimo.data))} alle ${esc(prossimo.inizio)}` : ""}.` : servono.length ? `Ci sono <b>${servono.length}</b> ${servono.length === 1 ? "fascia che aspetta" : "fasce che aspettano"} qualcuno: tocca «Ci sono» dove puoi.` : "Per ora i turni sono tutti coperti. Grazie!"}</p></div>
      <div class="ciao-az">
        ${stasera.length ? `<a class="pill-az" href="conta.html?t=${esc(token)}">🚪 Contapersone</a>` : ""}
        ${badge ? `<button class="pill-az" type="button" id="mio-badge">🪪 Badge</button>` : ""}
        ${mie.length ? `<button class="pill-az" type="button" id="cal-tutti">📅 Calendario</button>` : ""}
      </div>
    </section>
    ${salvaLink()}
    ${mie.length ? `<section class="miei"><h3>I tuoi turni ${mie.length > 1 ? `<span class="hint">${mie.length} · scorri →</span>` : ""}</h3><div class="miei-fila">${mie.map((f) => { const k = fasce.indexOf(f), altri = f.nomi.filter((n) => n !== io);
      return `<div class="mio"><div class="mio-q"><b>${esc(giornoBreve(f.data))}</b><span>${esc(tra(f.data))}</span></div>
        <div class="mio-c"><div class="t">${esc(f.titolo)}</div><div class="hint">${esc(f.fascia)}${f.nomi.indexOf(io) >= f.posti ? " (come aiuto)" : ""} · ${esc(f.inizio)}–${esc(f.fine)}${altri.length ? ` · con ${esc(altri.join(", "))}` : ""}</div>
          <div class="mio-az">${IOS ? `<button class="cal-link" type="button" data-cal="${k}">📅 Nel calendario</button>` : `<a class="cal-link" href="${esc(linkGoogle(f))}" target="_blank" rel="noopener">📅 Nel calendario</a>`}
          ${(() => { const c = cambioDi(f, true); return c ? `<span class="cambio-on">🔁 Cambio chiesto</span><button class="cal-link" type="button" data-ritira="${esc(c.id)}">Ci vado io</button>` : `<button class="cal-link" type="button" data-cambio="${k}">🔁 Chiedi il cambio</button>`; })()}</div></div></div>`; }).join("")}</div></section>` : ""}
    ${daPrendere.length ? `<section class="cercano"><h3>🔁 Cercano un sostituto</h3>${daPrendere.map((c) => `<div class="cerca">
        <div><div class="t">${esc(c.titolo)}</div><div class="hint">${esc(giornoBreve(c.data))} · ${esc(c.fascia)} ${esc(c.inizio)}–${esc(c.fine)} · al posto di <b>${esc(c.da_nome)}</b></div></div>
        <button class="tb ci-sono" type="button" data-prendi="${esc(c.id)}">Lo prendo io</button></div>`).join("")}</section>` : ""}
    <div class="filtri"><button type="button" data-filtro="servo" class="${filtro === "servo" ? "on" : ""}">Dove servo <span>${servono.length}</span></button><button type="button" data-filtro="tutti" class="${filtro === "tutti" ? "on" : ""}">Tutti <span>${fasce.length}</span></button></div>
    ${giorni.length > 1 ? `<nav class="giorni-strip" aria-label="Giorni">${giorni.map((g) => { const tutte = g.eventi.flatMap((e) => e.fasce);
      return `<a href="#g-${g.data}" class="${tutte.some((f) => f.mio) ? "c-me" : ""}"><small>${esc(new Date(g.data + "T12:00:00").toLocaleDateString("it-IT", { weekday: "short" }))}</small><b>${+g.data.slice(8)}</b>${tutte.some((f) => manca(f) && !f.mio) ? `<i class="punto"></i>` : ""}</a>`; }).join("")}</nav>` : ""}
    ${giorni.length ? giorni.map((g) => `<section class="giorno" id="g-${g.data}"><span class="eyebrow">${esc(giorno(g.data))}</span>
      ${g.eventi.map((ev) => `<article class="evento${ev.fasce.some((f) => f.mio) ? " con-me" : ""}">
        <header><div><div class="t">${esc(ev.titolo)}</div>${ev.ora ? `<div class="hint">inizio ${esc(ev.ora)}</div>` : ""}</div>${ev.fasce.some(urgente) ? `<span class="urgente">Urgente</span>` : ""}</header>
        ${ev.fasce.map((f) => `<div class="fascia2${f.mio ? " mia" : ""}">
          <div class="f-ora"><b>${esc(f.inizio)}</b><span>${esc(f.fine)}</span></div>
          <div class="f-c"><div class="f-n">${esc(f.fascia)}</div><div class="avs">${posti(f)}</div>
            ${(() => { const c = cambioDi(f, false); return c && !c.gia_dentro ? `<div class="f-cambio">🔁 ${esc(c.da_nome)} cerca un sostituto · <button type="button" data-prendi="${esc(c.id)}">Lo prendo io</button></div>` : ""; })()}
            <div class="f-s ${manca(f) ? "manca" : "ok"}">${manca(f) ? (manca(f) === 1 ? "manca 1 persona" : `mancano ${manca(f)} persone`) : `Completo ✓${f.presi > f.posti ? ` · +${f.presi - f.posti} di aiuto` : f.mio ? "" : " · puoi aggiungerti come aiuto"}`}</div></div>
          <div class="f-a">${azione(f)}</div></div>`).join("")}
      </article>`).join("")}</section>`).join("")
      : `<div class="vuoto-t">${filtro === "servo" ? "In questo momento non servono persone: grazie! Tocca «Tutti» per vedere tutti i turni." : "Al momento non ci sono turni nei prossimi 30 giorni."}</div>`}`);
  const ok = $("#salva-ok"); if (ok) ok.onclick = () => { try { localStorage.setItem(CHIAVE + "-home", "1"); } catch (e) {} benvenuto = false; $("#salva").remove(); };
  const cp = $("#copia-link"); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(conCodice(token)); toast("Link copiato: incollalo dove vuoi tenerlo"); } catch (e) { prompt("Copia il tuo link:", conCodice(token)); } };
  const mb = $("#mio-badge"); if (mb) mb.onclick = mostraBadge;
  const ct = $("#cal-tutti"); if (ct) ct.onclick = () => nelCalendario(mie);
  document.querySelectorAll("[data-cal]").forEach((b) => (b.onclick = () => nelCalendario([fasce[+b.dataset.cal]])));
  document.querySelectorAll("[data-filtro]").forEach((b) => (b.onclick = () => { filtro = b.dataset.filtro; conferma = null; disegna(); }));
  document.querySelectorAll("[data-chiedi]").forEach((b) => (b.onclick = () => { conferma = +b.dataset.chiedi; disegna(); clearTimeout(disegna.t); disegna.t = setTimeout(() => { conferma = null; if (dati) disegna(); }, 4000); }));
  document.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => segna(fasce[+b.dataset.k], b.dataset.si === "1")));
  document.querySelectorAll("[data-cambio]").forEach((b) => (b.onclick = () => chiediCambio(fasce[+b.dataset.cambio], b)));
  document.querySelectorAll("[data-ritira]").forEach((b) => (b.onclick = () => azioneCambio("turni_cambio_annulla", b.dataset.ritira, "Va bene: il turno resta tuo", b)));
  document.querySelectorAll("[data-prendi]").forEach((b) => (b.onclick = () => azioneCambio("turni_cambio_prendi", b.dataset.prendi, "Fatto! Il turno è tuo. Grazie 🙏", b)));
}
// la richiesta di cambio aperta per una fascia (la mia o di un altro)
const cambioDi = (f, mia) => cambi.find((c) => c.booking_id === f.booking_id && c.slot_id === f.slot_id && c.mia === mia);

// scambio di turno (aggiornamento 32): il turno resta tuo finché un altro non tocca «Lo prendo io»
async function chiediCambio(f, b) {
  b.disabled = true;
  const { error } = await sb.rpc("turni_cambio_chiedi", { p_token: token, p_booking: f.booking_id, p_slot: f.slot_id });
  if (error) { b.disabled = false; toast(/Could not find|schema cache/i.test(error.message) ? "Lo scambio di turno non è ancora attivo: avvisa chi organizza" : error.message); return; }
  const testo = `Ciao! Non riesco più a fare il turno «${f.fascia}» per ${f.titolo}, ${giornoBreve(f.data)} ${f.inizio}–${f.fine}. Qualcuno può prenderlo? Basta aprire il proprio link dei turni e toccare «Lo prendo io»: ${new URL("turni.html", location.href).href} Grazie! 🙏`;
  await carica();
  toastAzione("Cambio chiesto: il turno resta tuo finché qualcuno non lo prende.", "Avvisa il gruppo", () => window.open("https://wa.me/?text=" + encodeURIComponent(testo), "_blank"));
}
async function azioneCambio(nome, id, ok, b) {
  b.disabled = true;
  const { data, error } = await sb.rpc(nome, { p_token: token, p_cambio: id });
  if (error) { toast(error.message); await carica(); return; }
  if (navigator.vibrate) navigator.vibrate(25);
  toast(nome === "turni_cambio_prendi" && data && data.da ? `Fatto! Hai preso il turno di ${data.da}. Grazie 🙏` : ok);
  await carica();
}
function toastAzione(msg, label, fn) {
  const t = $("#toast");
  t.innerHTML = `${esc(msg)} <button type="button" class="annulla">${esc(label)}</button>`;
  t.hidden = false;
  t.querySelector("button").onclick = () => { t.hidden = true; fn(); };
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 8000);
}

// ci sono / non ci sono più: la pagina cambia subito, il database dopo; se va male si torna indietro
async function segna(f, si, annulla) {
  const io = dati.nome;
  const prima = { mio: f.mio, presi: f.presi, nomi: [...f.nomi] }, aiuto = si && f.presi >= f.posti;
  f.mio = si; f.presi += si ? 1 : -1; f.nomi = si ? [...f.nomi, io] : f.nomi.filter((n, i) => !(n === io && i === f.nomi.lastIndexOf(io)));
  conferma = null; disegna();
  if (navigator.vibrate) navigator.vibrate(si ? 25 : [12, 40, 12]);
  const { error } = await sb.rpc("turni_segna", { p_token: token, p_booking: f.booking_id, p_slot: f.slot_id, p_si: si });
  if (error) { Object.assign(f, prima); disegna(); toast(error.message); return; }
  if (!annulla) toastAnnulla(si ? (aiuto ? "Grazie, ci sei come aiuto! 🙌" : "Grazie, sei in turno! 🎉") : "Ti sei tolto dal turno", () => segna(f, !si, true));
  setTimeout(carica, 600);
}
function toastAnnulla(msg, fn) {
  const t = $("#toast");
  t.innerHTML = `${esc(msg)} <button type="button" class="annulla">Annulla</button>`;
  t.hidden = false;
  t.querySelector("button").onclick = () => { t.hidden = true; fn(); };
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 5000);
}

carica();
// se la pagina resta aperta, si aggiorna quando ci si torna sopra
document.addEventListener("visibilitychange", () => { if (!document.hidden && dati) carica(); });

// se è uscita una versione nuova di questa pagina (e il telefono tiene quella vecchia), si ricarica da sola
async function controllaVersione() {
  try {
    const mia = new URL(import.meta.url).searchParams.get("v"), html = await (await fetch(location.pathname, { cache: "reload" })).text();
    const nuova = (html.match(/\.js\?v=([\w.-]+)/) || [])[1];
    if (mia && nuova && nuova !== mia && sessionStorage.getItem("sala-ricarica") !== nuova) { sessionStorage.setItem("sala-ricarica", nuova); location.reload(); }
  } catch (e) {}
}
controllaVersione();
document.addEventListener("visibilitychange", () => { if (!document.hidden) controllaVersione(); });
