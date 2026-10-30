// © 2026 Parrocchia di San Biagio Vescovo e Martire – Sala San Tommaso Moro. Tutti i diritti riservati (vedi LICENSE).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

// Turni dei volontari: ognuno apre il suo link personale (?t=codice), senza account, e si segna o si toglie.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cfg = window.SALA_CONFIG || {};
const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false } });
const token = new URLSearchParams(location.search).get("t");
const giorno = (d) => new Date(d + "T12:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); }
const mostra = (html) => { $("#app").innerHTML = html; };

let dati = null;
async function carica() {
  if (!token) { mostra(`<div class="esito"><h2>Link non completo</h2><p>Usa il link personale che ti ha mandato chi organizza i turni.</p></div>`); return; }
  const { data, error } = await sb.rpc("turni_apri", { p_token: token });
  if (error || !data) { mostra(`<div class="esito"><h2>Link non valido</h2><p>Il link potrebbe essere stato disattivato. Chiedine uno nuovo a chi organizza i turni.</p></div>`); return; }
  dati = data;
  disegna();
}

function disegna() {
  const io = dati.nome, fasce = dati.fasce || [];
  const mie = fasce.filter((f) => f.mio).length;
  const giorni = [];
  for (const f of fasce) { const g = giorni[giorni.length - 1]; if (g && g.data === f.data) g.fasce.push(f); else giorni.push({ data: f.data, fasce: [f] }); }
  mostra(`<h2>Ciao ${esc(io)} 👋</h2>
    <p class="hint">Tocca «Ci sono» nelle fasce in cui puoi esserci. ${mie ? `Sei segnato in <b>${mie}</b> ${mie === 1 ? "fascia" : "fasce"}.` : ""} Salva questo link: è il tuo, vale sempre.</p>
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
