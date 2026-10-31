// © 2026 Fabio Santi, per la Sala San Tommaso Moro. Tutti i diritti riservati (vedi LICENSE).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

// Info per i social: un link per chi cura i social (?t=codice), senza account. Per ogni film, spettacolo ed evento
// della Sala dei prossimi due mesi: date e orari, ingresso, regista, collaborazioni, descrizione, note, locandina,
// biglietti e cartella dei materiali, con «Copia tutte le info». Gli affitti privati non compaiono.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cfg = window.SALA_CONFIG || {};
const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false } });
const CHIAVE = "sala-stm-social";
const mem = { get: (k) => { try { return localStorage.getItem(CHIAVE + k) || ""; } catch (e) { return ""; } }, set: (k, v) => { try { localStorage.setItem(CHIAVE + k, v); } catch (e) {} } };
const dalLink = new URLSearchParams(location.search).get("t");
const token = dalLink || mem.get("");
if (token && !dalLink) { const u = new URL(location.href); u.search = "?t=" + token; history.replaceState(null, "", u.href); }

const oggi = new Date().toLocaleDateString("sv-SE");
const giorno = (d, o = { weekday: "short", day: "numeric", month: "short" }) => new Date(d + "T12:00:00").toLocaleDateString("it-IT", o);
const mese = (d) => new Date(d + "T12:00:00").toLocaleDateString("it-IT", { month: "long", year: "numeric" });
const traGiorni = (d) => Math.round((new Date(d + "T12:00:00") - new Date(oggi + "T12:00:00")) / 864e5);
const quando = (n) => (n <= 0 ? "oggi" : n === 1 ? "domani" : `tra ${n} giorni`);
const euro = (n) => `${Number(n).toFixed(2).replace(".", ",").replace(",00", "")} €`;
const ingresso = (e) => e.ingresso || (e.prezzo === 0 ? "Ingresso libero" : e.prezzo != null && e.prezzo !== "" ? euro(e.prezzo) : "");

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); }
const mostra = (html) => { $("#app").innerHTML = html; };

let dati = null, filtro = mem.get("-filtro") || "tutti", cerca = "";
async function carica() {
  if (!token) { mostra(`<div class="vuoto"><h2>Link non completo</h2><p>Usa il link per i social che ti hanno mandato.</p></div>`); return; }
  const { data, error } = await sb.rpc("social_apri", { p_token: token });
  if (error && !data) { mostra(`<div class="vuoto"><h2>Connessione assente</h2><p>Non riesco a leggere gli eventi: controlla la connessione e riprova.</p><button class="btn primary" type="button" onclick="location.reload()">Riprova</button></div>`); return; }
  if (!data) { mostra(`<div class="vuoto"><h2>Link non valido</h2><p>Il link è stato rinnovato: chiedi quello nuovo a chi organizza.</p></div>`); return; }
  mem.set("", token);
  dati = data;
  disegna();
}

// il testo pronto da incollare (nel post, in una nota, nel programma dei contenuti)
function testo(e) {
  const r = [`${e.titolo}`, `${e.tipo} · Sala San Tommaso Moro, Piombino Dese`, ""];
  r.push(...e.orari.map((o) => `📅 ${giorno(o.data, { weekday: "long", day: "numeric", month: "long" })}${o.ora ? ` · ore ${o.ora}` : ""}`));
  if (ingresso(e)) r.push(`🎟️ ${ingresso(e)}`);
  if (e.regista) r.push(`🎬 ${/Cinema/.test(e.tipo) ? "Regia di" : "Con"} ${e.regista}`);
  if (e.collaborazioni) r.push(`🤝 In collaborazione con ${e.collaborazioni}`);
  if (e.descrizione) r.push("", e.descrizione);
  if (e.biglietti) r.push("", `Biglietti: ${e.biglietti}`);
  if (e.note) r.push("", `Note: ${e.note}`);
  if (e.distributore) r.push(`Distribuzione: ${e.distributore}`);
  if (e.materiali) r.push(`Materiali: ${e.materiali}`);
  if (e.locandina) r.push(`Locandina: ${e.locandina}`);
  return r.join("\n");
}
async function copia(t) {
  try { await navigator.clipboard.writeText(t); toast("Copiato: incollalo dove ti serve"); }
  catch (x) {
    const ta = Object.assign(document.createElement("textarea"), { value: t }); document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Copiato"); } catch (y) { toast("Non riesco a copiare: tieni premuto sul testo"); }
    ta.remove();
  }
}

const voce = (k, v, link) => `<dt>${k}</dt><dd>${v ? (link ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(link)}</a>` : esc(v)) : `<span class="manca">da chiedere</span>`}</dd>`;
function scheda(e) {
  const cinema = /Cinema/.test(e.tipo), n = traGiorni(e.prima);
  return `<article class="ev" id="ev-${esc(e.chiave)}">
    <div class="loc">${e.locandina ? `<img src="${esc(e.locandina)}" alt="" loading="lazy" onerror="this.replaceWith('${cinema ? "🎬" : "🎭"}')">` : cinema ? "🎬" : "🎭"}</div>
    <div>
      <span class="tipo${cinema ? "" : " sala"}">${esc(e.tipo)}</span> <span class="hint">${esc(quando(n))}</span>
      <h3>${esc(e.titolo)}</h3>
      <div class="date">${e.orari.map((o) => `<span class="${o.data === oggi ? "oggi" : ""}">${esc(giorno(o.data))}${o.ora ? ` · ${esc(o.ora)}` : ""}</span>`).join("")}</div>
      <dl class="info">
        ${voce("Ingresso", ingresso(e))}
        ${cinema || e.regista ? voce(cinema ? "Regia" : "Con", e.regista) : ""}
        ${e.collaborazioni ? voce("Con la collaborazione di", e.collaborazioni) : ""}
        ${e.descrizione ? voce("Descrizione", e.descrizione) : voce("Descrizione", "")}
        ${e.note ? voce("Note", e.note) : ""}
        ${e.distributore ? voce("Distribuzione", e.distributore) : ""}
      </dl>
      <div class="az">
        <button class="btn primary sm" type="button" data-copia="${esc(e.chiave)}">Copia tutte le info</button>
        ${e.materiali ? `<a class="btn sm" href="${esc(e.materiali)}" target="_blank" rel="noopener">Cartella materiali</a>` : ""}
        ${e.locandina ? `<a class="btn sm" href="${esc(e.locandina)}" target="_blank" rel="noopener" download>Locandina</a>` : ""}
        ${e.biglietti ? `<a class="btn sm" href="${esc(e.biglietti)}" target="_blank" rel="noopener">Biglietti</a>` : ""}
      </div>
    </div></article>`;
}

function disegna() {
  const tutti = dati.eventi || [];
  const q = cerca.toLowerCase();
  const lista = tutti.filter((e) => (filtro === "tutti" || (filtro === "cinema" ? /Cinema/.test(e.tipo) : !/Cinema/.test(e.tipo)))
    && (!q || `${e.titolo} ${e.regista} ${e.collaborazioni} ${e.descrizione}`.toLowerCase().includes(q)));
  const settimana = tutti.filter((e) => traGiorni(e.prima) <= 7).length;
  const daChiedere = tutti.filter((e) => !e.descrizione || !ingresso(e)).length;
  let ultimoMese = "", html = "";
  for (const e of lista) { const m = mese(e.prima); if (m !== ultimoMese) { html += `<h2 class="mese">${esc(m.charAt(0).toUpperCase() + m.slice(1))}</h2>`; ultimoMese = m; } html += scheda(e); }
  const bott = (k, t) => `<button class="btn sm" type="button" data-filtro="${k}" aria-pressed="${filtro === k}">${t}</button>`;
  mostra(`
    <h2>Gli eventi dei prossimi due mesi</h2>
    <p class="hint">${tutti.length} ${tutti.length === 1 ? "evento" : "eventi"}${settimana ? ` · ${settimana} nei prossimi 7 giorni` : ""}${daChiedere ? ` · ${daChiedere} con qualcosa ancora «da chiedere»` : ""}. Si aggiorna da solo: date e orari sono sempre quelli giusti.</p>
    <div class="barra"><input id="cerca" type="search" placeholder="Cerca un titolo, un regista, un'associazione…" value="${esc(cerca)}" aria-label="Cerca">
      <div class="filtri">${bott("tutti", "Tutti")}${bott("cinema", "Cinema")}${bott("eventi", "Spettacoli ed eventi")}</div></div>
    ${html || `<div class="vuoto">${tutti.length ? "Nessun evento con questa ricerca." : "Nei prossimi due mesi non ci sono eventi in programma."}</div>`}
    <p class="hint" style="margin-top:20px">Manca qualcosa o c'è un errore? Scrivilo a chi organizza: lo completa nell'app e qui compare subito.</p>`);
  const c = $("#cerca");
  c.oninput = () => { cerca = c.value; const pos = c.selectionStart; disegna(); const n = $("#cerca"); n.focus(); n.setSelectionRange(pos, pos); };
  document.querySelectorAll("[data-filtro]").forEach((b) => (b.onclick = () => { filtro = b.dataset.filtro; mem.set("-filtro", filtro); disegna(); }));
  document.querySelectorAll("[data-copia]").forEach((b) => (b.onclick = () => copia(testo(tutti.find((e) => e.chiave === b.dataset.copia)))));
}

carica();
document.addEventListener("visibilitychange", () => { if (!document.hidden && dati) carica(); });
