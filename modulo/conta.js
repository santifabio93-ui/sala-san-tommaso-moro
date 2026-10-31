// © 2026 Fabio Santi, per la Sala San Tommaso Moro. Tutti i diritti riservati (vedi LICENSE).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

// Contapersone alla porta: si apre dal link personale dei turni (?t=codice). Ogni tocco va subito al database;
// ogni pochi secondi si rilegge il numero, così chi conta da più porte vede lo stesso totale.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cfg = window.SALA_CONFIG || {};
const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false } });
const qs = new URLSearchParams(location.search);
const token = qs.get("t") || (() => { try { return localStorage.getItem("sala-stm-turni") || ""; } catch (e) { return ""; } })();
const CAPIENZE = [[134, "Solo galleria · 134"], [338, "Platea · 338"], [472, "Platea e galleria · 472"]];
const ATTENZIONE = 0.85; // da qui il numero diventa arancione

const mostra = (html) => { $("#app").innerHTML = html; };
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600); }

let correggiAperto = false;
let eventi = [], scelto = qs.get("e") || "", ev = null, inAttesa = { e: 0, u: 0 }, invio = null, ultimaLettura = 0;

async function leggi() {
  if (!token) { mostra(`<div class="vuoto"><h2>Link non completo</h2><p>Apri il contapersone dal tuo link dei turni.</p></div>`); return; }
  const { data, error } = await sb.rpc("conta_oggi", { p_token: token });
  if (error && !data) { if (!ev) mostra(`<div class="vuoto"><h2>Connessione assente</h2><p>Controlla la connessione e riprova.</p><button class="btn primary" type="button" onclick="location.reload()">Riprova</button></div>`); return; }
  if (!data) { mostra(`<div class="vuoto"><h2>Link non valido</h2><p>Chiedi il link nuovo a chi organizza i turni.</p></div>`); return; }
  ultimaLettura = Date.now();
  eventi = data.eventi || [];
  if (!eventi.length) { mostra(`<div class="vuoto"><h2>Oggi in sala non c'è niente</h2><p>Il contapersone si usa il giorno dell'evento.</p><p><a href="turni.html?t=${esc(token)}">Torna ai turni</a></p></div>`); return; }
  // senza una scelta: l'evento più vicino all'ora attuale
  if (!eventi.some((x) => x.chiave === scelto)) {
    const ora = new Date().toTimeString().slice(0, 5);
    scelto = (eventi.filter((x) => x.ora && x.ora <= addOra(ora, 60)).pop() || eventi[0]).chiave;
  }
  ev = eventi.find((x) => x.chiave === scelto);
  disegna();
}
const addOra = (t, m) => { const [h, mm] = t.split(":").map(Number), v = Math.min(23 * 60 + 59, h * 60 + mm + m); return String(Math.floor(v / 60)).padStart(2, "0") + ":" + String(v % 60).padStart(2, "0"); };

function disegna() {
  const presenti = Math.max(0, ev.entrati + inAttesa.e - ev.usciti - inAttesa.u), cap = ev.capienza;
  const quota = presenti / cap, liv = presenti >= cap ? "pieno" : quota >= ATTENZIONE ? "quasi" : "ok";
  const stato = liv === "pieno" ? "Sala piena: non far entrare nessuno" : liv === "quasi" ? `Quasi piena: restano ${cap - presenti} posti` : `Posti liberi: ${cap - presenti}`;
  mostra(`
    ${eventi.length > 1 ? `<div class="scelta">${eventi.map((x) => `<button type="button" class="btn sm${x.chiave === scelto ? " primary" : ""}" data-ev="${esc(x.chiave)}">${esc(x.ora ? x.ora + " · " : "")}${esc(x.titolo)}</button>`).join("")}</div>` : ""}
    <h2 style="margin:4px 0 10px">${esc(ev.titolo)}${ev.ora ? ` <span class="hint">· ${esc(ev.ora)}</span>` : ""}</h2>
    <div class="contatore ${liv}">
      <div class="num" aria-live="polite">${presenti}</div>
      <div class="su">persone in sala su ${cap}</div>
      <div class="barra"><i style="width:${Math.min(100, Math.round(quota * 100))}%"></i></div>
      <div class="stato">${esc(stato)}</div>
      <div class="tasti">
        <button type="button" class="entra" data-passo="e1"${liv === "pieno" ? ' aria-describedby="avviso-pieno"' : ""}>+1 Entra</button>
        <button type="button" class="esce" data-passo="u1">−1 Esce</button>
        <button type="button" class="piu5" data-passo="e5">+5 Entrano</button>
      </div>
      <div class="dati"><span>Entrati in tutto <b>${ev.entrati + inAttesa.e}</b></span><span>Usciti <b>${ev.usciti + inAttesa.u}</b></span><span>Picco <b>${Math.max(ev.picco, presenti)}</b></span></div>
    </div>
    <div class="capienza">${CAPIENZE.map(([n, l]) => `<button type="button" class="btn sm${n === cap ? " primary" : ""}" data-cap="${n}">${l}</button>`).join("")}</div>
    <details id="correggi" style="margin-top:12px"${correggiAperto ? " open" : ""}><summary class="hint">Ho sbagliato: correggi</summary><div class="capienza"><button type="button" class="btn sm" data-passo="e-1">Togli un entrato</button><button type="button" class="btn sm" data-passo="u-1">Togli un uscito</button></div></details>
    <div class="sync" id="sync"></div>
    <p class="hint" style="text-align:center;margin-top:14px"><a href="turni.html?t=${esc(token)}">Torna ai turni</a></p>`);
  $("#correggi").ontoggle = (e) => (correggiAperto = e.target.open);
  document.querySelectorAll("[data-ev]").forEach((b) => (b.onclick = () => { scelto = b.dataset.ev; inAttesa = { e: 0, u: 0 }; leggi(); }));
  document.querySelectorAll("[data-passo]").forEach((b) => (b.onclick = () => tocco(b.dataset.passo)));
  document.querySelectorAll("[data-cap]").forEach((b) => (b.onclick = () => capienza(+b.dataset.cap)));
  aggiornaSync();
}
const aggiornaSync = () => { const s = $("#sync"); if (s) s.textContent = inAttesa.e || inAttesa.u ? "Invio in corso…" : ultimaLettura ? `Aggiornato alle ${new Date(ultimaLettura).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""; };

// i tocchi si sommano e partono subito; se manca la rete restano in attesa e si riprovano
function tocco(p) {
  const n = Number(p.slice(1));
  if (p[0] === "e") inAttesa.e += n; else inAttesa.u += n;
  if (navigator.vibrate) navigator.vibrate(n > 0 ? 18 : [10, 40, 10]);
  disegna();
  invia();
}
async function invia() {
  if (invio || (!inAttesa.e && !inAttesa.u)) return;
  const pacco = { ...inAttesa };
  invio = sb.rpc("conta_passo", { p_token: token, p_chiave: ev.chiave, p_entrati: pacco.e, p_usciti: pacco.u, p_capienza: null });
  const { data, error } = await invio;
  invio = null;
  if (error) { toast(/Link|oggi/.test(error.message) ? error.message : "Senza rete: i tocchi restano qui e partono appena torna"); setTimeout(invia, 3000); aggiornaSync(); return; }
  inAttesa.e -= pacco.e; inAttesa.u -= pacco.u;
  Object.assign(ev, data); ultimaLettura = Date.now();
  disegna();
  if (inAttesa.e || inAttesa.u) invia();
}
async function capienza(n) {
  const { data, error } = await sb.rpc("conta_passo", { p_token: token, p_chiave: ev.chiave, p_entrati: 0, p_usciti: 0, p_capienza: n });
  if (error) { toast(error.message); return; }
  Object.assign(ev, data); disegna();
}

// lo schermo resta acceso mentre si conta
let blocco = null;
async function tieniAcceso() { try { if ("wakeLock" in navigator && !document.hidden) blocco = await navigator.wakeLock.request("screen"); } catch (e) { /* non tutti i telefoni lo permettono */ } }
document.addEventListener("visibilitychange", () => { if (!document.hidden) { tieniAcceso(); leggi(); } });
tieniAcceso();

leggi();
// ogni 3 secondi il numero di tutti (se non ci sono tocchi in viaggio)
setInterval(() => { if (!document.hidden && !invio && !inAttesa.e && !inAttesa.u) leggi(); }, 3000);

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
