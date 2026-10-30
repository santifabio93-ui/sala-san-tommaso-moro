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

let dati = null, stasera = [], badge = "";
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

function disegna() {
  const io = dati.nome, fasce = dati.fasce || [];
  const mie = fasce.filter((f) => f.mio).length;
  const giorni = [];
  for (const f of fasce) { const g = giorni[giorni.length - 1]; if (g && g.data === f.data) g.fasce.push(f); else giorni.push({ data: f.data, fasce: [f] }); }
  mostra(`<h2>Ciao ${esc(io)} 👋</h2>
    <p class="hint">Tocca «Ci sono» nelle fasce in cui puoi esserci. ${mie ? `Sei segnato in <b>${mie}</b> ${mie === 1 ? "fascia" : "fasce"}.` : ""}</p>
    ${stasera.length ? `<a class="btn primary conta-btn" href="conta.html?t=${esc(token)}">🚪 Contapersone di stasera <small>${esc(stasera.map((e) => (e.ora ? e.ora + " " : "") + e.titolo).join(" · "))}</small></a>` : ""}
    ${salvaLink()}
    ${badge ? `<button class="btn sm badge-btn" type="button" id="mio-badge">🪪 Il mio badge per la cassa</button>` : ""}
    ${mie ? `<div class="cal-tutti"><button class="btn sm" type="button" id="cal-tutti">📅 Tutti i miei turni nel calendario</button><span class="hint">${IOS ? "si aprono nel Calendario dell'iPhone, con l'avviso un'ora prima" : "file da aprire con il calendario del telefono o di Outlook"}</span></div>` : ""}
    ${giorni.length ? giorni.map((g) => `<section class="giorno"><span class="eyebrow">${esc(giorno(g.data))}</span>
      ${g.fasce.map((f, i) => { const manca = Math.max(0, f.posti - f.presi), k = fasce.indexOf(f);
        return `<div class="fascia${f.mio ? " mia" : ""}"><div>
          <div class="t">${esc(f.titolo)}</div>
          <div class="hint">${esc(f.fascia)} · ${esc(f.inizio)}–${esc(f.fine)}</div>
          ${f.nomi.length ? `<div class="nomi">${f.nomi.map((n) => `<span class="${f.mio && n === io ? "io" : ""}">${esc(n)}</span>`).join("")}</div>` : ""}
          <div class="stato ${manca ? "manca" : "pieno"}">${manca ? (manca === 1 ? "serve ancora 1 persona" : `servono ancora ${manca} persone`) : "al completo ✓"}</div>
          ${f.mio ? (IOS ? `<button class="cal-link" type="button" data-cal="${k}">📅 Mettilo nel calendario</button>` : `<a class="cal-link" href="${esc(linkGoogle(f))}" target="_blank" rel="noopener">📅 Mettilo nel calendario</a>`) : ""}</div>
          ${f.mio ? `<button class="btn" type="button" data-k="${k}" data-si="0">Non ci sono più</button>` : manca ? `<button class="btn primary" type="button" data-k="${k}" data-si="1">Ci sono</button>` : ""}
        </div>`; }).join("")}</section>`).join("")
      : `<div class="empty" style="margin-top:16px">Al momento non ci sono turni aperti nei prossimi 30 giorni. Grazie!</div>`}`);
  const ok = $("#salva-ok"); if (ok) ok.onclick = () => { try { localStorage.setItem(CHIAVE + "-home", "1"); } catch (e) {} benvenuto = false; $("#salva").remove(); };
  const cp = $("#copia-link"); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(conCodice(token)); toast("Link copiato: incollalo dove vuoi tenerlo"); } catch (e) { prompt("Copia il tuo link:", conCodice(token)); } };
  const mb = $("#mio-badge"); if (mb) mb.onclick = mostraBadge;
  const ct = $("#cal-tutti"); if (ct) ct.onclick = () => nelCalendario(fasce.filter((f) => f.mio));
  document.querySelectorAll("[data-cal]").forEach((b) => (b.onclick = () => nelCalendario([fasce[+b.dataset.cal]])));
  document.querySelectorAll("[data-k]").forEach((b) => (b.onclick = async () => {
    const f = fasce[+b.dataset.k], si = b.dataset.si === "1";
    b.disabled = true;
    const { error } = await sb.rpc("turni_segna", { p_token: token, p_booking: f.booking_id, p_slot: f.slot_id, p_si: si });
    if (error) toast(error.message); else toast(si ? "Grazie, sei in turno! Toccando 📅 lo metti nel calendario" : "Ti sei tolto dal turno: se l'avevi nel calendario, cancellalo anche lì");
    await carica();
  }));
}

carica();
// se la pagina resta aperta, si aggiorna quando ci si torna sopra
document.addEventListener("visibilitychange", () => { if (!document.hidden && dati) carica(); });
