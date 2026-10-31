// © 2026 Fabio Santi, per la Sala San Tommaso Moro. Tutti i diritti riservati (vedi LICENSE).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

// Info per i social: un link per chi cura i social (?t=codice), senza account. Per ogni film, spettacolo ed evento
// della Sala dei prossimi due mesi: date e orari, ingresso, regista, collaborazioni, descrizione, note, locandina,
// biglietti e cartella dei materiali, con «Copia tutte le info». Gli affitti privati non compaiono.
// Gli eventi nuovi o cambiati dall'ultima visita hanno un'etichetta; con «Chiedi» si fa una domanda a chi organizza,
// che risponde dall'app: la risposta compare qui.
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

let dati = null, filtro = mem.get("-filtro") || "tutti", cerca = "", novita = {}, aperto = null, bozza = "";
const TRE_GIORNI = 3 * 864e5;
const leggi = (k, d) => { try { return JSON.parse(mem.get(k)) ?? d; } catch (e) { return d; } };
const impronta = (t) => { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };
// cosa è nuovo o cambiato dall'ultima visita (la prima volta non si segna niente); l'etichetta resta 3 giorni
function confronta(eventi) {
  const prima = leggi("-visti", null), ora = {}, segnate = leggi("-novita", {}), adesso = Date.now();
  novita = {};
  for (const [k, v] of Object.entries(segnate)) if (adesso - v.t < TRE_GIORNI) novita[k] = v.l; else delete segnate[k];
  for (const e of eventi) {
    const d = e.orari.map((o) => `${o.data} ${o.ora}`), i = impronta([e.titolo, ingresso(e), e.regista, e.collaborazioni, e.descrizione, e.note, e.materiali, e.locandina, e.biglietti].join("|"));
    ora[e.chiave] = { d, i };
    if (!prima || novita[e.chiave]) continue;
    const p = prima[e.chiave];
    const vecchie = p ? (p.d || []).filter((x) => x.slice(0, 10) >= oggi) : [];
    const l = !p ? "Nuovo" : vecchie.join() !== d.join() ? (vecchie.every((x) => d.includes(x)) ? "Nuove date" : "Date o orari cambiati") : p.i !== i ? "Info aggiornate" : "";
    if (l) { novita[e.chiave] = l; segnate[e.chiave] = { l, t: adesso }; }
  }
  mem.set("-visti", JSON.stringify(ora)); mem.set("-novita", JSON.stringify(segnate));
}
async function carica() {
  if (!token) { mostra(`<div class="vuoto"><h2>Link non completo</h2><p>Usa il link per i social che ti hanno mandato.</p></div>`); return; }
  const { data, error } = await sb.rpc("social_apri", { p_token: token });
  if (error && !data) { mostra(`<div class="vuoto"><h2>Connessione assente</h2><p>Non riesco a leggere gli eventi: controlla la connessione e riprova.</p><button class="btn primary" type="button" onclick="location.reload()">Riprova</button></div>`); return; }
  if (!data) { mostra(`<div class="vuoto"><h2>Link non valido</h2><p>Il link è stato rinnovato: chiedi quello nuovo a chi organizza.</p></div>`); return; }
  mem.set("", token);
  dati = data;
  confronta(data.eventi || []);
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

const quandoFu = (t) => new Date(t).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const domandeDi = (k) => (dati.domande || []).filter((d) => d.chiave === k).sort((a, b) => a.creato.localeCompare(b.creato));
const domandaHtml = (d) => `<div class="dom"><div>❓ ${esc(d.testo)} <span class="hint">${esc(d.chi || "")}${d.chi ? ", " : ""}${esc(quandoFu(d.creato))}</span></div>
  ${d.risposta ? `<div class="risp">💬 ${esc(d.risposta)}</div>` : `<div class="hint">in attesa di risposta</div>`}</div>`;
function formChiedi(k) {
  if (aperto !== k) return "";
  return `<form class="chiedi" data-form="${esc(k)}" novalidate>
    <textarea maxlength="1000" placeholder="Scrivi la tua domanda…" aria-label="Domanda">${esc(bozza)}</textarea>
    ${mem.get("-nome") ? "" : `<input maxlength="40" placeholder="Il tuo nome" aria-label="Il tuo nome" autocomplete="given-name">`}
    <div class="az"><button class="btn primary sm" type="submit">Invia la domanda</button><button class="btn sm" type="button" data-chiudi>Annulla</button></div></form>`;
}
let chiaveCorrente = "";
const voce = (k, v, cosa) => `<dt>${k}</dt><dd>${v ? esc(v) : `<button type="button" class="manca" data-chiedi="${esc(chiaveCorrente)}" data-cosa="${esc(cosa || k.toLowerCase())}">da chiedere ›</button>`}</dd>`;
function scheda(e) {
  const cinema = /Cinema/.test(e.tipo), n = traGiorni(e.prima), ds = domandeDi(e.chiave);
  chiaveCorrente = e.chiave;
  return `<article class="ev" id="ev-${esc(e.chiave)}">
    <div class="loc">${e.locandina ? `<img src="${esc(e.locandina)}" alt="" loading="lazy" onerror="this.replaceWith('${cinema ? "🎬" : "🎭"}')">` : cinema ? "🎬" : "🎭"}</div>
    <div>
      <span class="tipo${cinema ? "" : " sala"}">${esc(e.tipo)}</span>${novita[e.chiave] ? ` <span class="nuovo">${esc(novita[e.chiave])}</span>` : ""} <span class="hint">${esc(quando(n))}</span>
      <h3>${esc(e.titolo)}</h3>
      <div class="date">${e.orari.map((o) => `<span class="${o.data === oggi ? "oggi" : ""}">${esc(giorno(o.data))}${o.ora ? ` · ${esc(o.ora)}` : ""}</span>`).join("")}</div>
      <dl class="info">
        ${voce("Ingresso", ingresso(e), "il prezzo dell'ingresso")}
        ${cinema || e.regista ? voce(cinema ? "Regia" : "Con", e.regista, "il regista") : ""}
        ${e.collaborazioni ? voce("Con la collaborazione di", e.collaborazioni) : ""}
        ${voce("Descrizione", e.descrizione, "due righe di descrizione")}
        ${e.note ? voce("Note", e.note) : ""}
        ${e.distributore ? voce("Distribuzione", e.distributore) : ""}
      </dl>
      <div class="az">
        <button class="btn primary sm" type="button" data-copia="${esc(e.chiave)}">Copia tutte le info</button>
        ${e.materiali ? `<a class="btn sm" href="${esc(e.materiali)}" target="_blank" rel="noopener">Cartella materiali</a>` : ""}
        ${e.locandina ? `<a class="btn sm" href="${esc(e.locandina)}" target="_blank" rel="noopener" download>Locandina</a>` : ""}
        ${e.biglietti ? `<a class="btn sm" href="${esc(e.biglietti)}" target="_blank" rel="noopener">Biglietti</a>` : ""}
        ${aperto === e.chiave ? "" : `<button class="btn ghost sm" type="button" data-chiedi="${esc(e.chiave)}">❓ Chiedi</button>`}
      </div>
      ${ds.length ? `<div class="domande">${ds.map(domandaHtml).join("")}</div>` : ""}
      ${formChiedi(e.chiave)}
    </div></article>`;
}

function disegna() {
  const tutti = dati.eventi || [];
  const q = cerca.toLowerCase();
  const nNovita = tutti.filter((e) => novita[e.chiave]).length;
  if (filtro === "novita" && !nNovita) filtro = "tutti";
  const lette = new Set(leggi("-lette", [])), risposte = (dati.domande || []).filter((d) => d.risposta && !lette.has(d.id));
  const titoloDi = (d) => (tutti.find((e) => e.chiave === d.chiave) || {}).titolo || d.titolo || "Domanda generale";
  const lista = tutti.filter((e) => (filtro === "tutti" || (filtro === "novita" ? novita[e.chiave] : filtro === "cinema" ? /Cinema/.test(e.tipo) : !/Cinema/.test(e.tipo)))
    && (!q || `${e.titolo} ${e.regista} ${e.collaborazioni} ${e.descrizione}`.toLowerCase().includes(q)));
  const settimana = tutti.filter((e) => traGiorni(e.prima) <= 7).length;
  const daChiedere = tutti.filter((e) => !e.descrizione || !ingresso(e)).length;
  let ultimoMese = "", html = "";
  for (const e of lista) { const m = mese(e.prima); if (m !== ultimoMese) { html += `<h2 class="mese">${esc(m.charAt(0).toUpperCase() + m.slice(1))}</h2>`; ultimoMese = m; } html += scheda(e); }
  const bott = (k, t) => `<button class="btn sm" type="button" data-filtro="${k}" aria-pressed="${filtro === k}">${t}</button>`;
  mostra(`
    ${risposte.length ? `<section class="risposte"><h3>💬 ${risposte.length === 1 ? "È arrivata una risposta" : `Sono arrivate ${risposte.length} risposte`}</h3>
      ${risposte.map((d) => `<div class="dom"><b>${esc(titoloDi(d))}</b><div>❓ ${esc(d.testo)}</div><div class="risp">💬 ${esc(d.risposta)}</div></div>`).join("")}
      <button class="btn sm" type="button" id="letto">Ok, letto</button></section>` : ""}
    <h2>Gli eventi dei prossimi due mesi</h2>
    <p class="hint">${tutti.length} ${tutti.length === 1 ? "evento" : "eventi"}${settimana ? ` · ${settimana} nei prossimi 7 giorni` : ""}${daChiedere ? ` · ${daChiedere} con qualcosa ancora «da chiedere»` : ""}. Si aggiorna da solo: date e orari sono sempre quelli giusti.</p>
    <div class="barra"><input id="cerca" type="search" placeholder="Cerca un titolo, un regista, un'associazione…" value="${esc(cerca)}" aria-label="Cerca">
      <div class="filtri">${nNovita ? bott("novita", `✨ Novità (${nNovita})`) : ""}${bott("tutti", "Tutti")}${bott("cinema", "Cinema")}${bott("eventi", "Spettacoli ed eventi")}</div></div>
    ${html || `<div class="vuoto">${tutti.length ? "Nessun evento con questa ricerca." : "Nei prossimi due mesi non ci sono eventi in programma."}</div>`}
    <section class="generale"><h3>Una domanda che non riguarda un evento?</h3>
      ${domandeDi("").map(domandaHtml).join("")}
      ${aperto === "" ? formChiedi("") : `<button class="btn sm" type="button" data-chiedi="">❓ Fai una domanda</button>`}
      <p class="hint">Manca qualcosa o c'è un errore? Chiedi con «❓ Chiedi» sull'evento: chi organizza lo vede nell'app, risponde o completa le informazioni, e qui compare subito.</p></section>`);
  const c = $("#cerca");
  c.oninput = () => { cerca = c.value; const pos = c.selectionStart; disegna(); const n = $("#cerca"); n.focus(); n.setSelectionRange(pos, pos); };
  document.querySelectorAll("[data-filtro]").forEach((b) => (b.onclick = () => { filtro = b.dataset.filtro; mem.set("-filtro", filtro); disegna(); }));
  const lt = $("#letto"); if (lt) lt.onclick = () => { mem.set("-lette", JSON.stringify([...lette, ...risposte.map((d) => d.id)].slice(-300))); disegna(); };
  document.querySelectorAll("[data-chiedi]").forEach((b) => (b.onclick = () => {
    aperto = b.dataset.chiedi; bozza = b.dataset.cosa ? `Mi mandi ${b.dataset.cosa}?` : "";
    disegna(); const t = document.querySelector(`[data-form="${CSS.escape(aperto)}"] textarea`); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  }));
  document.querySelectorAll("[data-chiudi]").forEach((b) => (b.onclick = () => { aperto = null; bozza = ""; disegna(); }));
  document.querySelectorAll("form.chiedi").forEach((f) => {
    const t = f.querySelector("textarea"); t.oninput = () => (bozza = t.value);
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const testo = t.value.trim(), n = f.querySelector("input"), nome = n ? n.value.trim() : mem.get("-nome");
      if (!testo) { t.focus(); return; }
      if (!nome) { n.focus(); toast("Scrivi il tuo nome"); return; }
      const btn = f.querySelector("[type=submit]"); btn.disabled = true;
      const k = f.dataset.form, e = tutti.find((x) => x.chiave === k);
      const { error } = await sb.rpc("social_chiedi", { p_token: token, p_chiave: k, p_titolo: e ? e.titolo : "", p_testo: testo, p_nome: nome });
      btn.disabled = false;
      if (error) { toast(/Could not find|schema cache/.test(error.message) ? "Le domande non sono ancora attive: avvisa chi organizza" : error.message); return; }
      mem.set("-nome", nome); aperto = null; bozza = "";
      toast("Domanda inviata: la risposta compare qui"); carica();
    };
  });
  document.querySelectorAll("[data-copia]").forEach((b) => (b.onclick = () => copia(testo(tutti.find((e) => e.chiave === b.dataset.copia)))));
}

carica();
document.addEventListener("visibilitychange", () => { if (!document.hidden && dati && aperto === null) carica(); });

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
