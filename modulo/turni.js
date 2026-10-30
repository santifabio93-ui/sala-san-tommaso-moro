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

let dati = null, stasera = [];
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

function disegna() {
  const io = dati.nome, fasce = dati.fasce || [];
  const mie = fasce.filter((f) => f.mio).length;
  const giorni = [];
  for (const f of fasce) { const g = giorni[giorni.length - 1]; if (g && g.data === f.data) g.fasce.push(f); else giorni.push({ data: f.data, fasce: [f] }); }
  mostra(`<h2>Ciao ${esc(io)} 👋</h2>
    <p class="hint">Tocca «Ci sono» nelle fasce in cui puoi esserci. ${mie ? `Sei segnato in <b>${mie}</b> ${mie === 1 ? "fascia" : "fasce"}.` : ""}</p>
    ${stasera.length ? `<a class="btn primary conta-btn" href="conta.html?t=${esc(token)}">🚪 Contapersone di stasera <small>${esc(stasera.map((e) => (e.ora ? e.ora + " " : "") + e.titolo).join(" · "))}</small></a>` : ""}
    ${salvaLink()}
    ${giorni.length ? giorni.map((g) => `<section class="giorno"><span class="eyebrow">${esc(giorno(g.data))}</span>
      ${g.fasce.map((f, i) => { const manca = Math.max(0, f.posti - f.presi), k = fasce.indexOf(f);
        return `<div class="fascia${f.mio ? " mia" : ""}"><div>
          <div class="t">${esc(f.titolo)}</div>
          <div class="hint">${esc(f.fascia)} · ${esc(f.inizio)}–${esc(f.fine)}</div>
          ${f.nomi.length ? `<div class="nomi">${f.nomi.map((n) => `<span class="${f.mio && n === io ? "io" : ""}">${esc(n)}</span>`).join("")}</div>` : ""}
          <div class="stato ${manca ? "manca" : "pieno"}">${manca ? (manca === 1 ? "serve ancora 1 persona" : `servono ancora ${manca} persone`) : "al completo ✓"}</div></div>
          ${f.mio ? `<button class="btn" type="button" data-k="${k}" data-si="0">Non ci sono più</button>` : manca ? `<button class="btn primary" type="button" data-k="${k}" data-si="1">Ci sono</button>` : ""}
        </div>`; }).join("")}</section>`).join("")
      : `<div class="empty" style="margin-top:16px">Al momento non ci sono turni aperti nei prossimi 30 giorni. Grazie!</div>`}`);
  const ok = $("#salva-ok"); if (ok) ok.onclick = () => { try { localStorage.setItem(CHIAVE + "-home", "1"); } catch (e) {} benvenuto = false; $("#salva").remove(); };
  const cp = $("#copia-link"); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(conCodice(token)); toast("Link copiato: incollalo dove vuoi tenerlo"); } catch (e) { prompt("Copia il tuo link:", conCodice(token)); } };
  document.querySelectorAll("[data-k]").forEach((b) => (b.onclick = async () => {
    const f = fasce[+b.dataset.k], si = b.dataset.si === "1";
    b.disabled = true;
    const { error } = await sb.rpc("turni_segna", { p_token: token, p_booking: f.booking_id, p_slot: f.slot_id, p_si: si });
    if (error) toast(error.message); else toast(si ? "Grazie, sei in turno!" : "Ti sei tolto dal turno");
    await carica();
  }));
}

carica();
// se la pagina resta aperta, si aggiorna quando ci si torna sopra
document.addEventListener("visibilitychange", () => { if (!document.hidden && dati) carica(); });
