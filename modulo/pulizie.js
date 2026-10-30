// © 2026 Fabio Santi, per la Sala San Tommaso Moro. Tutti i diritti riservati (vedi LICENSE).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

// Gruppo pulizie: un link per tutti (?t=codice), senza account. Mostra cosa è successo in sala dall'ultima pulizia
// (quando, per quanto, in quali spazi, per cosa, con quante persone) e si segnano le pulizie fatte con una nota.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cfg = window.SALA_CONFIG || {};
const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false } });
const CHIAVE = "sala-stm-pulizie";
const mem = { get: (k) => { try { return localStorage.getItem(CHIAVE + k) || ""; } catch (e) { return ""; } }, set: (k, v) => { try { localStorage.setItem(CHIAVE + k, v); } catch (e) {} } };
const dalLink = new URLSearchParams(location.search).get("t");
const token = dalLink || mem.get("");
if (token && !dalLink) { const u = new URL(location.href); u.search = "?t=" + token; history.replaceState(null, "", u.href); }

const giorno = (d, o = { weekday: "long", day: "numeric", month: "long" }) => new Date(d + "T12:00:00").toLocaleDateString("it-IT", o);
const minuti = (t) => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + m; };
const durata = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} ${Math.floor(m / 60) === 1 ? "ora" : "ore"}${m % 60 ? ` e ${m % 60}` : ""}`);
const ZONE = { galleria: "Galleria", platea: "Platea", tutta: "Platea e galleria" };
const PUBBLICO = { senza: "senza pubblico", galleria: "pubblico in galleria", libero: "pubblico, ingresso libero", pagamento: "spettacolo a pagamento" };
const TIPI = { teatro: "Teatro", danza: "Danza", musica: "Musica", incontro: "Incontro", altro: "Spettacolo" };
const DURATA_FILM = 135; // un film con l'intervallo, se non si sa di più

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); }
const mostra = (html) => { $("#app").innerHTML = html; };

let settimane = 0, dati = null;
async function carica() {
  if (!token) { mostra(`<div class="vuoto"><h2>Link non completo</h2><p>Usa il link del gruppo pulizie che ti hanno mandato.</p></div>`); return; }
  const { data, error } = await sb.rpc("pulizie_apri", { p_token: token, p_settimane: settimane });
  if (error && !data) { mostra(`<div class="vuoto"><h2>Connessione assente</h2><p>Non riesco a leggere i dati: controlla la connessione e riprova.</p><button class="btn primary" type="button" onclick="location.reload()">Riprova</button></div>`); return; }
  if (!data) { mostra(`<div class="vuoto"><h2>Link non valido</h2><p>Il link è stato rinnovato: chiedi quello nuovo a chi organizza.</p></div>`); return; }
  mem.set("", token);
  dati = data;
  disegna();
}

// un utilizzo della sala, con gli spazi usati e cosa tenere d'occhio
function usi(d) {
  const film = new Set(d.proiezioni.map((p) => p.data));
  const out = [];
  for (const e of d.eventi) {
    // le serate di cinema del calendario sono già nelle proiezioni
    if (film.has(e.data) && /cinema|proiezion|cineforum/i.test(`${e.tipo} ${e.titolo}`)) continue;
    const zone = [];
    if (ZONE[e.spazio]) zone.push(ZONE[e.spazio]);
    else if (e.pubblico === "galleria") zone.push("Galleria");
    else if (["libero", "pagamento"].includes(e.pubblico)) zone.push("Platea");
    else zone.push(e.pubblico === "senza" ? "Sala (senza pubblico)" : "Sala");
    const palco = e.palco > 0 || /danza|teatr|concert|spettacol|saggio|coro|recita|musical/i.test(`${e.tipo} ${e.titolo}`);
    const m = e.giornata ? null : Math.max(0, minuti(e.fine) - minuti(e.inizio));
    out.push({ data: e.data, inizio: e.giornata ? "" : e.inizio, fine: e.giornata ? "" : e.fine, m, titolo: e.titolo, tipo: e.tipo || (PUBBLICO[e.pubblico] || ""),
      zone, palco, tappeto: e.tappeto, persone: e.persone, stima: false, bambini: e.bambini, palcoN: e.palco });
  }
  for (const p of d.proiezioni) {
    const tipo = p.tipo || "";
    out.push({ data: p.data, inizio: p.ora, fine: "", m: DURATA_FILM, titolo: p.titolo, tipo: TIPI[tipo] || "Film", zone: ["Platea"],
      palco: ["teatro", "danza", "musica"].includes(tipo), tappeto: tipo === "danza", persone: p.persone, stima: false });
  }
  return out.sort((a, b) => (a.data + a.inizio).localeCompare(b.data + b.inizio));
}

const SCORTE = ["Carta igienica", "Sapone mani", "Carta asciugamani", "Sacchi spazzatura", "Detersivo pavimenti", "Igienizzante", "Panni e spugne"];
// quando la sala serve di nuovo dopo le pulizie: se è lo stesso giorno o il giorno dopo, va detto chiaro
function prossimo(d) {
  const p = d.prossimo;
  if (!p) return "";
  const stesso = p.data === d.giorno, dopo = new Date(new Date(d.giorno + "T12:00:00").getTime() + 864e5).toISOString().slice(0, 10) === p.data;
  const quando = stesso ? `lo stesso giorno${p.ora ? `, alle ${p.ora}` : ""}` : dopo ? `il giorno dopo (${giorno(p.data)})${p.ora ? ` alle ${p.ora}` : ""}` : `${giorno(p.data)}${p.ora ? ` alle ${p.ora}` : ""}`;
  return `<div class="${stesso || dopo ? "attenzione" : "prossimo"}">La sala serve di nuovo ${esc(quando)}: ${esc(p.titolo)}${stesso ? ". Deve essere pronta per allora." : ""}</div>`;
}

function disegna() {
  const d = dati, lista = usi(d);
  const oggi = d.oggi, passati = lista.filter((u) => u.data < oggi || (u.data === oggi && u.fine && u.fine < new Date().toTimeString().slice(0, 5)));
  const ore = lista.reduce((s, u) => s + (u.m || 0), 0), persone = lista.reduce((s, u) => s + (u.persone || 0), 0);
  const contaZone = {};
  for (const u of lista) for (const z of [...u.zone, ...(u.palco ? ["Palco"] : []), ...(u.tappeto ? ["Tappeto danza"] : [])]) contaZone[z] = (contaZone[z] || 0) + 1;
  const attenzione = [
    ...lista.filter((u) => u.tappeto).map((u) => `Tappeto danza usato: ${giorno(u.data, { weekday: "short", day: "numeric" })} (${u.titolo})`),
    ...lista.filter((u) => u.bambini >= 15).map((u) => `Molti bambini (${u.bambini}): ${giorno(u.data, { weekday: "short", day: "numeric" })} (${u.titolo})`),
    ...lista.filter((u) => u.persone >= 200).map((u) => `Tanta gente (${u.persone} persone): ${giorno(u.data, { weekday: "short", day: "numeric" })} (${u.titolo})`),
  ];
  const giorni = [];
  for (const u of lista) { const g = giorni[giorni.length - 1]; if (g && g.data === u.data) g.usi.push(u); else giorni.push({ data: u.data, usi: [u] }); }
  const titolo = d.giorno === oggi ? "Pulizie di oggi" : d.giorno > oggi ? `Prossime pulizie: ${giorno(d.giorno)}` : `Pulizie di ${giorno(d.giorno)}`;
  const nome = mem.get("-nome");
  mostra(`
    <h2>${esc(titolo)}</h2>
    <p class="hint">Cosa è successo in sala da ${esc(giorno(d.dal))} a ${esc(giorno(d.al))}.</p>
    <div class="settimane"><button class="btn sm" type="button" id="prima">← Settimana prima</button>${settimane ? `<button class="btn sm" type="button" id="dopo">Settimana dopo →</button>` : ""}</div>
    ${lista.length ? `<div class="riepilogo">
      <div class="numeri"><span><b>${lista.length}</b> ${lista.length === 1 ? "utilizzo" : "utilizzi"}</span><span>circa <b>${Math.round(ore / 60)}</b> ${Math.round(ore / 60) === 1 ? "ora" : "ore"}</span>${persone ? `<span>circa <b>${persone}</b> persone</span>` : ""}</div>
      <div class="zone">${Object.entries(contaZone).sort((a, b) => b[1] - a[1]).map(([z, n]) => `<span class="zona">${esc(z)}${n > 1 ? ` ×${n}` : ""}</span>`).join("")}</div>
      ${passati.length < lista.length ? `<div class="hint" style="color:rgba(244,240,230,.75);margin-top:8px">${lista.length - passati.length} ancora in programma prima delle pulizie</div>` : ""}</div>` : ""}
    ${prossimo(d)}
    ${attenzione.length ? `<div class="attenzione">Da tenere d'occhio<ul>${attenzione.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
    ${giorni.length ? giorni.map((g) => `<section class="giorno"><span class="eyebrow">${esc(giorno(g.data))}</span>
      ${g.usi.map((u) => { const futuro = !passati.includes(u);
        return `<div class="uso${futuro ? " futuro" : ""}"><div class="ore">${u.inizio ? `${esc(u.inizio)}${u.fine ? `–${esc(u.fine)}` : ""}` : "Tutto il giorno"}${u.m ? `<small>${esc(durata(u.m))}${u.fine ? "" : " circa"}</small>` : ""}</div>
          <div><div class="cosa">${esc(u.titolo)}</div>${u.tipo ? `<div class="hint">${esc(u.tipo)}</div>` : ""}
          <div class="dett">${u.zone.map((z) => `<span class="zona">${esc(z)}</span>`).join("")}${u.palco ? `<span class="zona palco">Palco${u.palcoN ? ` (${u.palcoN} persone)` : ""}</span>` : ""}${u.tappeto ? `<span class="zona tappeto">Tappeto danza</span>` : ""}
            <span class="hint">${futuro ? "in programma" : u.persone ? `${u.persone} persone` : ""}${u.bambini ? ` · ${u.bambini} bambini` : ""}</span></div></div></div>`; }).join("")}</section>`).join("")
      : `<div class="vuoto">In questi giorni la sala non è stata usata. 🙂</div>`}
    ${d.scorte ? `<div class="panel fatto-box"><h3>Scorte che mancano</h3>
      ${d.scorte.length ? d.scorte.map((s) => `<div class="fatta" style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div><b>${esc(s.cosa)}</b>${s.chi ? ` <span class="hint">segnalato da ${esc(s.chi)}</span>` : ""}</div><button class="btn sm" type="button" data-preso="${esc(s.id)}">Preso ✓</button></div>`).join("") : `<p class="hint">Non manca niente.</p>`}
      <div class="scorte-chip" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">${SCORTE.filter((c) => !d.scorte.some((s) => s.cosa.toLowerCase() === c.toLowerCase())).map((c) => `<button type="button" class="btn sm" data-manca="${esc(c)}">+ ${esc(c)}</button>`).join("")}</div>
      <form id="altro" style="display:flex;gap:6px;margin-top:8px" novalidate><input id="altro-cosa" placeholder="Altro che manca…" maxlength="80" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--surface)"><button class="btn sm" type="submit">Segnala</button></form>
    </div>` : ""}
    <div class="panel fatto-box"><h3>Pulizie fatte</h3>
      ${d.fatte.length ? d.fatte.map((f) => `<div class="fatta"><b>${esc(f.nome)}</b> <span class="hint">${esc(new Date(f.creato).toLocaleString("it-IT", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</span>${f.note ? `<div>${esc(f.note)}</div>` : ""}</div>`).join("") : `<p class="hint">Quando avete finito, segnatelo qui: chi organizza lo vede subito. Potete scrivere anche cosa manca o cosa non va.</p>`}
      ${d.giorno <= oggi || d.giorno <= new Date(Date.now() + 864e5).toISOString().slice(0, 10) ? `<form id="fatto" class="form" novalidate style="margin-top:10px">
        <div class="field"><label for="f-nome">Il tuo nome</label><input id="f-nome" maxlength="60" autocomplete="name" value="${esc(nome)}"></div>
        <div class="field"><label for="f-note">Note (facoltative)</label><textarea id="f-note" maxlength="1000" placeholder="Es. manca carta nei bagni, macchia sulla moquette in galleria, finito il detersivo…"></textarea></div>
        <div class="field"><button class="btn primary" type="submit">Pulizie fatte ✓</button></div></form>` : ""}
    </div>`);
  $("#prima").onclick = () => { settimane++; carica(); };
  const scorta = async (cosa, id) => {
    const { error } = await sb.rpc("pulizie_scorta", { p_token: token, p_cosa: cosa || null, p_nome: mem.get("-nome") || "", p_id: id || null });
    if (error) { toast(error.message); return; }
    toast(id ? "Grazie! Tolto dall'elenco" : `Segnalato: ${cosa}`); carica();
  };
  document.querySelectorAll("[data-manca]").forEach((b) => (b.onclick = () => { b.disabled = true; scorta(b.dataset.manca); }));
  document.querySelectorAll("[data-preso]").forEach((b) => (b.onclick = () => { b.disabled = true; scorta(null, b.dataset.preso); }));
  const al = $("#altro"); if (al) al.onsubmit = (e) => { e.preventDefault(); const v = $("#altro-cosa").value.trim(); if (v) scorta(v); };
  const dopo = $("#dopo"); if (dopo) dopo.onclick = () => { settimane = Math.max(0, settimane - 1); carica(); };
  const f = $("#fatto");
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const nome = $("#f-nome").value.trim();
    if (!nome) { $("#f-nome").focus(); toast("Scrivi il tuo nome"); return; }
    const btn = f.querySelector("button"); btn.disabled = true;
    const { error } = await sb.rpc("pulizie_segna", { p_token: token, p_giorno: d.giorno, p_nome: nome, p_note: $("#f-note").value });
    btn.disabled = false;
    if (error) { toast(error.message); return; }
    mem.set("-nome", nome);
    toast("Grazie! Segnato.");
    carica();
  };
}

carica();
document.addEventListener("visibilitychange", () => { if (!document.hidden && dati) carica(); });
