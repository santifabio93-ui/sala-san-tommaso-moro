// © 2026 Fabio Santi, per la Sala San Tommaso Moro. Tutti i diritti riservati (vedi LICENSE).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

// da aggiornare a ogni rilascio insieme ai «?v=» in index.html, così i browser scaricano subito la nuova versione
const VERSIONE = "2026-11-01.13";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const money = (v) => (Math.round(v) === v ? eur : eur2).format(v || 0);
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const hm = (t) => String(t || "").slice(0, 5);
const TODAY = iso(new Date());
const fmtDay = (s, opts) => parse(s).toLocaleDateString("it-IT", opts || { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtShort = (s) => parse(s).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
const MESI = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleDateString("it-IT", { month: "short" }).replace(".", ""));
const STATI = { opzione: "Opzione", confermata: "Confermata", annullata: "Annullata" };
const RUOLI = { admin: "Amministratore", coordinatore: "Coordinatore", volontario: "Volontario", in_attesa: "In attesa", bloccato: "Bloccato" };
// tariffe 2026 a giornata (documento «Tariffe in uso 2026»); le cifre aggiornate stanno in settings.tariffe
const DEFAULT_TARIFFE = { galleria: 400, platea: 500, tutta: 800, iva: 22, iva_supplementi: false, biglietteria: 100, tappeto: 200, commerciale: 100 };
const SPAZI = { galleria: "Galleria (fino a 134 persone)", platea: "Platea (fino a 338 persone)", tutta: "Platea e galleria (fino a 472 persone)" };
const SUPPLEMENTI = { biglietteria: "Utilizzo biglietteria", tappeto: "Utilizzo tappeto danza", commerciale: "Attività commerciale" };
const VIEWS = {
  calendario: { label: "Calendario", roles: ["admin", "coordinatore", "volontario"] },
  serata: { label: "La serata", roles: ["admin", "coordinatore", "volontario"] },
  prenotazioni: { label: "Prenotazioni", roles: ["admin", "coordinatore"] },
  richieste: { label: "Richieste", roles: ["admin", "coordinatore"] },
  sopralluoghi: { label: "Sopralluoghi", roles: ["admin", "coordinatore", "volontario"] },
  comune: { label: "Comune", roles: ["admin", "coordinatore"] },
  schede: { label: "Schede", roles: ["admin", "coordinatore"] },
  cinema: { label: "Cinema", roles: ["admin", "coordinatore", "volontario"] },
  sito: { label: "Sito web", roles: ["admin", "coordinatore"] },
  c1: { label: "Incassi C1", roles: ["admin", "coordinatore"] },
  stats: { label: "Statistiche", roles: ["admin", "coordinatore"] },
  turni: { label: "Turni", roles: ["admin", "coordinatore", "volontario"] },
  cassa: { label: "Cassa", roles: ["admin", "coordinatore"] },
  bilancio: { label: "Bilancio", roles: ["admin"] },
  donazioni: { label: "Donazioni", roles: ["admin"] },
  economia: { label: "Economia", roles: ["admin"] },
  utenti: { label: "Persone", roles: ["admin"] },
};

document.getElementById("version").textContent = `Versione ${VERSIONE} · © 2026 Fabio Santi per la Sala San Tommaso Moro · Tutti i diritti riservati`;
const cfg = window.SALA_CONFIG || {};
if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || cfg.supabaseUrl.includes("INSERISCI")) {
  show("setup");
  throw new Error("config.js non compilato");
}
// menu principale: le voci con "children" raggruppano più sezioni in un sottomenu
const MENU = [
  { k: "calendario" }, { k: "serata" },
  { label: "Affitti", children: ["prenotazioni", "richieste", "sopralluoghi", "schede", "comune"] },
  { label: "Cinema", children: ["cinema", "c1", "stats"] }, { k: "sito" }, { k: "turni" }, { k: "cassa" }, { label: "Economia", children: ["bilancio", "donazioni", "economia"] }, { k: "utenti" },
];
const SUB_LABELS = { prenotazioni: "Elenco", richieste: "Richieste", sopralluoghi: "Sopralluoghi", comune: "Serate del Comune", schede: "Schede di richiesta", cinema: "Programmazione", c1: "Incassi C1", stats: "Statistiche", bilancio: "Bilancio (prima nota)", donazioni: "Donazioni", economia: "Spese e tariffe" };
const canSee = (k) => (k === "cassa" ? S.canCassa : VIEWS[k].roles.includes(S.role));
const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { flowType: "pkce" } });

const S = {
  session: null, me: null, role: null, canWrite: false, isAdmin: false, canSign: false,
  bookings: [], expenses: [], signups: [], profiles: [], requests: [], invites: [], tariffe: { ...DEFAULT_TARIFFE }, tariffeDb: false, sync: {},
  reqFilter: "nuove", fromRequest: null, cassa: [], editingCassa: null, canCassa: false,
  sopralluoghi: [], sopFilter: "prossimi", editingSop: null, sopFromRequest: null,
  films: [], proiezioni: [], filmFilter: "prossimi", editingFilm: null, draftPr: [],
  c1: [], c1Year: new Date().getFullYear(), c1Mode: "serate", c1Open: null, stPeriod: "12m", primaNota: [], pnYear: new Date().getFullYear(), pnComp: "competenza", pnSett: "", pnQ: "", pnTutti: false, donatori: [], dnYear: new Date().getFullYear(), dnQ: "", editingDon: null, conv: { inizio: null, serate: 25, anni: 20 }, cmAnno: 0, volontari: [], schede: [], scFilter: "attive", editingScheda: null, sito: { stato: "mai", voci: [], pagine: 0, letto: null, err: "" }, sitoCfg: null, sitoNascosti: false, sitoSel: {},
  view: "calendario", month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selected: TODAY, filter: "prossime", q: "", year: new Date().getFullYear(), showTable: false,
  editing: null, editingExp: null, draftTurni: [], shiftFilter: "prossimi", openSignup: null,
};

function show(screen) {
  for (const id of ["loading", "login", "pending", "setup"]) $("#screen-" + id).hidden = id !== screen;
  $("#app").hidden = screen !== "app";
}

/* ---------- accesso ---------- */
$("#btn-login").onclick = async () => {
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
  if (error) $("#login-error").textContent = "Accesso non riuscito: " + error.message;
};
document.querySelectorAll("[data-logout]").forEach((b) => (b.onclick = async () => { await sb.auth.signOut(); location.hash = ""; }));
$("#pending-refresh").onclick = () => start();

let started = false;
sb.auth.onAuthStateChange((event, session) => {
  S.session = session;
  if (event === "SIGNED_OUT") { started = false; stopRealtime(); show("login"); return; }
  if (session && !started) { started = true; setTimeout(start, 0); }
});
// senza attendere qui: il resto del modulo deve essere già pronto quando parte start()
sb.auth.getSession().then(({ data }) => { if (!data.session) show("login"); });

async function start() {
  const user = S.session?.user;
  if (!user) { show("login"); return; }
  const { data: me, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error || !me) { $("#pending-email").textContent = user.email; show("pending"); return; }
  S.me = me; S.role = me.ruolo;
  if (!["admin", "coordinatore", "volontario"].includes(S.role)) {
    $("#pending-email").textContent = me.email || user.email;
    $("#pending-title").textContent = S.role === "bloccato" ? "Accesso non abilitato" : "Richiesta inviata";
    if (S.role === "bloccato") $("#pending-text").textContent = "Il tuo account non è abilitato. Contatta chi gestisce la sala.";
    show("pending");
    return;
  }
  S.isAdmin = S.role === "admin";
  S.canWrite = S.isAdmin || S.role === "coordinatore";
  S.canSign = true;
  S.canCassa = S.canWrite || !!me.cassa;
  $("#me-name").textContent = me.nome || me.email;
  $("#me-role").textContent = RUOLI[S.role];
  if (me.avatar) { $("#me-avatar").src = me.avatar; $("#me-avatar").hidden = false; }
  show("app");
  route();
  await loadAll();
  startRealtime();
  if (S.canWrite) { controllaSito(); setInterval(() => { if (!document.hidden) controllaSito(); }, 30 * 60000); }
}

/* ---------- dati ---------- */
const mapBooking = (r) => ({ ...r, inizio: hm(r.inizio), fine: hm(r.fine), prezzo: Number(r.prezzo) || 0, incassato: Number(r.incassato) || 0, turni: Array.isArray(r.turni) ? r.turni : [] });
const mapSignup = (r) => ({ id: r.id, bookingId: r.booking_id, slotId: r.slot_id, nome: r.nome, uid: r.user_id, volontarioId: r.volontario_id || null, creato: r.creato });

let loading = null;
async function loadAll() {
  if (loading) return loading;
  loading = (async () => {
    const q = [
      S.canWrite ? sb.from("bookings").select("*") : sb.from("eventi").select("*"),
      sb.from("signups").select("*"),
      S.isAdmin ? sb.from("expenses").select("*") : null,
      S.canWrite || S.canCassa ? sb.from("settings").select("*").eq("id", 1).maybeSingle() : null,
      S.canWrite ? sb.from("profiles").select("*").order("creato") : null,
      S.canWrite ? sb.from("richieste").select("*").order("ricevuta", { ascending: false }).limit(300) : null,
      S.isAdmin ? sb.from("inviti").select("*").order("creato") : null,
      sb.from("sopralluoghi").select("*").order("data").order("ora"),
      S.canCassa ? sb.from("cassa").select("*").order("data", { ascending: false }).order("creato", { ascending: false }).limit(1000) : null,
      sb.from("films").select("*").order("titolo"),
      sb.from("proiezioni").select("*").order("data").order("ora"),
      S.isAdmin ? sb.from("prima_nota").select("*").order("data").order("n").limit(10000) : null,
      S.isAdmin ? sb.from("donatori").select("*") : null,
      S.canWrite ? sb.from("schede").select("*").order("creato", { ascending: false }).limit(2000) : null,
      S.canWrite ? sb.from("c1").select("*").order("data", { ascending: false }).order("ora", { ascending: false }).limit(3000) : null,
    ];
    const [b, s, e, st, p, rq, inv, so, ca, fi, pj, pn, dn, sch, c1r] = await Promise.all(q.map((x) => x || Promise.resolve({ data: null })));
    // volontari con link personale (aggiornamento 14): se la tabella manca lo spiega la pagina Turni
    const vo = S.canWrite ? await sb.from("volontari").select("*").order("nome") : { data: null };
    S.loadErr2 = { ...(S.loadErr2 || {}), volontari: vo.error && (vo.error.message || "errore") };
    if (vo.data) S.volontari = vo.data;
    const err = [b, s, e, st, p, rq, inv, so, ca, fi, pj, pn, dn, sch, c1r].find((r) => r && r.error);
    if (err) toast("Impossibile caricare i dati: " + err.error.message);
    // errori per tabella, per spiegare nelle pagine cosa manca (es. uno script SQL non eseguito)
    S.loadErr = { prima_nota: pn.error && pn.error.message, schede: sch.error && sch.error.message, donatori: dn.error && dn.error.message, c1: c1r.error && c1r.error.message, settings: st.error && st.error.message };
    if (b.data) S.bookings = b.data.map(mapBooking);
    if (s.data) S.signups = s.data.map(mapSignup);
    if (e.data) S.expenses = e.data.map((r) => ({ ...r, importo: Number(r.importo) || 0 }));
    if (st.data) {
      S.tariffeDb = "tariffe" in st.data; // aggiornamento 13
      S.preventivoDb = "preventivo" in st.data; // aggiornamento 15
      S.preventivo = st.data.preventivo || {};
      S.tariffe = { ...DEFAULT_TARIFFE, ...(st.data.tariffe || {}) };
      S.sync = { calendario: st.data.sync_calendario, email: st.data.sync_email, cinebot: st.data.sync_cinebot, c1: st.data.sync_c1, primaNota: st.data.sync_prima_nota, primaNotaFile: st.data.prima_nota_file };
      S.conv = { inizio: st.data.convenzione_inizio || null, serate: st.data.convenzione_serate || 25, anni: st.data.convenzione_anni || 20 };
      S.prezzoBiglietto = st.data.prezzo_biglietto == null ? null : Number(st.data.prezzo_biglietto);
      // impostazioni del controllo del sito (aggiornamento 12); senza lo script il controllo funziona lo stesso
      S.sitoCfg = "sito_ignora" in st.data ? { nome: st.data.sito_nome || "", cell: st.data.sito_cellulare || "", avvisati: st.data.sito_avvisati || [], avvisatoIl: st.data.sito_avvisato_il, ignora: st.data.sito_ignora || [] } : null;
    }
    if (p.data) S.profiles = p.data;
    if (rq.data) S.requests = rq.data;
    if (inv.data) S.invites = inv.data;
    if (ca.data) S.cassa = ca.data.map(mapCassa);
    if (fi.data) S.films = fi.data;
    if (pj.data) S.proiezioni = pj.data.map((r) => ({ ...r, ora: hm(r.ora) }));
    if (dn.data) S.donatori = dn.data;
    if (sch.data) S.schede = sch.data;
    if (pn.data) S.primaNota = pn.data.map((r) => ({ ...r, entrate: Number(r.entrate) || 0, uscite: Number(r.uscite) || 0 }));
    if (c1r.data) S.c1 = c1r.data.map((r) => ({ ...r, ora: hm(r.ora), lordo: Number(r.lordo) || 0, iva: Number(r.iva) || 0, imponibile_iva: Number(r.imponibile_iva) || 0, righe: r.righe || [] }));
    if (so.data) S.sopralluoghi = so.data.map((r) => ({ ...r, ora: hm(r.ora), esigenze: r.esigenze || [] }));
    render();
  })();
  try { await loading; } finally { loading = null; }
}

let channel = null, reloadTimer = null;
const scheduleReload = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadAll, 400); };
function startRealtime() {
  stopRealtime();
  channel = sb.channel("sala");
  for (const table of ["bookings", "signups", "expenses", "richieste", "cassa", "sopralluoghi", "films", "proiezioni", "c1", "donatori", "schede", "volontari"]) channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleReload);
  channel.subscribe();
}
function stopRealtime() { if (channel) { sb.removeChannel(channel); channel = null; } }
// i volontari non ricevono gli aggiornamenti delle prenotazioni in tempo reale: ricarico quando tornano sulla pagina e ogni minuto
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.role) loadAll(); });
setInterval(() => { if (!document.hidden && S.role) loadAll(); }, 60000);

async function run(promise, okMsg) {
  const { error } = await promise;
  if (error) throw error;
  if (okMsg) toast(okMsg);
  await loadAll();
}
const errText = (e) => (e && /row-level security|permission/i.test(e.message || "") ? "Non hai i permessi per questa operazione." : "Salvataggio non riuscito: " + (e?.message || "riprova."));

/* ---------- derivazioni ---------- */
const active = (b) => b.stato !== "annullata";
const residuo = (b) => Math.max(0, (Number(b.prezzo) || 0) - (Number(b.incassato) || 0));
function payState(b) {
  if (!S.canWrite) return null;
  const p = Number(b.prezzo) || 0, i = Number(b.incassato) || 0;
  if (b.stato === "annullata") return null;
  if (p > 0 && i >= p) return ["saldato", "Saldato"];
  if (i > 0) return ["acconto", "Acconto " + money(i)];
  if (p > 0) return ["dapagare", "Da pagare"];
  return null;
}
const orario = (b) => (b.giornata_intera ? "Tutto il giorno" : `${b.inizio}–${b.fine}`);
const isRecurring = (b) => (b.gcal_id || "").includes("|");
// eventi nati sul Google Calendar della sala: titolo, data, orario e stato si cambiano dal calendario
const fromCalendar = (b) => !!b && (b.origine === "calendario" || isRecurring(b));
function ago(ts) {
  if (!ts) return "";
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  return m < 1 ? "adesso" : m < 60 ? `${m} min fa` : m < 1440 ? `${Math.round(m / 60)} ore fa` : new Date(ts).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}
const byWhen = (a, b) => (a.data + a.inizio).localeCompare(b.data + b.inizio);
const onDay = (d) => S.bookings.filter((b) => b.data === d).sort(byWhen);
const conflicts = (data, inizio, fine, exceptId) => S.bookings.filter((b) => b.id !== exceptId && active(b) && b.data === data && b.inizio < fine && inizio < b.fine);
function hours(inizio, fine) {
  const [h1, m1] = inizio.split(":").map(Number), [h2, m2] = fine.split(":").map(Number);
  return Math.max(0, (h2 * 60 + m2 - h1 * 60 - m1) / 60);
}
// prezzo di una giornata: spazio (+ IVA) e supplementi scelti; sc = { spazio, biglietteria, tappeto, commerciale }
function calcolaTariffa(sc) {
  const T = S.tariffe, r2 = (x) => Math.round(x * 100) / 100, righe = [];
  if (!sc || !SPAZI[sc.spazio]) return null;
  const base = Number(T[sc.spazio]) || 0, iva = (Number(T.iva) || 0) / 100;
  let imponibileIva = base;
  righe.push([SPAZI[sc.spazio].replace(/ \(.*\)/, ""), base]);
  for (const k of Object.keys(SUPPLEMENTI)) if (sc[k]) { const v = Number(T[k]) || 0; righe.push([SUPPLEMENTI[k], v]); if (T.iva_supplementi) imponibileIva += v; }
  if (iva) righe.push([`IVA ${T.iva}%${T.iva_supplementi ? "" : " sullo spazio"}`, r2(imponibileIva * iva)]);
  return { righe, totale: r2(righe.reduce((t, x) => t + x[1], 0)) };
}
const turni = (b) => (Array.isArray(b.turni) ? b.turni : []);
const signupsFor = (bid, sid) => S.signups.filter((x) => x.bookingId === bid && x.slotId === sid).sort((a, b) => (a.creato || "").localeCompare(b.creato || ""));
function coverage(b) {
  let need = 0, have = 0;
  for (const t of turni(b)) { const n = Number(t.posti) || 0; need += n; have += Math.min(n, signupsFor(b.id, t.id).length); }
  return { need, have };
}
function addMin(t, m) {
  const [h, mm] = t.split(":").map(Number);
  const v = Math.max(0, Math.min(23 * 60 + 59, h * 60 + mm + m));
  return pad(Math.floor(v / 60)) + ":" + pad(v % 60);
}
const uidv = () => Math.random().toString(36).slice(2, 9);
const isMine = (x) => x.uid && x.uid === S.me?.id;

/* ---------- menu ---------- */
function renderTabs() {
  const nReq = S.canWrite ? S.requests.filter((r) => r.stato === "nuova").length : 0;
  const badge = (n) => (n ? `<span class="badge">${n}</span>` : "");
  const cur = (on) => (on ? ' aria-current="page"' : "");
  let sub = null;
  $("#tabs").innerHTML = MENU.map((m) => {
    if (!m.children) return canSee(m.k) ? `<a href="#${m.k}"${cur(S.view === m.k)}>${VIEWS[m.k].label}${m.k === "cinema" ? badge(filmsToFix()) : m.k === "sito" ? badge(sitoNuovi().length) : ""}</a>` : "";
    const kids = m.children.filter(canSee);
    if (!kids.length) return "";
    const groupBadge = (ks) => (ks.includes("richieste") ? badge(nReq + schedeDaVerificare()) : "") + (ks.includes("cinema") ? badge(filmsToFix()) : "");
    if (kids.length === 1) return `<a href="#${kids[0]}"${cur(S.view === kids[0])}>${VIEWS[kids[0]].label}${groupBadge(kids)}</a>`;
    const inside = kids.includes(S.view);
    if (inside) { sub = kids; S.lastSub = S.view; }
    const target = kids.includes(S.lastSub) ? S.lastSub : kids[0];
    return `<a href="#${target}"${cur(inside)}>${m.label}${groupBadge(kids)}</a>`;
  }).join("");
  $("#subtabs").hidden = !sub;
  $("#subtabs").innerHTML = sub ? sub.map((k) => `<a href="#${k}"${cur(S.view === k)}>${SUB_LABELS[k] || VIEWS[k].label}${k === "richieste" ? badge(nReq) : k === "schede" ? badge(schedeDaVerificare()) : k === "cinema" ? badge(filmsToFix()) : ""}</a>`).join("") : "";
}

/* ---------- render ---------- */
function render() {
  if (!S.role) return;
  renderTabs();
  Object.keys(VIEWS).forEach((v) => ($("#view-" + v).hidden = v !== S.view));
  $("#btn-new").hidden = !S.canWrite;
  renderKpis();
  if (S.view === "calendario") { renderCalendar(); renderDay(); }
  if (S.view === "prenotazioni") renderList();
  if (S.view === "richieste") renderRequests();
  if (S.view === "turni") renderShifts();
  if (S.view === "economia") renderEconomy();
  if (S.view === "cassa") renderCassa();
  if (S.view === "sopralluoghi") renderSopralluoghi();
  if (S.view === "cinema") renderCinema();
  if (S.view === "c1") renderC1();
  if (S.view === "stats") renderStats();
  if (S.view === "bilancio") { renderBilancio(); renderPreventivo(); }
  if (S.view === "donazioni") renderDonazioni();
  if (S.view === "comune") renderComune();
  if (S.view === "schede") renderSchede();
  if (S.view === "serata") renderSerata();
  if (S.view === "sito") renderSito();
  if (S.view === "utenti") { renderUsers(); renderInvites(); }
}

function renderKpis() {
  const upcoming = S.bookings.filter((b) => active(b) && b.data >= TODAY).sort(byWhen);
  const next = upcoming[0];
  const scoperti = upcoming.reduce((s, b) => { const c = coverage(b); return s + c.need - c.have; }, 0);
  const nextTile = `<div class="kpi"><span class="eyebrow">Prossimo evento</span><b>${next ? esc(fmtShort(next.data)) : "Nessuno"}</b><small>${next ? esc(next.titolo) + " · " + (next.giornata_intera ? "tutto il giorno" : next.inizio) : "La sala è libera"}</small></div>`;
  if (!S.canWrite) {
    const ids = new Set(upcoming.map((b) => b.id));
    const mine = S.signups.filter((x) => isMine(x) && ids.has(x.bookingId));
    $("#kpis").innerHTML = nextTile + `
      <div class="kpi"><span class="eyebrow">I tuoi turni</span><b>${mine.length}</b><small>nei prossimi eventi</small></div>
      <div class="kpi"><span class="eyebrow">Posti scoperti</span><b>${scoperti}</b><small>nei turni in programma</small></div>
      <div class="kpi"><span class="eyebrow">In programma</span><b>${upcoming.length}</b><small>eventi</small></div>`;
    return;
  }
  const opz = S.bookings.filter((b) => b.stato === "opzione" && b.data >= TODAY).length;
  const due = S.bookings.filter((b) => b.stato === "confermata").reduce((s, b) => s + residuo(b), 0);
  let econ = "";
  if (S.isAdmin) {
    const y = String(new Date().getFullYear());
    const inc = S.bookings.filter((b) => b.data.startsWith(y)).reduce((s, b) => s + b.incassato, 0) + bigliettiDal(y);
    const spe = S.expenses.filter((e) => e.data.startsWith(y)).reduce((s, e) => s + e.importo, 0);
    // se c'è la prima nota vale quella (stesso numero di Economia → Bilancio); altrimenti i dati inseriti nell'app
    const pnAnno = S.primaNota.filter((r) => r.data.startsWith(y) && r.anno === +y);
    econ = pnAnno.length
      ? `<div class="kpi"><span class="eyebrow">Risultato ${y}</span><b class="${sommaE(pnAnno) - sommaU(pnAnno) < 0 ? "neg" : ""}">${money(r2(sommaE(pnAnno) - sommaU(pnAnno)))}</b><small>dalla prima nota · competenza ${y}</small></div>`
      : `<div class="kpi"><span class="eyebrow">Saldo ${y}</span><b>${money(inc - spe)}</b><small>${money(inc)} incassati − ${money(spe)} spese</small></div>`;
  } else {
    econ = `<div class="kpi"><span class="eyebrow">Posti scoperti</span><b>${scoperti}</b><small>nei turni in programma</small></div>`;
  }
  $("#kpis").innerHTML = nextTile + `
    <div class="kpi"><span class="eyebrow">In programma</span><b>${upcoming.length}</b><small>${opz} da confermare${S.isAdmin && scoperti ? ` · ${scoperti} posti scoperti nei turni` : ""}</small></div>
    ${econ}
    <div class="kpi"><span class="eyebrow">Da incassare</span><b>${money(due)}</b><small>su prenotazioni confermate</small></div>`;
}

function renderCalendar() {
  const m = S.month;
  $("#cal-title").textContent = m.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  const start = new Date(m); start.setDate(1 - ((m.getDay() + 6) % 7));
  let html = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i === 35 && d.getMonth() !== m.getMonth()) break;
    const s = iso(d), list = onDay(s);
    const cls = ["day", d.getMonth() !== m.getMonth() && "out", s === TODAY && "today", s === S.selected && "sel"].filter(Boolean).join(" ");
    const chips = list.slice(0, 3).map((b) => `<span class="chip ${b.stato}">${b.giornata_intera ? "" : b.inizio + " "}${esc(b.titolo)}</span>`).join("");
    const sop = sopOnDay(s);
    const more = list.length > 3 ? `<span class="more">+${list.length - 3} altre</span>` : "";
    const sopChips = sop.slice(0, 2).map((x) => `<span class="chip sop ${x.stato}">${x.ora} Sopralluogo</span>`).join("");
    const dots = list.length || sop.length ? `<span class="dots">${list.map((b) => `<i class="dot ${b.stato}"></i>`).join("")}${sop.map(() => `<i class="dot sop"></i>`).join("")}</span>` : "";
    const label = `${fmtDay(s)}${list.length ? ", " + list.length + " prenotazioni" : ", libero"}`;
    html += `<button type="button" class="${cls}" data-day="${s}" aria-label="${esc(label)}"><span class="dnum">${d.getDate()}</span>${chips}${more}${sopChips}${dots}</button>`;
  }
  const g = $("#cal-grid");
  g.innerHTML = html;
  const pc = S.canWrite ? periodoConv(iso(m)) : null, cc = pc && contaComune(pc);
  $("#cal-sync").innerHTML = S.canWrite ? [S.sync.calendario ? `Google Calendar della sala sincronizzato ${ago(S.sync.calendario)}` : "",
    cc ? `<a href="#comune">Serate del Comune: <b>${cc.usate}</b> usate, ${cc.programmate} in calendario, <b>${Math.max(0, S.conv.serate - cc.totale)}</b> rimaste su ${S.conv.serate}${pc.n ? ` (anno ${pc.n} di ${S.conv.anni})` : ""}</a>` : ""].filter(Boolean).join(" · ") : "";
  g.querySelectorAll("[data-day]").forEach((b) => (b.onclick = () => {
    S.selected = b.dataset.day;
    const d = parse(S.selected);
    if (d.getMonth() !== S.month.getMonth()) S.month = new Date(d.getFullYear(), d.getMonth(), 1);
    renderCalendar(); renderDay();
    if (matchMedia("(max-width: 900px)").matches) $("#daypanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

function bookingCard(b, showDate) {
  const ps = payState(b), c = coverage(b);
  return `<button type="button" class="bcard" data-b="${esc(b.id)}">
    <div><div class="t">${esc(b.titolo)}</div>
      <div class="m">${esc([b.referente, b.tipo].filter(Boolean).join(" · "))}</div>
      ${b.note ? `<div class="m">${esc(b.note)}</div>` : ""}</div>
    <div class="r"><span class="when">${showDate ? esc(fmtShort(b.data)) + " · " : ""}${orario(b)}</span>
      <span class="pill ${b.stato}">${STATI[b.stato]}</span>
      ${ps ? `<span class="pill ${ps[0]}">${esc(ps[1])}</span>` : ""}
      ${b.comune && S.canWrite ? `<span class="pill comune">Comune</span>` : ""}
      ${S.canWrite ? pillScheda(b) : ""}
      ${c.need && active(b) ? `<span class="pill ${c.have >= c.need ? "saldato" : "acconto"}">Turni ${c.have}/${c.need}</span>` : ""}</div>
  </button>`;
}
function wireCards(root) {
  root.querySelectorAll("[data-b]").forEach((el) => (el.onclick = () => {
    const b = S.bookings.find((x) => x.id === el.dataset.b);
    if (S.canWrite) openBooking(b);
    else { S.shiftFilter = b.data >= TODAY ? "prossimi" : "passati"; location.hash = "turni"; }
  }));
}

function renderDay() {
  const s = S.selected, list = onDay(s), act = list.filter(active);
  const el = $("#daypanel");
  el.innerHTML = `<span class="eyebrow">${s === TODAY ? "Oggi" : s < TODAY ? "Giorno passato" : "Giorno selezionato"}</span>
    <h3>${esc(fmtDay(s))}</h3>
    ${act.length ? `<div class="busy">Occupata: ${act.map((b) => (b.giornata_intera ? `tutto il giorno (${esc(b.titolo)})` : `${b.inizio}–${b.fine}`)).join(", ")}</div>` : `<div class="free">La sala è libera per tutta la giornata.</div>`}
    <div class="blist">${list.map((b) => bookingCard(b, false)).join("")}</div>
    ${sopOnDay(s).length ? `<div class="daysop">${sopOnDay(s).map((x) => `<button type="button" data-sop="${esc(x.id)}"><b>${x.ora}</b> · Sopralluogo con ${esc(x.nome)}${x.ente ? " (" + esc(x.ente) + ")" : ""}${x.stato !== "da_fare" ? ` · ${SOP_STATI[x.stato].toLowerCase()}` : ""}</button>`).join("")}</div>` : ""}
    ${S.canWrite || (S.canCassa && act.length) ? `<div class="actions" style="margin-top:14px">${S.canWrite ? `<button type="button" class="btn primary" id="book-day">Prenota questa data</button><button type="button" class="btn" id="sop-day">+ Sopralluogo</button>` : ""}${S.canCassa && act.length ? `<button type="button" class="btn" id="cassa-day">Cassa di questa data</button>` : ""}</div>` : ""}`;
  wireCards(el);
  const bd = $("#book-day"); if (bd) bd.onclick = () => openBooking(null, s);
  const cd = $("#cassa-day"); if (cd) cd.onclick = () => openCassaFor(s);
  const sd = $("#sop-day"); if (sd) sd.onclick = () => openSop(null, { data: s });
  el.querySelectorAll("[data-sop]").forEach((b) => (b.onclick = () => openSop(S.sopralluoghi.find((x) => x.id === b.dataset.sop))));
}

const FILTERS = [
  ["prossime", "Prossime", (b) => active(b) && b.data >= TODAY],
  ["opzioni", "Da confermare", (b) => b.stato === "opzione" && b.data >= TODAY],
  ["dasaldare", "Da saldare", (b) => b.stato === "confermata" && residuo(b) > 0],
  ["passate", "Passate", (b) => active(b) && b.data < TODAY],
  ["annullate", "Annullate", (b) => b.stato === "annullata"],
  ["tutte", "Tutte", () => true],
];
function renderList() {
  $("#filters").innerHTML = FILTERS.map(([k, l, f]) => `<button type="button" data-f="${k}" aria-pressed="${S.filter === k}">${l}<span class="c">${S.bookings.filter(f).length}</span></button>`).join("");
  $("#filters").querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { S.filter = b.dataset.f; renderList(); }));
  const f = FILTERS.find((x) => x[0] === S.filter)[2];
  const q = S.q.trim().toLowerCase();
  const list = S.bookings.filter(f).filter((b) => !q || [b.titolo, b.referente, b.tipo, b.note].join(" ").toLowerCase().includes(q)).sort(byWhen);
  if (["passate", "tutte", "annullate"].includes(S.filter)) list.reverse();
  const el = $("#list");
  if (!list.length) {
    el.innerHTML = `<div class="empty">${S.bookings.length ? "Nessuna prenotazione corrisponde a questo filtro." : "Ancora nessuna prenotazione. Usa «+ Nuova prenotazione» per inserire la prima."}</div>`;
    return;
  }
  const groups = new Map();
  for (const b of list) { const k = b.data.slice(0, 7); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
  el.innerHTML = [...groups].map(([k, items]) => `<div class="month-group"><span class="eyebrow">${esc(parse(k + "-01").toLocaleDateString("it-IT", { month: "long", year: "numeric" }))}</span><div class="blist">${items.map((b) => bookingCard(b, true)).join("")}</div></div>`).join("");
  wireCards(el);
}

/* ---------- economia ---------- */
function niceMax(v) {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function renderEconomy() {
  const years = new Set([new Date().getFullYear(), S.year]);
  S.bookings.forEach((b) => years.add(+b.data.slice(0, 4)));
  S.expenses.forEach((e) => years.add(+e.data.slice(0, 4)));
  $("#years").innerHTML = [...years].sort().map((y) => `<button type="button" data-y="${y}" aria-pressed="${S.year === y}">${y}</button>`).join("");
  $("#years").querySelectorAll("[data-y]").forEach((b) => (b.onclick = () => { S.year = +b.dataset.y; renderEconomy(); }));

  const Y = String(S.year);
  const months = MESI.map((label, i) => {
    const k = `${Y}-${pad(i + 1)}`;
    const aff = S.bookings.filter((b) => b.data.startsWith(k)).reduce((s, b) => s + b.incassato, 0);
    const big = bigliettiDal(k);
    const spe = S.expenses.filter((e) => e.data.startsWith(k)).reduce((s, e) => s + e.importo, 0);
    return { label, full: parse(k + "-01").toLocaleDateString("it-IT", { month: "long" }), aff, big, inc: aff + big, spe };
  });

  const W = 720, H = 250, L = 52, R = 8, T = 12, B = 26;
  const max = niceMax(Math.max(...months.flatMap((m) => [m.inc, m.spe])));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const gw = (W - L - R) / 12, bw = Math.min(16, (gw - 10) / 2);
  const bar = (x, v, color) => {
    if (v <= 0) return "";
    const top = y(v), r = Math.min(4, y(0) - top, bw / 2);
    return `<path fill="${color}" d="M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y(0)} Z"/>`;
  };
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Entrate e spese per mese nel ${Y}">`;
  [0, .25, .5, .75, 1].map((t) => t * max).forEach((t) => { svg += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"${t ? ' stroke-dasharray="2 3"' : ""}/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${esc(eur.format(t))}</text>`; });
  months.forEach((m, i) => {
    const cx = L + gw * i + gw / 2;
    svg += bar(cx - bw - 1, m.inc, "var(--accent)") + bar(cx + 1, m.spe, "var(--spese)");
    svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(m.label)}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${L + gw * i}" y="${T}" width="${gw}" height="${H - T - B}" fill="transparent"/>`;
  });
  svg += `</svg><div class="tip" id="tip" hidden></div>`;
  const chart = $("#chart");
  chart.innerHTML = svg;
  const tip = $("#tip"), svgEl = chart.querySelector("svg");
  chart.querySelectorAll(".hit").forEach((h) => {
    const showTip = () => {
      const m = months[+h.dataset.i], rect = svgEl.getBoundingClientRect(), k = rect.width / W;
      tip.innerHTML = `<b>${esc(m.full)} ${Y}</b><br><i style="background:var(--accent)"></i>Entrate ${money(m.inc)}${m.big ? ` <span style="opacity:.75">(biglietti ${money(m.big)})</span>` : ""}<br><i style="background:var(--spese)"></i>Spese ${money(m.spe)}<br>Saldo ${money(m.inc - m.spe)}`;
      tip.style.left = Math.max(70, Math.min(rect.width - 70, (L + gw * +h.dataset.i + gw / 2) * k)) + "px";
      tip.style.top = (y(Math.max(m.inc, m.spe)) * k - 8) + "px";
      tip.hidden = false;
      h.setAttribute("fill", "var(--sunk)"); h.setAttribute("fill-opacity", ".35");
    };
    h.addEventListener("mouseenter", showTip);
    h.addEventListener("click", showTip);
    h.addEventListener("mouseleave", () => { tip.hidden = true; h.setAttribute("fill", "transparent"); });
  });
  const tI = months.reduce((s, m) => s + m.inc, 0), tS = months.reduce((s, m) => s + m.spe, 0);
  const tA = months.reduce((s, m) => s + m.aff, 0), tB = months.reduce((s, m) => s + m.big, 0);
  $("#chart-table").innerHTML = `<table><thead><tr><th>Mese</th><th class="n">Prenotazioni</th><th class="n">Biglietti</th><th class="n">Spese</th><th class="n">Saldo</th></tr></thead><tbody>
    ${months.map((m) => `<tr><td class="cap">${esc(m.full)}</td><td class="n">${money(m.aff)}</td><td class="n">${money(m.big)}</td><td class="n">${money(m.spe)}</td><td class="n">${money(m.inc - m.spe)}</td></tr>`).join("")}
    <tr><th>Totale ${Y}</th><th class="n">${money(tA)}</th><th class="n">${money(tB)}</th><th class="n">${money(tS)}</th><th class="n">${money(tI - tS)}</th></tr></tbody></table>`;
  $("#chart-table").hidden = !S.showTable;
  $("#toggle-table").textContent = S.showTable ? "Nascondi tabella" : "Mostra tabella";

  const rec = S.bookings.filter((b) => b.stato === "confermata" && residuo(b) > 0).sort(byWhen);
  $("#receivables").innerHTML = rec.length
    ? `<table><thead><tr><th>Data</th><th>Evento</th><th class="n">Prezzo</th><th class="n">Residuo</th></tr></thead><tbody>${rec.map((b) => `<tr class="click" data-b="${esc(b.id)}"><td>${esc(fmtShort(b.data))}</td><td>${esc(b.titolo)}</td><td class="n">${money(b.prezzo)}</td><td class="n">${money(residuo(b))}</td></tr>`).join("")}</tbody></table>`
    : `<div class="empty">Tutte le prenotazioni confermate sono saldate.</div>`;
  $("#receivables").querySelectorAll("[data-b]").forEach((r) => (r.onclick = () => openBooking(S.bookings.find((b) => b.id === r.dataset.b))));

  const exps = S.expenses.filter((e) => e.data.startsWith(Y)).sort((a, b) => b.data.localeCompare(a.data));
  $("#exp-total").textContent = `Totale ${Y}: ${money(tS)}`;
  $("#expenses").innerHTML = exps.length
    ? `<table><thead><tr><th>Data</th><th>Voce</th><th class="n">Importo</th></tr></thead><tbody>${exps.map((e) => `<tr class="click" data-e="${esc(e.id)}"><td>${esc(parse(e.data).toLocaleDateString("it-IT", { day: "numeric", month: "short" }))}</td><td>${esc(e.descrizione || e.categoria)}<div class="hint">${esc(e.categoria)}</div></td><td class="n">${money(e.importo)}</td></tr>`).join("")}</tbody></table>`
    : `<div class="empty">Nessuna spesa registrata nel ${Y}.</div>`;
  $("#expenses").querySelectorAll("[data-e]").forEach((r) => (r.onclick = () => openExpense(S.expenses.find((e) => e.id === r.dataset.e))));

  const fill = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v ?? ""; };
  for (const k of ["galleria", "platea", "tutta", "iva", "biglietteria", "tappeto", "commerciale"]) fill("#r-" + k, S.tariffe[k]);
  if (document.activeElement !== $("#r-iva-supp")) $("#r-iva-supp").checked = !!S.tariffe.iva_supplementi;
  fill("#r-biglietto", S.prezzoBiglietto);
  renderTariffeCosti();
  $("#r-avviso").innerHTML = S.tariffeDb ? "" : `<div class="warn">Per salvare le tariffe esegui in Supabase lo script <b>013_tariffe.sql</b>. Intanto l'app usa le tariffe 2026.</div>`;
}

/* ---------- persone ---------- */
function renderUsers() {
  const list = [...S.profiles].sort((a, b) => (a.ruolo === "in_attesa" ? -1 : 0) - (b.ruolo === "in_attesa" ? -1 : 0));
  $("#users").innerHTML = list.length
    ? `<table><thead><tr><th>Nome</th><th>Email</th><th>Ruolo</th><th>Fa cassa</th></tr></thead><tbody>${list.map((p) => `<tr>
        <td>${esc(p.nome)}${p.id === S.me.id ? ' <span class="hint">(tu)</span>' : ""}</td>
        <td>${esc(p.email)}</td>
        <td><select data-u="${esc(p.id)}" aria-label="Ruolo di ${esc(p.nome)}"${p.id === S.me.id ? " disabled" : ""}>${Object.entries(RUOLI).map(([k, l]) => `<option value="${k}"${p.ruolo === k ? " selected" : ""}>${l}</option>`).join("")}</select>
          ${p.ruolo === "in_attesa" ? ' <span class="pill acconto">Da approvare</span>' : ""}</td>
        <td>${["admin", "coordinatore"].includes(p.ruolo) ? '<span class="hint">sempre</span>' : p.ruolo === "volontario" ? `<label class="check"><input type="checkbox" data-cassa="${esc(p.id)}"${p.cassa ? " checked" : ""}> abilitato</label>` : ""}</td></tr>`).join("")}</tbody></table>`
    : `<div class="empty">Nessuna persona registrata.</div>`;
  $("#users").querySelectorAll("[data-cassa]").forEach((cb) => (cb.onchange = async () => {
    cb.disabled = true;
    try { await run(sb.from("profiles").update({ cassa: cb.checked }).eq("id", cb.dataset.cassa), cb.checked ? "Abilitato alla cassa" : "Non fa più cassa"); }
    catch (e) { toast(errText(e)); render(); }
  }));
  $("#users").querySelectorAll("[data-u]").forEach((sel) => (sel.onchange = async () => {
    sel.disabled = true;
    try { await run(sb.from("profiles").update({ ruolo: sel.value }).eq("id", sel.dataset.u), "Ruolo aggiornato"); }
    catch (e) { toast(errText(e)); render(); }
  }));
}

function renderInvites() {
  const el = $("#invites");
  el.innerHTML = S.invites.length
    ? `<table><thead><tr><th>Email</th><th>Ruolo</th><th>Stato</th><th></th></tr></thead><tbody>${S.invites.map((i) => {
        const joined = S.profiles.some((p) => (p.email || "").toLowerCase() === i.email);
        return `<tr><td>${esc(i.email)}</td><td>${RUOLI[i.ruolo]}</td><td>${joined ? '<span class="pill saldato">Ha già fatto l\'accesso</span>' : '<span class="hint">In attesa del primo accesso</span>'}</td><td class="n"><button class="btn ghost sm" type="button" data-inv="${esc(i.email)}" aria-label="Togli ${esc(i.email)}">✕</button></td></tr>`;
      }).join("")}</tbody></table>`
    : `<div class="hint">Nessuna email pre-approvata.</div>`;
  el.querySelectorAll("[data-inv]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await run(sb.from("inviti").delete().eq("email", b.dataset.inv), "Email tolta dall'elenco"); } catch (e) { toast(errText(e)); b.disabled = false; }
  }));
}
$("#invite-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const emails = [...new Set($("#inv-emails").value.toLowerCase().split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
  if (!emails.length) { toast("Scrivi almeno un indirizzo email valido"); return; }
  try {
    await run(sb.from("inviti").upsert(emails.map((email) => ({ email, ruolo: $("#inv-ruolo").value }))), `${emails.length} email aggiunte`);
    $("#inv-emails").value = "";
  } catch (x) { toast(errText(x)); }
});

/* ---------- richieste da email ---------- */
const REQ_FILTERS = [["nuove", "Da gestire", "nuova"], ["convertite", "Diventate prenotazioni", "convertita"], ["scartate", "Scartate", "scartata"]];
function renderRequests() {
  $("#req-filters").innerHTML = REQ_FILTERS.map(([k, l, st]) => `<button type="button" data-f="${k}" aria-pressed="${S.reqFilter === k}">${l}<span class="c">${S.requests.filter((r) => r.stato === st).length}</span></button>`).join("");
  $("#req-filters").querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { S.reqFilter = b.dataset.f; renderRequests(); }));
  $("#req-sync").textContent = S.sync.email ? `Email controllate ${ago(S.sync.email)}` : "Le email arrivano qui quando lo script Google è attivo";
  const st = REQ_FILTERS.find((x) => x[0] === S.reqFilter)[2];
  const list = S.requests.filter((r) => r.stato === st);
  const el = $("#requests");
  if (!list.length) {
    el.innerHTML = `<div class="empty">${st === "nuova" ? "Nessuna nuova richiesta. Le email che chiedono la sala compaiono qui da sole." : "Nessuna richiesta in questo elenco."}</div>`;
    return;
  }
  el.innerHTML = `<div class="blist">${list.map((r) => {
    const quando = r.data_proposta ? `${fmtShort(r.data_proposta)}${r.ora_proposta ? " · ore " + hm(r.ora_proposta) : ""}` : "";
    const busy = r.data_proposta ? S.bookings.filter((b) => active(b) && b.data === r.data_proposta) : [];
    const linked = r.booking_id && S.bookings.find((b) => b.id === r.booking_id);
    return `<article class="panel req">
      <div class="top-line"><span class="from">${esc(r.mittente)}${r.mittente_email && r.mittente_email !== r.mittente ? ` <span class="hint">${esc(r.mittente_email)}</span>` : ""}</span>
        <span class="hint">ricevuta ${esc(new Date(r.ricevuta).toLocaleDateString("it-IT", { day: "numeric", month: "short" }))} · ${esc(r.account)}</span></div>
      <div class="subj">${esc(r.oggetto || "(senza oggetto)")}</div>
      ${quando ? `<div><span class="pill ${busy.length ? "dapagare" : "saldato"}">Data trovata: ${esc(quando)}${busy.length ? " · già occupata" : " · sala libera"}</span>${busy.length ? ` <span class="hint">${busy.map((b) => esc(b.titolo)).join(", ")}</span>` : ""}</div>` : `<div class="hint">Nessuna data riconosciuta nel testo</div>`}
      <div class="snippet">${esc(r.testo.slice(0, 260))}${r.testo.length > 260 ? "…" : ""}</div>
      ${r.testo.length > 260 ? `<details><summary>Leggi tutta l'email</summary><pre>${esc(r.testo)}</pre></details>` : ""}
      <div class="btns">
        ${r.stato === "nuova" ? `<button class="btn primary sm" type="button" data-conv="${esc(r.id)}">Crea prenotazione</button><button class="btn sm" type="button" data-sopr="${esc(r.id)}">Fissa sopralluogo</button><button class="btn sm" type="button" data-skip="${esc(r.id)}">Scarta</button>` : ""}
        ${r.stato === "scartata" ? `<button class="btn sm" type="button" data-back="${esc(r.id)}">Rimetti tra quelle da gestire</button>` : ""}
        ${linked ? `<button class="btn sm" type="button" data-open="${esc(linked.id)}">Apri prenotazione</button>` : ""}
        ${r.link ? `<a class="btn ghost sm" href="${esc(r.link)}" target="_blank" rel="noopener">Apri in Gmail</a>` : ""}
      </div>
    </article>`;
  }).join("")}</div>`;
  const setState = async (id, stato, msg) => { try { await run(sb.from("richieste").update({ stato }).eq("id", id), msg); } catch (e) { toast(errText(e)); } };
  el.querySelectorAll("[data-skip]").forEach((b) => (b.onclick = () => { b.disabled = true; setState(b.dataset.skip, "scartata", "Richiesta scartata"); }));
  el.querySelectorAll("[data-back]").forEach((b) => (b.onclick = () => { b.disabled = true; setState(b.dataset.back, "nuova", "Richiesta rimessa tra quelle da gestire"); }));
  el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openBooking(S.bookings.find((x) => x.id === b.dataset.open))));
  el.querySelectorAll("[data-sopr]").forEach((b) => (b.onclick = () => {
    const r = S.requests.find((x) => x.id === b.dataset.sopr);
    openSop(null, { nome: r.mittente, email: r.mittente_email, evento: r.oggetto.replace(/^(re|fwd?|i|r):\s*/i, "").slice(0, 120), data_evento: r.data_proposta || "", richiesta_id: r.id });
  }));
  el.querySelectorAll("[data-conv]").forEach((b) => (b.onclick = () => {
    const r = S.requests.find((x) => x.id === b.dataset.conv);
    const ini = r.ora_proposta ? hm(r.ora_proposta) : "20:30";
    S.fromRequest = r.id;
    openBooking(null, r.data_proposta || TODAY, {
      titolo: r.oggetto.replace(/^(re|fwd?|i|r):\s*/i, "").slice(0, 120), referente: r.mittente, email: r.mittente_email,
      inizio: ini, fine: addMin(ini, 150), tipo: "", note: `Richiesta arrivata per email il ${new Date(r.ricevuta).toLocaleDateString("it-IT")}.`,
    });
  }));
}

/* ---------- prenotazione ---------- */
const dlgB = $("#dlg-booking"), dlgE = $("#dlg-expense"), dlgC = $("#dlg-copy");
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));

function openBooking(b, date, prefill) {
  S.sopToBook = null;
  if (!S.canWrite) return;
  S.editing = b ? b.id : null;
  const v = b || { titolo: "", referente: "", tipo: "Festa privata", telefono: "", email: "", data: date || S.selected || TODAY, inizio: "16:00", fine: "20:00", prezzo: "", incassato: 0, stato: "opzione", note: "", turni: [], ...(prefill || {}) };
  if (!prefill) S.fromRequest = null;
  $("#b-head").textContent = b ? "Prenotazione" : "Nuova prenotazione";
  for (const k of ["titolo", "referente", "tipo", "telefono", "email", "data", "inizio", "fine", "prezzo", "incassato", "stato", "note"]) $("#b-" + k).value = v[k] ?? "";
  // tariffa: quella salvata, altrimenti lo spazio dedotto dal pubblico previsto nella scheda dell'organizzatore
  const sk = b && S.schede.filter((x) => x.booking_id === b.id && x.dati && x.dati.fascia).sort((x, y) => (y.compilata_il || "").localeCompare(x.compilata_il || ""))[0];
  const tar = v.tariffa || (sk ? { spazio: sk.dati.fascia, dallaScheda: true } : {});
  $("#b-spazio").value = SPAZI[tar.spazio] ? tar.spazio : "";
  for (const k of Object.keys(SUPPLEMENTI)) $("#b-t-" + k).checked = !!tar[k];
  S.prezzoAuto = null;
  $("#b-pubblico").innerHTML = `<option value="">Da scegliere</option>${Object.entries(PUBBLICO).map(([k, l]) => `<option value="${k}">${esc(l)} · ${regoleTurni()[k]} ${regoleTurni()[k] === 1 ? "persona" : "persone"}</option>`).join("")}`;
  $("#b-pubblico").value = (v.tariffa && PUBBLICO[v.tariffa.pubblico]) ? v.tariffa.pubblico : "";
  if (!b && !v.prezzo) applicaTariffa();
  aggiornaTariffa(tar.dallaScheda && !v.tariffa);
  S.draftTurni = turni(v).map((t) => ({ ...t }));
  renderSlotEditor();
  $("#b-giornata").checked = !!v.giornata_intera;
  $("#b-comune").checked = !!v.comune;
  hintComune();
  syncAllDay();
  $("#b-origin").textContent = !b ? (S.fromRequest ? "Dati presi dall'email: controllali prima di salvare." : "")
    : fromCalendar(b) ? "Evento del Google Calendar della sala: titolo, data, orario e stato si cambiano dal calendario. Qui gestisci prezzo, incassi, turni e note."
    : b.gcal_id ? "Sincronizzata con il Google Calendar della sala: le modifiche arrivano anche lì entro 15 minuti." : "";
  const lock = fromCalendar(b);
  for (const k of ["titolo", "data", "stato"]) $("#b-" + k).disabled = lock;
  $("#b-giornata").disabled = lock;
  $("#b-error").innerHTML = "";
  renderDeleteArea("#b-delete-area", !!b && !fromCalendar(b), async () => { await run(sb.from("bookings").delete().eq("id", b.id), "Prenotazione eliminata"); dlgB.close(); });
  checkAvail();
  dlgB.showModal();
}
function renderDeleteArea(sel, showIt, onDelete) {
  const el = $(sel);
  if (!showIt) { el.innerHTML = ""; return; }
  el.innerHTML = `<button class="btn danger sm" type="button">Elimina</button>`;
  el.firstChild.onclick = () => {
    el.innerHTML = `<div class="confirm">Eliminare definitivamente? <button class="btn danger sm" type="button" data-yes>Sì, elimina</button><button class="btn sm" type="button" data-no>No</button></div>`;
    el.querySelector("[data-yes]").onclick = async (e) => { e.target.disabled = true; try { await onDelete(); } catch (err) { toast(errText(err)); e.target.disabled = false; } };
    el.querySelector("[data-no]").onclick = () => renderDeleteArea(sel, true, onDelete);
  };
}
function checkAvail() {
  const all = $("#b-giornata").checked;
  const d = $("#b-data").value, i = all ? "00:00" : $("#b-inizio").value, f = all ? "23:59" : $("#b-fine").value, el = $("#b-avail");
  if (!d || !i || !f) { el.innerHTML = ""; return; }
  if (f <= i) { el.innerHTML = `<div class="warn">L'orario di fine deve essere dopo l'inizio.</div>`; return; }
  const c = $("#b-stato").value === "annullata" ? [] : conflicts(d, i, f, S.editing);
  el.innerHTML = c.length
    ? `<div class="warn">Sovrapposizione con: ${c.map((b) => `${esc(b.titolo)} (${orario(b).toLowerCase()}, ${STATI[b.stato].toLowerCase()})`).join("; ")}</div>`
    : `<div class="ok-note">Sala libera ${all ? "per tutto il giorno" : `in questo orario · ${hours(i, f).toLocaleString("it-IT")} ore`}</div>`;
}
function renderSlotEditor() {
  const el = $("#b-turni");
  if (!S.draftTurni.length) { el.innerHTML = `<div class="hint">Nessun turno. Usa «Proponi turni» per allestimento, accoglienza e riordino, oppure aggiungi una fascia.</div>`; return; }
  el.innerHTML = S.draftTurni.map((t, i) => {
    const n = S.editing ? signupsFor(S.editing, t.id).length : 0;
    return `<div class="slot-row" data-i="${i}">
      <div class="nm"><label for="t-l-${i}">Fascia</label><input id="t-l-${i}" data-k="label" value="${esc(t.label)}" placeholder="Es. Allestimento"></div>
      <div><label for="t-i-${i}">Dalle</label><input id="t-i-${i}" type="time" data-k="inizio" value="${esc(t.inizio)}"></div>
      <div><label for="t-f-${i}">Alle</label><input id="t-f-${i}" type="time" data-k="fine" value="${esc(t.fine)}"></div>
      <div><label for="t-p-${i}">Persone</label><input id="t-p-${i}" type="number" min="1" max="50" data-k="posti" value="${esc(t.posti)}"></div>
      <button class="btn ghost sm" type="button" data-del="${i}" aria-label="Togli fascia" title="${n ? n + " iscritti" : "Togli fascia"}">✕</button>
    </div>`;
  }).join("");
  el.querySelectorAll("input[data-k]").forEach((inp) => inp.addEventListener("input", () => {
    const t = S.draftTurni[+inp.closest(".slot-row").dataset.i];
    t[inp.dataset.k] = inp.dataset.k === "posti" ? Number(inp.value) || 0 : inp.value;
  }));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { S.draftTurni.splice(+b.dataset.del, 1); renderSlotEditor(); }));
}
$("#b-turni-add").onclick = () => {
  const last = S.draftTurni[S.draftTurni.length - 1];
  const ini = last ? last.fine : $("#b-inizio").value || "16:00";
  S.draftTurni.push({ id: uidv(), label: "", inizio: ini, fine: addMin(ini, 120), posti: 2 });
  renderSlotEditor();
  const inputs = $("#b-turni").querySelectorAll('input[data-k="label"]'); inputs[inputs.length - 1]?.focus();
};
$("#b-turni-std").onclick = () => {
  const prev = S.editing ? S.bookings.find((x) => x.id === S.editing) : null;
  const b = { ...(prev || {}), id: S.editing, tipo: $("#b-tipo").value, titolo: $("#b-titolo").value, data: $("#b-data").value, inizio: $("#b-inizio").value || "16:00", fine: $("#b-fine").value || "20:00", giornata_intera: $("#b-giornata").checked, tariffa: { ...((prev && prev.tariffa) || {}), ...sceltaTariffa(), pubblico: $("#b-pubblico").value || undefined } };
  const k = $("#b-pubblico").value || pubblicoDi(b).k;
  if (!k) { toast("Scegli prima il pubblico in sala: decide quante persone servono"); $("#b-pubblico").focus(); return; }
  $("#b-pubblico").value = k;
  const proposti = turniProposti(b, k);
  if (!proposti) { toast("L'evento è «tutto il giorno»: togli la spunta e indica l'orario, oppure aggiungi le fasce a mano"); return; }
  S.draftTurni.push(...proposti);
  renderSlotEditor();
};
["#b-data", "#b-inizio", "#b-fine", "#b-stato"].forEach((s) => $(s).addEventListener("input", checkAvail));
function syncAllDay() {
  const all = $("#b-giornata").checked;
  const lock = fromCalendar(S.bookings.find((x) => x.id === S.editing));
  $("#b-inizio").disabled = all || lock; $("#b-fine").disabled = all || lock;
  checkAvail();
}
$("#b-giornata").addEventListener("change", syncAllDay);
const sceltaTariffa = () => ({ spazio: $("#b-spazio").value, ...Object.fromEntries(Object.keys(SUPPLEMENTI).map((k) => [k, $("#b-t-" + k).checked])) });
function aggiornaTariffa(dallaScheda) {
  const c = calcolaTariffa(sceltaTariffa());
  $("#b-calc").innerHTML = c ? c.righe.map(([l, x]) => `${esc(l)} ${money(x)}`).join(" + ") + ` = <b>${money(c.totale)}</b>${dallaScheda ? " · spazio dal pubblico previsto nella scheda" : ""}` : "Scegli lo spazio per calcolare il prezzo.";
  $("#b-suggest").disabled = !c;
}
function applicaTariffa() {
  const c = calcolaTariffa(sceltaTariffa());
  if (c) { $("#b-prezzo").value = c.totale; S.prezzoAuto = c.totale; }
}
// cambiando spazio o supplementi il prezzo si aggiorna, se non è stato scritto a mano
["#b-spazio", ...Object.keys(SUPPLEMENTI).map((k) => "#b-t-" + k)].forEach((sel) => $(sel).addEventListener("change", () => {
  const p = $("#b-prezzo").value;
  if (p === "" || Number(p) === S.prezzoAuto) applicaTariffa();
  aggiornaTariffa();
}));
$("#b-suggest").onclick = applicaTariffa;
$("#b-saldo").onclick = () => { $("#b-incassato").value = $("#b-prezzo").value || 0; };

$("#booking-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const g = (k) => $("#b-" + k).value.trim();
  const rec = {
    titolo: g("titolo"), referente: g("referente"), tipo: g("tipo"), telefono: g("telefono"), email: g("email"),
    data: g("data"), giornata_intera: $("#b-giornata").checked, comune: $("#b-comune").checked,
    inizio: $("#b-giornata").checked ? "00:00" : g("inizio"), fine: $("#b-giornata").checked ? "23:59" : g("fine"),
    prezzo: Number(g("prezzo")) || 0, incassato: Number(g("incassato")) || 0, stato: g("stato"), note: g("note"),
    ...(S.tariffeDb ? { tariffa: $("#b-spazio").value || $("#b-pubblico").value ? { ...sceltaTariffa(), ...($("#b-pubblico").value ? { pubblico: $("#b-pubblico").value } : {}) } : null } : {}),
    turni: S.draftTurni.filter((t) => t.label.trim() || t.inizio).map((t) => ({ id: t.id, label: t.label.trim() || "Turno", inizio: t.inizio, fine: t.fine, posti: Math.max(1, Number(t.posti) || 1) })),
  };
  const badSlot = rec.turni.find((t) => !t.inizio || !t.fine || t.fine <= t.inizio);
  const err = !rec.titolo ? "Scrivi il nome dell'evento." : !rec.data ? "Scegli la data." : !(rec.fine > rec.inizio) ? "L'orario di fine deve essere dopo l'inizio." : badSlot ? `Controlla gli orari del turno «${esc(badSlot.label)}»: la fine deve essere dopo l'inizio.` : "";
  if (err) { $("#b-error").innerHTML = `<div class="warn">${err}</div>`; return; }
  const btn = $("#b-submit"); btn.disabled = true;
  try {
    if (S.editing) {
      const prev = S.bookings.find((x) => x.id === S.editing);
      if (fromCalendar(prev)) for (const k of ["titolo", "data", "inizio", "fine", "giornata_intera", "stato"]) delete rec[k];
      await run(sb.from("bookings").update(rec).eq("id", S.editing), "Prenotazione aggiornata");
    } else {
      const { data: created, error } = await sb.from("bookings").insert({ ...rec, origine: S.fromRequest ? "email" : "app" }).select("id").single();
      if (error) throw error;
      if (S.fromRequest) await sb.from("richieste").update({ stato: "convertita", booking_id: created.id }).eq("id", S.fromRequest);
      if (S.sopToBook) await sb.from("sopralluoghi").update({ booking_id: created.id }).eq("id", S.sopToBook);
      S.fromRequest = null; S.sopToBook = null;
      toast("Prenotazione salvata");
      await loadAll();
    }
    dlgB.close();
    if (rec.data) { S.selected = rec.data; S.month = new Date(parse(rec.data).getFullYear(), parse(rec.data).getMonth(), 1); }
    render();
  } catch (x) {
    $("#b-error").innerHTML = `<div class="warn">${esc(errText(x))}</div>`;
  } finally { btn.disabled = false; }
});

/* ---------- turni ---------- */
const SHIFT_FILTERS = [
  ["prossimi", "Prossimi", (b) => b.data >= TODAY],
  ["scoperti", "Mancano volontari", (b) => b.data >= TODAY && (({ need, have }) => have < need)(coverage(b))],
  ["miei", "I miei turni", (b) => b.data >= TODAY && S.signups.some((x) => x.bookingId === b.id && isMine(x))],
  ["passati", "Passati", (b) => b.data < TODAY],
];
function renderShifts() {
  const base = S.bookings.filter((b) => active(b) && turni(b).length);
  $("#shift-filters").innerHTML = SHIFT_FILTERS.map(([k, l, f]) => `<button type="button" data-f="${k}" aria-pressed="${S.shiftFilter === k}">${l}<span class="c">${base.filter(f).length}</span></button>`).join("");
  $("#shift-filters").querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { S.shiftFilter = b.dataset.f; S.openSignup = null; renderShifts(); }));
  renderPromemoria();
  renderSenzaTurni();
  renderVolontari();
  $("#btn-sondaggio").hidden = !S.canWrite;
  $("#btn-sondaggio").onclick = () => { const t = testoSondaggio(14); if (t) openCopyText(t); else toast("Nei prossimi 14 giorni non ci sono posti scoperti nei turni"); };
  $("#shift-hint").textContent = S.canWrite ? "Puoi aggiungere anche i nomi arrivati su WhatsApp" : `Ti segni come «${S.me.nome || S.me.email}»`;
  const list = base.filter(SHIFT_FILTERS.find((x) => x[0] === S.shiftFilter)[2]).sort(byWhen);
  if (S.shiftFilter === "passati") list.reverse();
  const el = $("#shifts");
  if (!list.length) {
    el.innerHTML = `<div class="empty">${base.length ? "Nessun evento in questo elenco." : S.canWrite ? "Nessun evento ha ancora dei turni. Apri una prenotazione e aggiungi le fasce orarie nella sezione «Turni volontari»." : "Non ci sono ancora turni in programma."}</div>`;
    return;
  }
  el.innerHTML = `<div class="shift-list">${list.map(shiftEvent).join("")}</div>`;
  el.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openBooking(S.bookings.find((x) => x.id === b.dataset.edit))));
  el.querySelectorAll("[data-wa]").forEach((b) => (b.onclick = () => openCopy(S.bookings.find((x) => x.id === b.dataset.wa))));
  el.querySelectorAll("[data-join]").forEach((b) => (b.onclick = async () => {
    const [bid, sid] = b.dataset.join.split("|");
    if (S.canWrite) { S.openSignup = { bid, sid, value: "" }; renderShifts(); return; }
    b.disabled = true;
    try { await run(sb.from("signups").insert({ booking_id: bid, slot_id: sid, nome: S.me.nome || S.me.email, user_id: S.me.id }), "Sei in turno, grazie!"); }
    catch (e) { b.disabled = false; toast(/duplicate|unique/i.test(e.message || "") ? "Sei già in questo turno" : errText(e)); }
  }));
  el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => {
    const x = S.signups.find((x) => x.id === b.dataset.rm); if (!x) return;
    b.disabled = true;
    try { await run(sb.from("signups").delete().eq("id", x.id), isMine(x) ? "Ti sei tolto dal turno" : `Tolto ${x.nome} dal turno`); }
    catch (e) { b.disabled = false; toast(errText(e)); }
  }));
  const f = el.querySelector("form.signup");
  if (f) {
    const inp = f.querySelector("input");
    inp.value = S.openSignup.value || "";
    inp.focus();
    inp.addEventListener("input", () => (S.openSignup.value = inp.value));
    f.querySelector("[data-cancel]").onclick = () => { S.openSignup = null; renderShifts(); };
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nome = inp.value.trim().replace(/\s+/g, " ");
      if (!nome) { inp.focus(); return; }
      const { bid, sid } = S.openSignup;
      if (signupsFor(bid, sid).some((x) => x.nome.toLowerCase() === nome.toLowerCase())) { toast(`${nome} è già in questo turno`); return; }
      const btn = f.querySelector("[type=submit]"); btn.disabled = true;
      try { S.openSignup = null; await run(sb.from("signups").insert({ booking_id: bid, slot_id: sid, nome, user_id: null }), `${nome} è in turno`); }
      catch (x) { btn.disabled = false; toast(errText(x)); }
    });
  }
}
function shiftEvent(b) {
  const c = coverage(b);
  const slots = turni(b).map((t) => {
    const ppl = signupsFor(b.id, t.id), n = Number(t.posti) || 0;
    const meter = Array.from({ length: Math.max(n, ppl.length) }, (_, i) => `<i class="${i < Math.min(n, ppl.length) ? "on" : i >= n ? "extra" : ""}"></i>`).join("");
    const isOpen = S.openSignup && S.openSignup.bid === b.id && S.openSignup.sid === t.id;
    const amIn = ppl.some(isMine);
    const canRm = (x) => S.canWrite || isMine(x);
    const names = ppl.map((x) => `<span class="person${isMine(x) ? " me" : ""}${canRm(x) ? "" : " solo"}">${esc(x.nome)}${canRm(x) ? `<button type="button" data-rm="${esc(x.id)}" aria-label="Togli ${esc(x.nome)}">×</button>` : ""}</span>`).join("");
    let action = "";
    if (isOpen) action = `<form class="signup" novalidate><input aria-label="Nome del volontario" placeholder="Nome e cognome" maxlength="60"><button class="btn primary sm" type="submit">Conferma</button><button class="btn sm" type="button" data-cancel>Annulla</button></form>`;
    else if (b.data >= TODAY && (S.canWrite || !amIn)) {
      const full = ppl.length >= n;
      const label = S.canWrite ? (full ? "+ Riserva" : "+ Aggiungi nome") : (full ? "+ Mi segno come riserva" : "+ Mi segno");
      action = `<button class="btn sm${full ? "" : " primary"}" type="button" data-join="${esc(b.id)}|${esc(t.id)}">${label}</button>`;
    }
    const miss = n - ppl.length;
    return `<div class="slot">
      <div><div class="lbl">${esc(t.label)}</div><div class="tm">${esc(t.inizio)}–${esc(t.fine)}</div>
        <div class="meter" aria-hidden="true">${meter}</div>
        <div class="count ${miss > 0 ? "miss" : "full"}">${ppl.length}/${n} ${miss > 0 ? `· manca${miss > 1 ? "no" : ""} ${miss}` : "· completo"}</div></div>
      <div class="people">${names || (isOpen ? "" : `<span class="hint">Ancora nessuno</span>`)}${action}</div>
    </div>`;
  }).join("");
  return `<article class="panel shift-event">
    <header><div><h3>${esc(b.titolo)}</h3><div class="when">${esc(fmtDay(b.data))} · ${orario(b)}</div></div>
      <div class="btns"><span class="pill ${c.have >= c.need ? "saldato" : "acconto"}">${c.have >= c.need ? "Turni coperti" : `Mancano ${c.need - c.have}`}</span>
        <button class="btn sm" type="button" data-wa="${esc(b.id)}">Testo per WhatsApp</button>
        ${S.canWrite ? `<button class="btn sm" type="button" data-edit="${esc(b.id)}">Modifica turni</button>` : ""}</div></header>
    ${slots}
  </article>`;
}
function waText(b) {
  const lines = [`*Turni volontari · ${b.titolo}*`, `${fmtDay(b.data)}, ${orario(b).toLowerCase()}`, ""];
  for (const t of turni(b)) {
    const ppl = signupsFor(b.id, t.id), n = Number(t.posti) || 0, miss = n - ppl.length;
    lines.push(`▪️ *${t.label}* ${t.inizio}–${t.fine} (${ppl.length}/${n})`);
    lines.push(ppl.length ? "   " + ppl.map((x) => x.nome).join(", ") : "   nessuno ancora");
    if (miss > 0) lines.push(`   👉 servono ancora ${miss} ${miss > 1 ? "persone" : "persona"}`);
  }
  lines.push("", `Per segnarti: ${location.origin + location.pathname}#turni`);
  return lines.join("\n");
}
function openCopy(b) { openCopyText(waText(b)); }
// tel: se c'è, «Apri WhatsApp» apre direttamente la chat con quel numero
function openCopyText(text, tel = "") {
  S.waTel = String(tel).replace(/\D/g, "").replace(/^00/, "");
  if (/^3\d{8,9}$/.test(S.waTel)) S.waTel = "39" + S.waTel;
  $("#copy-text").value = text;
  $("#copy-status").textContent = "";
  updateWaLink();
  dlgC.showModal();
}
const updateWaLink = () => { $("#wa-open").href = `https://wa.me/${S.waTel || ""}?text=` + encodeURIComponent($("#copy-text").value); };
$("#copy-text").addEventListener("input", updateWaLink);
$("#copy-btn").onclick = () => {
  const ta = $("#copy-text");
  const fallback = () => { ta.focus(); ta.select(); $("#copy-status").textContent = "Testo selezionato: copialo con Copia del tuo dispositivo."; };
  try { navigator.clipboard.writeText(ta.value).then(() => { $("#copy-status").textContent = "Copiato. Ora incollalo nel gruppo WhatsApp."; }, fallback); }
  catch (e) { fallback(); }
};

/* ---------- cinema ---------- */
const GIORNI_PROVA = 7; // la prova va fatta almeno una settimana prima della prima proiezione
const SUPPORTI = { file: "File", dvd: "DVD", bluray: "Blu-ray", link: "Link" };
const ACQ = { da_procurare: "Da procurare", in_arrivo: "In arrivo", disponibile: "In sala" };
const showsOf = (f) => S.proiezioni.filter((p) => p.film_id === f.id).sort((a, b) => (a.data + a.ora).localeCompare(b.data + b.ora));
const nextShow = (f) => showsOf(f).find((p) => p.data >= TODAY);
function addDays(isoDate, n) { const d = parse(isoDate); d.setDate(d.getDate() + n); return iso(d); }
// stato di preparazione: ok (pronto), warn (da fare, c'è tempo), ko (in ritardo o problemi), none (nessuna proiezione futura)
function readiness(f) {
  const nx = nextShow(f);
  if (!nx) return f.prova_esito === "ok" ? { cls: "ok", text: "Provato", detail: "" } : { cls: "none", text: "Nessuna proiezione in programma", detail: "" };
  const scad = addDays(nx.data, -GIORNI_PROVA);
  const late = TODAY > scad;
  const quando = `entro ${fmtShort(scad)}`;
  if (f.acquisizione !== "disponibile") {
    return { cls: late ? "ko" : "warn", text: f.acquisizione === "in_arrivo" ? "Supporto in arrivo" : "Supporto da procurare", detail: late ? `doveva essere in sala e provato entro ${fmtShort(scad)}` : `da avere e provare ${quando}` };
  }
  if (f.prova_esito === "problemi") return { cls: "ko", text: "Prova con problemi", detail: f.prova_note || "da risolvere prima della proiezione" };
  if (f.prova_esito === "ok" && f.provato_il) {
    return f.provato_il <= scad
      ? { cls: "ok", text: "Pronto", detail: `provato il ${fmtShort(f.provato_il)}` }
      : { cls: "warn", text: "Pronto, provato tardi", detail: `provato il ${fmtShort(f.provato_il)}, oltre la settimana di anticipo` };
  }
  return { cls: late ? "ko" : "warn", text: late ? "Prova in ritardo" : "Da provare", detail: late ? `andava provato entro ${fmtShort(scad)}` : quando };
}
const filmsToFix = () => S.films.filter((f) => nextShow(f) && ["ko", "warn"].includes(readiness(f).cls) && readiness(f).text !== "Pronto, provato tardi").length;
const FILM_FILTERS = [
  ["prossimi", "In programma", (f) => !!nextShow(f)],
  ["dafare", "Da sistemare", (f) => !!nextShow(f) && ["ko", "warn"].includes(readiness(f).cls) && readiness(f).text !== "Pronto, provato tardi"],
  ["passati", "Già proiettati", (f) => !nextShow(f) && showsOf(f).length > 0],
  ["tutti", "Tutti", () => true],
];
const pillCls = { ok: "saldato", warn: "acconto", ko: "dapagare", none: "annullata" };
function renderCinema() {
  $("#btn-film").hidden = !S.canWrite;
  $("#btn-conviene").hidden = !S.canWrite;
  renderCoseFilm();
  $("#film-sync").textContent = S.sync.cinebot ? `Programmazione da Cinebot aggiornata ${ago(S.sync.cinebot)}` : "";
  $("#film-filters").innerHTML = FILM_FILTERS.map(([k, l, f]) => `<button type="button" data-f="${k}" aria-pressed="${S.filmFilter === k}">${l}<span class="c">${S.films.filter(f).length}</span></button>`).join("");
  $("#film-filters").querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { S.filmFilter = b.dataset.f; renderCinema(); }));
  const flt = FILM_FILTERS.find((x) => x[0] === S.filmFilter)[2];
  const list = S.films.filter(flt).sort((a, b) => {
    const na = nextShow(a), nb = nextShow(b);
    if (na && nb) return (na.data + na.ora).localeCompare(nb.data + nb.ora);
    if (na || nb) return na ? -1 : 1;
    const la = showsOf(a).pop(), lb = showsOf(b).pop();
    return ((lb && lb.data) || "").localeCompare((la && la.data) || "");
  });
  const el = $("#films");
  if (!list.length) {
    el.innerHTML = `<div class="empty">${S.films.length ? "Nessun film in questo elenco." : "Nessun film ancora. La programmazione arriva da Cinebot quando lo script Google è attivo" + (S.canWrite ? ", oppure aggiungi un film con «+ Aggiungi film»." : ".")}</div>`;
    return;
  }
  el.innerHTML = `<div class="film-grid">${list.map((f) => {
    const r = readiness(f), shows = showsOf(f), upcoming = shows.filter((p) => p.data >= TODAY);
    const visible = (upcoming.length ? upcoming : shows.slice(-3)).slice(0, 6);
    return `<button type="button" class="film" data-film="${esc(f.id)}">
      <div class="poster">${f.locandina_url ? `<img src="${esc(f.locandina_url)}" alt="Locandina di ${esc(f.titolo)}" loading="lazy" referrerpolicy="no-referrer">` : `<span class="ph">${esc(f.titolo)}</span>`}
        <div class="ready"><span class="pill ${pillCls[r.cls]}">${esc(r.text)}</span></div></div>
      <div class="body">
        <div class="t">${esc(f.titolo)}</div>
        <div class="shows">${visible.map((p) => `<span class="show${p.data < TODAY ? " past" : ""}">${esc(fmtShort(p.data))} · ${p.ora}</span>`).join("")}${upcoming.length > 6 ? `<span class="show">+${upcoming.length - 6}</span>` : ""}</div>
        ${(() => { const cs = c1OfFilm(f); return cs.length && S.canWrite ? `<div class="c1line">${cs.reduce((s, c) => s + c.spettatori, 0)} spettatori · ${money(cs.reduce((s, c) => s + c.lordo, 0))} (C1, ${cs.length} ${cs.length > 1 ? "proiezioni" : "proiezione"})</div>` : ""; })()}
        ${S.canWrite && upcoming[0] ? (() => { const st = stimaSpettatori(upcoming[0]); return st ? `<div class="stima">Stima per ${esc(fmtShort(upcoming[0].data))}: circa <b>${st.n}</b> spettatori <span title="${esc(st.base)}">ⓘ</span></div>` : ""; })() : ""}
        <div class="meta"><span>${f.supporto ? SUPPORTI[f.supporto] : "Supporto da decidere"} · ${ACQ[f.acquisizione]}</span>${r.detail ? `<span>${esc(r.detail)}</span>` : ""}</div>
      </div>
    </button>`;
  }).join("")}</div>`;
  el.querySelectorAll("[data-film]").forEach((b) => (b.onclick = () => openFilm(S.films.find((f) => f.id === b.dataset.film))));
  el.querySelectorAll(".poster img").forEach((img) => (img.onerror = () => { img.replaceWith(Object.assign(document.createElement("span"), { className: "ph", textContent: img.alt.replace(/^Locandina di /, "") })); }));
}

const dlgF = $("#dlg-film");
const F_FIELDS = ["titolo", "distributore", "supporto", "acquisizione", "disponibile_il", "dove", "provato_il", "prova_esito", "prova_note", "note"];
function openFilm(f) {
  if (!f && !S.canWrite) return;
  S.editingFilm = f ? f.id : null;
  const v = f || { titolo: "", distributore: "", locandina_url: "", supporto: "", acquisizione: "da_procurare", disponibile_il: "", dove: "", provato_il: "", prova_esito: "", prova_note: "", note: "" };
  $("#f-head").textContent = f ? f.titolo : "Aggiungi film";
  for (const k of F_FIELDS) $("#f-" + k).value = v[k] ?? "";
  $("#f-locandina").value = v.locandina_url || "";
  $("#f-poster").hidden = !v.locandina_url; if (v.locandina_url) { $("#f-poster").src = v.locandina_url; $("#f-poster").alt = "Locandina di " + v.titolo; }
  $("#f-cinebot").hidden = !v.cinebot_url; if (v.cinebot_url) $("#f-cinebot").href = v.cinebot_url;
  S.draftPr = f ? showsOf(f).map((p) => ({ ...p })) : [];
  const fromCinebot = !!(f && f.cinebot_id);
  $("#f-titolo").disabled = fromCinebot || !S.canWrite;
  $("#f-locandina").disabled = fromCinebot || !S.canWrite;
  $("#f-distributore").disabled = !S.canWrite;
  $("#f-pr-add").hidden = !S.canWrite;
  $("#f-pr-hint").textContent = fromCinebot ? "Gli orari di Cinebot si aggiornano da soli" : "";
  $("#f-prova-hint").textContent = `Da fare almeno ${GIORNI_PROVA} giorni prima della proiezione`;
  $("#f-error").innerHTML = "";
  renderDraftPr();
  renderDeleteArea("#f-delete-area", !!f && S.canWrite, async () => { await run(sb.from("films").delete().eq("id", f.id), "Film eliminato"); dlgF.close(); });
  updateReadiness();
  dlgF.showModal();
}
function renderDraftPr() {
  const list = [...S.draftPr].filter((p) => !p._del).sort((a, b) => (a.data + a.ora).localeCompare(b.data + b.ora));
  $("#f-proiezioni").innerHTML = list.length
    ? list.map((p) => `<span class="show src-${p.fonte || "manuale"}${p.data < TODAY ? " past" : ""}">${esc(fmtShort(p.data))} · ${p.ora}${S.canWrite && p.fonte !== "cinebot" ? `<button type="button" data-rmpr="${esc(p.id || p._tmp)}" aria-label="Togli proiezione">×</button>` : ""}</span>`).join("")
    : `<span class="hint">Nessuna proiezione inserita.</span>`;
  $("#f-proiezioni").querySelectorAll("[data-rmpr]").forEach((b) => (b.onclick = () => {
    const p = S.draftPr.find((x) => (x.id || x._tmp) === b.dataset.rmpr);
    if (p.id) p._del = true; else S.draftPr.splice(S.draftPr.indexOf(p), 1);
    renderDraftPr(); updateReadiness();
  }));
}
$("#f-pr-btn").onclick = () => {
  const d = $("#f-pr-data").value, o = $("#f-pr-ora").value;
  if (!d || !o) { toast("Scegli data e ora della proiezione"); return; }
  S.draftPr.push({ _tmp: uidv(), data: d, ora: o, fonte: "manuale" });
  renderDraftPr(); updateReadiness();
};
function updateReadiness() {
  const f = { id: "__draft", acquisizione: $("#f-acquisizione").value, provato_il: $("#f-provato_il").value, prova_esito: $("#f-prova_esito").value, prova_note: $("#f-prova_note").value };
  const saved = S.proiezioni; S.proiezioni = S.draftPr.filter((p) => !p._del).map((p) => ({ ...p, film_id: "__draft" }));
  const r = readiness(f);
  S.proiezioni = saved;
  $("#f-readiness").innerHTML = `<div class="readiness ${r.cls}"><span>${esc(r.text)}</span>${r.detail ? `<small>${esc(r.detail)}</small>` : ""}</div>`;
}
["#f-acquisizione", "#f-provato_il", "#f-prova_esito", "#f-prova_note"].forEach((id) => $(id).addEventListener("input", updateReadiness));
$("#f-acquisizione").addEventListener("change", () => { if ($("#f-acquisizione").value === "disponibile" && !$("#f-disponibile_il").value) $("#f-disponibile_il").value = TODAY; });
$("#f-prova-oggi").onclick = () => {
  $("#f-provato_il").value = TODAY; $("#f-prova_esito").value = "ok";
  if ($("#f-acquisizione").value !== "disponibile") { $("#f-acquisizione").value = "disponibile"; if (!$("#f-disponibile_il").value) $("#f-disponibile_il").value = TODAY; }
  updateReadiness();
};
$("#f-locandina").addEventListener("change", () => { const u = $("#f-locandina").value.trim(); $("#f-poster").hidden = !u; if (u) $("#f-poster").src = u; });
$("#btn-film").onclick = () => openFilm(null);
$("#film-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const g = (k) => $("#f-" + k).value.trim();
  const rec = {};
  for (const k of F_FIELDS) rec[k] = g(k) || (["supporto", "prova_esito", "disponibile_il", "provato_il"].includes(k) ? null : "");
  rec.locandina_url = g("locandina");
  rec.aggiornato = new Date().toISOString();
  const prev = S.films.find((f) => f.id === S.editingFilm);
  if (rec.prova_esito && prev?.prova_esito !== rec.prova_esito) rec.provato_da = S.me.id;
  if (prev && prev.cinebot_id) { delete rec.titolo; delete rec.locandina_url; }
  if (!S.canWrite) delete rec.distributore;
  if (!prev && !rec.titolo) { $("#f-error").innerHTML = `<div class="warn">Scrivi il titolo del film.</div>`; return; }
  const btn = $("#f-submit"); btn.disabled = true;
  try {
    let id = prev && prev.id;
    if (prev) { const { error } = await sb.from("films").update(rec).eq("id", id); if (error) throw error; }
    else { const { data, error } = await sb.from("films").insert(rec).select("id").single(); if (error) throw error; id = data.id; }
    if (S.canWrite) {
      const add = S.draftPr.filter((p) => !p.id && !p._del).map((p) => ({ film_id: id, data: p.data, ora: p.ora, fonte: "manuale" }));
      const del = S.draftPr.filter((p) => p.id && p._del).map((p) => p.id);
      if (add.length) { const { error } = await sb.from("proiezioni").insert(add); if (error) throw error; }
      if (del.length) { const { error } = await sb.from("proiezioni").delete().in("id", del); if (error) throw error; }
    }
    toast(prev ? "Film aggiornato" : "Film aggiunto");
    await loadAll();
    dlgF.close();
  } catch (x) { $("#f-error").innerHTML = `<div class="warn">${esc(errText(x))}</div>`; }
  finally { btn.disabled = false; }
});

/* ---------- incassi C1 ---------- */
const normT = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
const c1OfFilm = (f) => S.c1.filter((c) => c.film_id === f.id || (!c.film_id && normT(c.titolo) === normT(f.titolo)));
const filmOfC1 = (c) => S.films.find((f) => f.id === c.film_id) || S.films.find((f) => normT(f.titolo) === normT(c.titolo));
// confronto tra i C1 e la Cassa di una stessa data (la cassa somma tutte le proiezioni della serata)
function c1CheckDay(day) {
  const cs = S.c1.filter((c) => c.data === day), ks = S.cassa.filter((k) => k.data === day);
  if (!cs.length || !ks.length) return { stato: !cs.length ? "noc1" : "nocassa" };
  const c1 = r2(cs.reduce((s, c) => s + c.lordo, 0)), cassa = r2(ks.reduce((s, k) => s + totBiglietti(k), 0));
  return { stato: Math.abs(c1 - cassa) < 0.005 ? "ok" : "diff", c1, cassa, diff: r2(cassa - c1) };
}
function c1Pill(r) {
  if (r.stato === "noc1") return '<span class="hint">C1 non ancora arrivato</span>';
  if (r.stato === "nocassa") return '<span class="pill annullata">Nessuna cassa</span>';
  if (r.stato === "ok") return '<span class="pill saldato">Cassa = C1</span>';
  return `<span class="pill dapagare" title="Cassa ${money(r.cassa)} · C1 ${money(r.c1)}">Cassa ${r.diff > 0 ? "+" : "−"}${money(Math.abs(r.diff))}</span>`;
}
function renderC1() {
  const years = new Set([new Date().getFullYear(), S.c1Year]);
  S.c1.forEach((c) => years.add(+c.data.slice(0, 4)));
  $("#c1-years").innerHTML = [...years].sort().map((y) => `<button type="button" data-y="${y}" aria-pressed="${S.c1Year === y}">${y}</button>`).join("");
  $("#c1-years").querySelectorAll("[data-y]").forEach((b) => (b.onclick = () => { S.c1Year = +b.dataset.y; renderC1(); }));
  $("#c1-mode").innerHTML = [["serate", "Per proiezione"], ["film", "Per film"], ["mesi", "Per mese"]].map(([k, l]) => `<button type="button" data-m="${k}" aria-pressed="${S.c1Mode === k}">${l}</button>`).join("");
  $("#c1-mode").querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { S.c1Mode = b.dataset.m; renderC1(); }));
  $("#c1-sync").textContent = S.sync.c1 ? `C1 letti ${ago(S.sync.c1)}` : "I C1 arrivano qui quando lo script Google ha «+c1»";
  const list = S.c1.filter((c) => c.data.startsWith(String(S.c1Year))).sort((a, b) => (b.data + b.ora).localeCompare(a.data + a.ora));
  const sum = (arr, k) => arr.reduce((s, c) => s + (c[k] || 0), 0);
  const spett = sum(list, "spettatori"), lordo = sum(list, "lordo");
  $("#c1-kpis").innerHTML = `
    <div class="kpi"><span class="eyebrow">Spettatori ${S.c1Year}</span><b>${spett.toLocaleString("it-IT")}</b><small>${sum(list, "paganti")} paganti · ${sum(list, "omaggi")} omaggi</small></div>
    <div class="kpi"><span class="eyebrow">Incasso lordo</span><b>${money(lordo)}</b><small>da ${list.length} ${list.length === 1 ? "proiezione" : "proiezioni"}</small></div>
    <div class="kpi"><span class="eyebrow">Netto IVA</span><b>${money(sum(list, "imponibile_iva"))}</b><small>IVA ${money(sum(list, "iva"))}</small></div>
    <div class="kpi"><span class="eyebrow">Media a proiezione</span><b>${list.length ? Math.round(spett / list.length) : 0}</b><small>spettatori · ${money(list.length ? r2(lordo / list.length) : 0)}</small></div>`;
  const el = $("#c1-list");
  if (!list.length) { el.innerHTML = `<div class="empty">Nessun C1 per il ${S.c1Year}. Lo script Google li legge dalla cartella Drive dei C1 e dalle email di Cinebot.</div>`; return; }
  const posterOf = (c) => { const f = filmOfC1(c); return f && f.locandina_url ? `<img class="thumb" src="${esc(f.locandina_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""; };
  if (S.c1Mode === "film") {
    const groups = new Map();
    list.forEach((c) => { const k = normT(c.titolo); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
    const rows = [...groups.values()].map((cs) => ({ cs, titolo: cs[0].titolo, sp: sum(cs, "spettatori"), lo: sum(cs, "lordo"), net: sum(cs, "imponibile_iva"), last: cs[0].data })).sort((a, b) => b.lo - a.lo);
    el.innerHTML = `<table><thead><tr><th>Film</th><th class="n">Proiezioni</th><th class="n">Spettatori</th><th class="n">Media</th><th class="n">Lordo</th><th class="n">Netto IVA</th><th>Ultima</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${posterOf(r.cs[0])}${esc(r.titolo)}</td><td class="n">${r.cs.length}</td><td class="n">${r.sp}</td><td class="n">${Math.round(r.sp / r.cs.length)}</td><td class="n"><b>${money(r.lo)}</b></td><td class="n">${money(r.net)}</td><td>${esc(fmtShort(r.last))}</td></tr>`).join("")}</tbody></table>`;
    return;
  }
  if (S.c1Mode === "mesi") {
    const rows = MESI.map((m, i) => { const k = `${S.c1Year}-${pad(i + 1)}`; const cs = list.filter((c) => c.data.startsWith(k)); return { m: parse(k + "-01").toLocaleDateString("it-IT", { month: "long" }), cs }; }).filter((r) => r.cs.length);
    el.innerHTML = `<table><thead><tr><th>Mese</th><th class="n">Proiezioni</th><th class="n">Spettatori</th><th class="n">Lordo</th><th class="n">Netto IVA</th><th class="n">IVA</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="cap">${esc(r.m)}</td><td class="n">${r.cs.length}</td><td class="n">${sum(r.cs, "spettatori")}</td><td class="n"><b>${money(sum(r.cs, "lordo"))}</b></td><td class="n">${money(sum(r.cs, "imponibile_iva"))}</td><td class="n">${money(sum(r.cs, "iva"))}</td></tr>`).join("")}
      <tr><th>Totale</th><th class="n">${list.length}</th><th class="n">${spett}</th><th class="n">${money(lordo)}</th><th class="n">${money(sum(list, "imponibile_iva"))}</th><th class="n">${money(sum(list, "iva"))}</th></tr></tbody></table>`;
    return;
  }
  el.innerHTML = `<table><thead><tr><th>Data</th><th>Film</th><th class="n">Spettatori</th><th class="n">Lordo</th><th class="n">Netto IVA</th><th>Confronto con la Cassa</th></tr></thead><tbody>
    ${list.map((c) => `<tr class="click" data-c1="${esc(c.id)}"><td style="white-space:nowrap">${esc(fmtShort(c.data))} · ${c.ora}</td><td>${posterOf(c)}${esc(c.titolo)}</td><td class="n">${c.spettatori}${c.omaggi ? ` <span class="hint">(${c.omaggi} om.)</span>` : ""}</td><td class="n"><b>${money(c.lordo)}</b></td><td class="n">${money(c.imponibile_iva)}</td><td>${c1Pill(c1CheckDay(c.data))}</td></tr>
      ${S.c1Open === c.id ? `<tr class="c1-row-detail"><td colspan="6"><div class="righe">${c.righe.map((r) => `<span>${esc(r.descrizione || r.codice)} ${r.prezzo ? money(r.prezzo) : "omaggio"}: <b>${r.n}</b>${r.lordo ? ` = ${money(r.lordo)}` : ""}${r.iva_preassolta ? " (abbonamento)" : ""}</span>`).join("")}</div>
        <div class="hint" style="margin-top:6px">${esc([c.autore && "Regia: " + c.autore, c.nazionalita, c.file_nome && "da " + c.file_nome].filter(Boolean).join(" · "))}</div></td></tr>` : ""}`).join("")}</tbody></table>`;
  el.querySelectorAll("[data-c1]").forEach((r) => (r.onclick = () => { S.c1Open = S.c1Open === r.dataset.c1 ? null : r.dataset.c1; renderC1(); }));
}

/* ---------- statistiche (dai C1) ---------- */
const CAPIENZA_SALA = 322;
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const ORDINE_GIORNI = [1, 2, 3, 4, 5, 6, 0];
const capienza = (c) => Math.max(0, ...(c.righe || []).map((r) => r.capienza || 0)) || CAPIENZA_SALA;
const fascia = (ora) => (ora < "18:00" ? "pomeriggio" : "sera");
const giorno = (c) => parse(c.data).getDay();
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pct = (x) => Math.round(x * 100) + "%";
const fill = (c) => c.spettatori / capienza(c);
// colore della cella: un solo tono, più scuro = più pubblico
const shade = (t) => `color-mix(in oklab, var(--accent) ${Math.round(12 + t * 78)}%, var(--surface))`;
const inkOn = (t) => (t > 0.55 ? "var(--accent-ink)" : "var(--ink)");

function c1Periodo() {
  const all = S.c1.filter((c) => c.spettatori > 0 || c.lordo > 0);
  if (S.stPeriod === "tutto") return { list: all, prev: [], label: "da sempre" };
  if (S.stPeriod === "12m") {
    const da = addDays(TODAY, -365), daPrev = addDays(TODAY, -730);
    return { list: all.filter((c) => c.data > da && c.data <= TODAY), prev: all.filter((c) => c.data > daPrev && c.data <= da), label: "ultimi 12 mesi" };
  }
  const y = String(S.stPeriod);
  return { list: all.filter((c) => c.data.startsWith(y)), prev: all.filter((c) => c.data.startsWith(String(+y - 1))), label: y };
}
// stima per una proiezione futura: media dei C1 dello stesso film, poi dello stesso giorno e fascia, poi generale
function stimaSpettatori(p) {
  const passati = S.c1.filter((c) => c.data < TODAY && c.spettatori > 0);
  if (passati.length < 3) return null;
  const f = S.films.find((x) => x.id === p.film_id);
  const g = parse(p.data).getDay(), fa = fascia(p.ora);
  const stessoSlot = passati.filter((c) => giorno(c) === g && fascia(c.ora) === fa);
  const stessaFascia = passati.filter((c) => fascia(c.ora) === fa);
  const base = stessoSlot.length >= 2 ? stessoSlot : stessaFascia.length >= 3 ? stessaFascia : passati;
  let n = mean(base.map((c) => c.spettatori));
  const filmPrec = f ? c1OfFilm(f).filter((c) => c.data < TODAY) : [];
  if (filmPrec.length) n = 0.5 * n + 0.5 * mean(filmPrec.map((c) => c.spettatori));
  const descr = (stessoSlot.length >= 2 ? `media di ${stessoSlot.length} proiezioni di ${GIORNI[g]} ${fa}` : stessaFascia.length >= 3 ? `media di ${stessaFascia.length} proiezioni di ${fa}` : `media di ${passati.length} proiezioni`) + (filmPrec.length ? `, corretta con le ${filmPrec.length} proiezioni già fatte di questo film` : "");
  return { n: Math.round(n), base: "Stima dai C1: " + descr };
}

function barChart(el, labels, series, fmtV) {
  const W = 720, H = 230, L = 44, R = 8, T = 12, B = 26;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const gw = (W - L - R) / labels.length, nb = series.length, bw = Math.min(18, (gw - 8) / nb - 2);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.name).join(" e "))} per mese">`;
  [0, .5, 1].map((t) => t * max).forEach((t) => { svg += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"${t ? ' stroke-dasharray="2 3"' : ""}/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${esc(fmtV(t))}</text>`; });
  labels.forEach((lb, i) => {
    const x0 = L + gw * i + (gw - nb * (bw + 2)) / 2;
    series.forEach((s, j) => {
      const v = s.values[i]; if (!(v > 0)) return;
      const top = y(v), x = x0 + j * (bw + 2), r = Math.min(4, y(0) - top, bw / 2);
      svg += `<path fill="${s.color}" d="M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y(0)} Z"/>`;
    });
    svg += `<text x="${L + gw * i + gw / 2}" y="${H - 8}" text-anchor="middle">${esc(lb)}</text><rect class="hit" data-i="${i}" x="${L + gw * i}" y="${T}" width="${gw}" height="${H - T - B}" fill="transparent"/>`;
  });
  el.innerHTML = svg + `</svg><div class="tip" hidden></div>`;
  const tip = el.querySelector(".tip"), svgEl = el.querySelector("svg");
  el.querySelectorAll(".hit").forEach((h) => {
    const show = () => {
      const i = +h.dataset.i, rect = svgEl.getBoundingClientRect(), k = rect.width / W;
      tip.innerHTML = `<b>${esc(labels[i])}</b>` + series.map((s) => `<br><i style="background:${s.color}"></i>${esc(s.name)}: ${esc(fmtV(s.values[i] || 0))}${s.extra ? " · " + esc(s.extra[i] || "") : ""}`).join("");
      tip.style.left = Math.max(80, Math.min(rect.width - 80, (L + gw * i + gw / 2) * k)) + "px";
      tip.style.top = (y(Math.max(...series.map((s) => s.values[i] || 0))) * k - 8) + "px";
      tip.hidden = false; h.setAttribute("fill", "var(--sunk)"); h.setAttribute("fill-opacity", ".35");
    };
    h.addEventListener("mouseenter", show); h.addEventListener("click", show);
    h.addEventListener("mouseleave", () => { tip.hidden = true; h.setAttribute("fill", "transparent"); });
  });
}

function renderStats() {
  const years = [...new Set(S.c1.map((c) => +c.data.slice(0, 4)))].sort();
  const opts = [["12m", "Ultimi 12 mesi"], ...years.map((y) => [String(y), String(y)]), ["tutto", "Tutto"]];
  $("#st-period").innerHTML = opts.map(([k, l]) => `<button type="button" data-p="${k}" aria-pressed="${String(S.stPeriod) === k}">${l}</button>`).join("");
  $("#st-period").querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { S.stPeriod = b.dataset.p; renderStats(); }));
  const { list, prev, label } = c1Periodo();
  $("#st-hint").textContent = `Calcolate dai C1 · ${list.length} proiezioni · ${label}`;
  const el = $("#st-body");
  if (list.length < 2) { el.innerHTML = `<div class="empty">Servono almeno due C1 nel periodo scelto. Le statistiche si riempiono da sole man mano che lo script legge i C1.</div>`; return; }

  const spett = list.reduce((s, c) => s + c.spettatori, 0), lordo = list.reduce((s, c) => s + c.lordo, 0);
  const paganti = list.reduce((s, c) => s + c.paganti, 0), omaggi = list.reduce((s, c) => s + c.omaggi, 0);
  const media = spett / list.length, riemp = mean(list.map(fill));
  const prevMedia = prev.length ? mean(prev.map((c) => c.spettatori)) : null;
  const delta = prevMedia ? (media - prevMedia) / prevMedia : null;

  // quando: giorno × fascia
  const cell = (g, fa) => list.filter((c) => giorno(c) === g && fascia(c.ora) === fa);
  const cells = ORDINE_GIORNI.flatMap((g) => ["pomeriggio", "sera"].map((fa) => ({ g, fa, cs: cell(g, fa) }))).filter((x) => x.cs.length);
  cells.forEach((x) => (x.avg = mean(x.cs.map((c) => c.spettatori))));
  const maxAvg = Math.max(1, ...cells.map((x) => x.avg));
  // per le frasi di sintesi servono abbastanza proiezioni, altrimenti un caso isolato sembra una tendenza
  const solide = cells.filter((x) => x.cs.length >= 3);
  const best = [...(solide.length ? solide : cells)].sort((a, b) => b.avg - a.avg)[0];
  const record = [...list].sort((a, b) => b.spettatori - a.spettatori)[0];
  const pom = list.filter((c) => fascia(c.ora) === "pomeriggio"), ser = list.filter((c) => fascia(c.ora) === "sera");

  // film
  const byFilm = new Map();
  list.forEach((c) => { const k = normT(c.titolo); if (!byFilm.has(k)) byFilm.set(k, { titolo: c.titolo, cs: [] }); byFilm.get(k).cs.push(c); });
  const films = [...byFilm.values()].map((f) => ({ ...f, sp: f.cs.reduce((s, c) => s + c.spettatori, 0), lo: f.cs.reduce((s, c) => s + c.lordo, 0), media: mean(f.cs.map((c) => c.spettatori)) })).sort((a, b) => b.sp - a.sp);
  const topMedia = [...(films.some((f) => f.cs.length >= 2) ? films.filter((f) => f.cs.length >= 2) : films)].sort((a, b) => b.media - a.media)[0];

  // biglietti
  const tipo = (r) => (r.iva_preassolta ? "Abbonamenti" : r.prezzo === 0 || /^O/.test(r.codice) ? "Omaggi" : /^I1/.test(r.codice) || /intero/i.test(r.descrizione) ? "Interi" : /stud/i.test(r.descrizione) || r.codice === "I2" ? "Studenti" : "Ridotti");
  const mix = new Map();
  list.forEach((c) => (c.righe || []).forEach((r) => { const t = tipo(r); const m = mix.get(t) || { n: 0, euro: 0 }; m.n += r.n; m.euro += r.lordo; mix.set(t, m); }));
  const mixTot = [...mix.values()].reduce((s, m) => s + m.n, 0) || 1;

  // mesi
  const meseKey = (c) => c.data.slice(0, 7);
  const mesi = [...new Set(list.map(meseKey))].sort();
  const mesiLabel = mesi.map((k) => parse(k + "-01").toLocaleDateString("it-IT", { month: "short", year: mesi.length > 12 || S.stPeriod === "12m" ? "2-digit" : undefined }).replace(".", ""));
  const sumBy = (arr, k, f) => arr.filter((c) => meseKey(c) === k).reduce((s, c) => s + f(c), 0);
  const prevSameMonth = (k) => { const [yy, mm] = k.split("-"); return prev.filter((c) => c.data.startsWith(`${+yy - 1}-${mm}`)).reduce((s, c) => s + c.spettatori, 0); };

  const fmtD = (c) => `${fmtShort(c.data)} ${c.ora}`;
  const insights = [
    best && `<div class="insight"><span class="k">Il momento migliore</span>Il <b>${GIORNI[best.g]} ${best.fa}</b> arrivano in media <b>${Math.round(best.avg)}</b> spettatori${media ? `, ${best.avg >= media * 1.15 ? `il ${pct(best.avg / media - 1)} in più` : "in linea con"} la media` : ""} (${best.cs.length} proiezioni).</div>`,
    pom.length && ser.length && `<div class="insight"><span class="k">Pomeriggio o sera</span>Di pomeriggio <b>${Math.round(mean(pom.map((c) => c.spettatori)))}</b> spettatori a proiezione, di sera <b>${Math.round(mean(ser.map((c) => c.spettatori)))}</b>.</div>`,
    record && `<div class="insight"><span class="k">Record</span><b>${esc(record.titolo)}</b> il ${esc(fmtD(record))}: <b>${record.spettatori}</b> spettatori, sala piena al <b>${pct(fill(record))}</b>.</div>`,
    topMedia && films.length > 1 && `<div class="insight"><span class="k">Il film che ha reso di più</span><b>${esc(topMedia.titolo)}</b> con <b>${Math.round(topMedia.media)}</b> spettatori a proiezione${topMedia.cs.length > 1 ? ` su ${topMedia.cs.length} proiezioni` : ""}.</div>`,
    delta !== null && `<div class="insight"><span class="k">Rispetto al periodo prima</span>Media a proiezione <b>${delta >= 0 ? "+" : "−"}${pct(Math.abs(delta))}</b>: da ${Math.round(prevMedia)} a ${Math.round(media)} spettatori.</div>`,
  ].filter(Boolean).slice(0, 4).join("");

  el.innerHTML = `
    <section class="kpis" aria-label="In sintesi">
      <div class="kpi"><span class="eyebrow">Spettatori</span><b>${spett.toLocaleString("it-IT")}</b><small>${Math.round(media)} a proiezione</small></div>
      <div class="kpi"><span class="eyebrow">Riempimento medio</span><b>${pct(riemp)}</b><small>della sala (${capienza(list[0])} posti)</small></div>
      <div class="kpi"><span class="eyebrow">Prezzo medio pagato</span><b>${money(paganti ? r2(lordo / paganti) : 0)}</b><small>${money(lordo)} da ${paganti} paganti</small></div>
      <div class="kpi"><span class="eyebrow">Omaggi</span><b>${pct(omaggi / (spett || 1))}</b><small>${omaggi} ingressi gratuiti</small></div>
    </section>
    <div class="insights">${insights}</div>
    <div class="panel"><h2>Spettatori mese per mese</h2><span class="hint">${prev.length ? "Barre scure: periodo scelto · barre chiare: stesso mese dell'anno prima" : "Tocca una barra per i dettagli"}</span>
      ${prev.length ? `<div class="series-legend"><span><i class="sw" style="background:var(--accent)"></i>Periodo scelto</span><span><i class="sw" style="background:color-mix(in oklab, var(--accent) 35%, var(--surface))"></i>Anno prima</span></div>` : ""}
      <div class="chart-wrap" id="st-chart"></div></div>
    <div class="st-grid">
      <div class="panel"><h2>Classifica dei film</h2><span class="hint">Spettatori totali · media a proiezione · riempimento</span>
        <div class="hbars">${films.slice(0, 10).map((f) => `<div class="hbar"><span class="nm" title="${esc(f.titolo)}">${esc(f.titolo)}</span><span class="v">${f.sp} · ${Math.round(f.media)}/pr. · ${pct(mean(f.cs.map(fill)))}</span><div class="track"><div class="fill" style="width:${(f.sp / films[0].sp) * 100}%"></div></div></div>`).join("")}</div>
        ${films.length > 10 ? `<div class="hint" style="margin-top:8px">e altri ${films.length - 10} titoli</div>` : ""}</div>
      <div class="stack">
        <div class="panel"><h2>Quando viene il pubblico</h2><span class="hint">Spettatori medi per giorno e fascia oraria</span>
          <div class="heat"><span></span><span class="h">Pomeriggio</span><span class="h">Sera</span>
            ${ORDINE_GIORNI.map((g) => `<span class="d">${GIORNI[g].slice(0, 3)}</span>${["pomeriggio", "sera"].map((fa) => { const x = cells.find((c) => c.g === g && c.fa === fa); if (!x) return `<div class="c empty"><small>—</small></div>`; const t = x.avg / maxAvg; return `<div class="c" style="background:${shade(t)};color:${inkOn(t)}" title="${esc(GIORNI[g])} ${fa}: ${x.cs.length} proiezioni"><b>${Math.round(x.avg)}</b><small>${x.cs.length} pr.</small></div>`; }).join("")}`).join("")}
          </div></div>
        <div class="panel"><h2>Tipi di biglietto</h2><span class="hint">Quota sugli ingressi e incasso</span>
          <div class="hbars">${[...mix.entries()].sort((a, b) => b[1].n - a[1].n).map(([t, m]) => `<div class="hbar"><span class="nm">${t}</span><span class="v">${pct(m.n / mixTot)} · ${m.n} · ${money(r2(m.euro))}</span><div class="track"><div class="fill" style="width:${(m.n / mixTot) * 100}%"></div></div></div>`).join("")}</div></div>
      </div>
    </div>`;
  barChart($("#st-chart"), mesiLabel, [
    { name: "Spettatori", color: "var(--accent)", values: mesi.map((k) => sumBy(list, k, (c) => c.spettatori)), extra: mesi.map((k) => `${list.filter((c) => meseKey(c) === k).length} pr. · ${money(sumBy(list, k, (c) => c.lordo))}`) },
    ...(prev.length ? [{ name: "Anno prima", color: "color-mix(in oklab, var(--accent) 35%, var(--surface))", values: mesi.map(prevSameMonth) }] : []),
  ], (v) => Math.round(v).toLocaleString("it-IT"));
  // consigli per la programmazione (solo cinema) e rassegne a confronto
  const cin = list.filter((c) => !c.tipo_evento || /cinema|film|proiez/i.test(c.tipo_evento));
  const { out } = cin.length >= 6 ? consigliProgrammazione(cin) : { out: [] };
  el.insertAdjacentHTML("beforeend", (out.length ? `<div class="panel" style="margin-top:14px"><h2>Consigli per la programmazione</h2><span class="hint">Dai C1 del cinema nel periodo scelto${S.isAdmin ? " e dalla prima nota" : ""}</span><ul class="consigli">${out.map((x) => `<li>${x}</li>`).join("")}</ul>${S.canWrite ? `<div class="actions"><button class="btn sm" type="button" id="st-conviene">Conviene prendere un film?</button></div>` : ""}</div>` : "") + renderRassegne(list));
  if ($("#st-conviene")) $("#st-conviene").onclick = apriConviene;
}

/* ---------- bilancio (dalla prima nota) ---------- */
// settori: codici < 100 sono la struttura (affitti, donazioni, costi fissi), da 100 in su le attività
const isAttivita = (r) => (r.cod_settore || 0) >= 100;
const isCinema = (r) => /cine|film/i.test(r.settore);
const sommaE = (a) => r2(a.reduce((s, r) => s + r.entrate, 0));
const sommaU = (a) => r2(a.reduce((s, r) => s + r.uscite, 0));
const raggruppa = (a, k) => { const m = new Map(); a.forEach((r) => { const key = typeof k === "function" ? k(r) : r[k]; if (!m.has(key)) m.set(key, []); m.get(key).push(r); }); return m; };

function lineChart(el, labels, values, fmtV) {
  const W = 720, H = 200, L = 64, R = 12, T = 14, B = 26;
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const min = lo < 0 ? -niceMax(-lo) : 0, max = hi > 0 ? niceMax(hi) : lo < 0 ? 0 : 1;
  const y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  const x = (i) => L + ((W - L - R) * (i + 0.5)) / labels.length;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo cumulato mese per mese">`;
  [min, (min + max) / 2, max].forEach((t) => { svg += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"${t ? ' stroke-dasharray="2 3"' : ""}/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${esc(fmtV(t))}</text>`; });
  svg += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)"/>`;
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  svg += `<polygon points="${x(0)},${y(0)} ${pts} ${x(values.length - 1)},${y(0)}" fill="var(--accent)" fill-opacity=".12"/>`;
  svg += `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`;
  values.forEach((v, i) => { svg += `<circle cx="${x(i)}" cy="${y(v)}" r="${i === values.length - 1 ? 5 : 3.5}" fill="${v < 0 ? "var(--due-fg)" : "var(--accent)"}" stroke="var(--surface)" stroke-width="2"/><text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(labels[i])}</text><rect class="hit" data-i="${i}" x="${x(i) - (W - L - R) / labels.length / 2}" y="${T}" width="${(W - L - R) / labels.length}" height="${H - T - B}" fill="transparent"/>`; });
  el.innerHTML = svg + `</svg><div class="tip" hidden></div>`;
  const tip = el.querySelector(".tip"), svgEl = el.querySelector("svg");
  el.querySelectorAll(".hit").forEach((h) => {
    const show = () => { const i = +h.dataset.i, k = svgEl.getBoundingClientRect().width / W; tip.innerHTML = `<b>${esc(labels[i])}</b><br>Saldo cumulato: ${esc(fmtV(values[i]))}`; tip.style.left = Math.max(80, Math.min(svgEl.getBoundingClientRect().width - 80, x(i) * k)) + "px"; tip.style.top = (y(values[i]) * k - 10) + "px"; tip.hidden = false; };
    h.addEventListener("mouseenter", show); h.addEventListener("click", show); h.addEventListener("mouseleave", () => (tip.hidden = true));
  });
}

function renderBilancio() {
  const years = [...new Set([...S.primaNota.map((r) => +r.data.slice(0, 4)), new Date().getFullYear()])].sort();
  $("#pn-years").innerHTML = years.map((y) => `<button type="button" data-y="${y}" aria-pressed="${S.pnYear === y}">${y}</button>`).join("");
  $("#pn-years").querySelectorAll("[data-y]").forEach((b) => (b.onclick = () => { S.pnYear = +b.dataset.y; renderBilancio(); }));
  $("#pn-comp").innerHTML = [["competenza", `Solo competenza ${S.pnYear}`], ["tutti", "Tutti i movimenti"]].map(([k, l]) => `<button type="button" data-c="${k}" aria-pressed="${S.pnComp === k}">${l}</button>`).join("");
  $("#pn-comp").querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { S.pnComp = b.dataset.c; renderBilancio(); }));
  $("#pn-hint").textContent = S.sync.primaNota ? `Dalla prima nota «${S.sync.primaNotaFile || ""}», letta ${ago(S.sync.primaNota)}. I dati si cambiano nel file Excel: l'app si aggiorna da sola.` : "";
  const el = $("#pn-body");
  const Y = String(S.pnYear);
  const all = S.primaNota.filter((r) => r.data.startsWith(Y));
  const list = S.pnComp === "competenza" ? all.filter((r) => r.anno === S.pnYear) : all;
  if (!list.length) {
    el.innerHTML = S.primaNota.length ? `<div class="empty">Nessun movimento nel ${Y}.</div>` : diagnosiPrimaNota("bilancio");
    return;
  }
  const E = sommaE(list), U = sommaU(list), ris = r2(E - U);
  const previsti = list.filter((r) => /previst/i.test(r.tipo_movimento));
  const prevU = sommaU(previsti);
  const anniPrec = all.filter((r) => r.anno !== S.pnYear);
  const att = list.filter(isAttivita), strutt = list.filter((r) => !isAttivita(r) && r.uscite > 0 && r.entrate === 0);
  const affitti = list.filter((r) => !isAttivita(r) && /affitt/i.test(r.settore)), donaz = list.filter((r) => !isAttivita(r) && /donaz|liberal/i.test(r.settore + r.categoria));
  const margAtt = r2(sommaE(att) - sommaU(att)), costoStrutt = sommaU(strutt);
  const copertura = costoStrutt ? (margAtt + sommaE(affitti) + sommaE(donaz)) / costoStrutt : 0;
  const mesiTrascorsi = S.pnYear < new Date().getFullYear() ? 12 : new Date().getMonth() + 1;
  const struttMese = costoStrutt / mesiTrascorsi;
  // biglietteria e costi legati
  const bigl = list.filter((r) => /^E01$/i.test(r.cod_cat) || /bigliett/i.test(r.categoria) && r.entrate > 0);
  const cat = (re) => list.filter((r) => re.test(r.cod_cat + " " + r.categoria));
  const noleggio = sommaU(cat(/U01|noleggio/i).filter(isCinema)), incCinema = sommaE(bigl.filter(isCinema));
  const siae = sommaU(cat(/U02|siae/i)), comm = sommaU(cat(/U03|commission|pos/i)), Ebig = sommaE(bigl);
  const c1Anno = S.c1.filter((c) => c.data.startsWith(Y));
  const spett = c1Anno.reduce((s, c) => s + c.spettatori, 0);
  const margSpett = spett ? margAtt / spett : 0;
  // mesi
  const mesi = MESI.map((m, i) => { const k = `${Y}-${pad(i + 1)}`; const rs = list.filter((r) => r.data.startsWith(k)); return { m, k, e: sommaE(rs), u: sommaU(rs) }; });
  let cum = 0; const cumul = mesi.map((x) => (cum = r2(cum + x.e - x.u)));
  const ultimoMese = Math.max(0, ...mesi.map((x, i) => (x.e || x.u ? i : 0)));
  const minI = cumul.slice(0, ultimoMese + 1).reduce((bi, v, i, a) => (v < a[bi] ? i : bi), 0);
  // settori
  const sett = [...raggruppa(list, "settore").entries()].map(([nome, rs]) => ({ nome, e: sommaE(rs), u: sommaU(rs), m: r2(sommaE(rs) - sommaU(rs)), att: rs.some(isAttivita) })).sort((a, b) => b.m - a.m);
  const maxAbs = Math.max(1, ...sett.map((s) => Math.abs(s.m)));
  const migliore = sett.filter((s) => s.att)[0], peggiore = sett.filter((s) => s.att).slice(-1)[0];
  // categorie
  const catU = [...raggruppa(list.filter((r) => r.uscite), "categoria").entries()].map(([nome, rs]) => ({ nome, v: sommaU(rs) })).filter((c) => c.v > 0).sort((a, b) => b.v - a.v);
  const catE = [...raggruppa(list.filter((r) => r.entrate), "categoria").entries()].map(([nome, rs]) => ({ nome, v: sommaE(rs) })).sort((a, b) => b.v - a.v);
  // eventi
  const spettEvento = (ev) => { const ne = normT(ev); return c1Anno.filter((c) => { const nt = normT(c.titolo); return nt.length >= 4 && (ne.includes(nt) || nt.includes(ne)); }).reduce((s, c) => s + c.spettatori, 0); };
  const eventi = [...raggruppa(list.filter((r) => r.evento), "evento").entries()].map(([nome, rs]) => { const e = sommaE(rs), u = sommaU(rs), sp = spettEvento(nome); return { nome, settore: rs[0].settore, e, u, m: r2(e - u), sp, data: rs[0].data }; }).sort((a, b) => b.m - a.m);
  const inPerdita = eventi.filter((x) => x.m < 0);

  const ins = [
    costoStrutt > 0 && `<div class="insight"><span class="k">Tenere aperta la sala</span>La struttura (energia, assicurazioni, manutenzioni…) costa in media <b>${money(Math.round(struttMese))}</b> al mese. Attività, affitti e donazioni ne coprono il <b>${pct(copertura)}</b>.</div>`,
    migliore && `<div class="insight"><span class="k">Settori</span>Il settore che rende di più è <b>${esc(migliore.nome)}</b> (${money(migliore.m)})${peggiore && peggiore.m < 0 ? `; <b>${esc(peggiore.nome)}</b> è in perdita di ${money(Math.abs(peggiore.m))}` : ""}.</div>`,
    incCinema > 0 && `<div class="insight"><span class="k">Cinema</span>Il noleggio dei film pesa il <b>${pct(noleggio / incCinema)}</b> degli incassi del cinema; SIAE e commissioni POS e online il <b>${pct((siae + comm) / (Ebig || 1))}</b> della biglietteria.</div>`,
    spett > 0 && margSpett > 0 && struttMese > 0 && `<div class="insight"><span class="k">Punto di pareggio</span>Ogni spettatore lascia in media <b>${money(r2(margSpett))}</b> di margine: per coprire da soli i costi della struttura servirebbero circa <b>${Math.round(struttMese / margSpett)}</b> spettatori al mese (oggi ${Math.round(spett / mesiTrascorsi)}).</div>`,
    cumul[minI] < 0 && `<div class="insight"><span class="k">Liquidità</span>Il saldo cumulato tocca il minimo a <b>${esc(parse(mesi[minI].k + "-01").toLocaleDateString("it-IT", { month: "long" }))}</b> (${money(cumul[minI])}): conviene tenere una riserva per quel periodo.</div>`,
    inPerdita.length > 0 && `<div class="insight"><span class="k">Eventi in perdita</span><b>${inPerdita.length}</b> eventi su ${eventi.length} chiudono in negativo, per un totale di ${money(Math.abs(inPerdita.reduce((s, x) => s + x.m, 0)))}. Il peggiore: <b>${esc(inPerdita[inPerdita.length - 1].nome)}</b>.</div>`,
  ].filter(Boolean).join("");

  const settori = [...new Set(list.map((r) => r.settore))].sort();
  const q = S.pnQ.trim().toLowerCase();
  const movs = list.filter((r) => (!S.pnSett || r.settore === S.pnSett) && (!q || [r.descrizione, r.controparte, r.evento, r.categoria, r.note].join(" ").toLowerCase().includes(q))).sort((a, b) => b.data.localeCompare(a.data) || (b.n || 0) - (a.n || 0));
  const movVis = S.pnTutti ? movs : movs.slice(0, 60);

  el.innerHTML = `
    <section class="kpis" aria-label="In sintesi">
      <div class="kpi"><span class="eyebrow">Entrate</span><b>${money(E)}</b><small>${list.filter((r) => r.entrate).length} movimenti</small></div>
      <div class="kpi"><span class="eyebrow">Uscite</span><b>${money(U)}</b><small>${prevU ? `di cui ${money(prevU)} previste da pagare` : `${list.filter((r) => r.uscite).length} movimenti`}</small></div>
      <div class="kpi"><span class="eyebrow">Risultato ${S.pnComp === "competenza" ? "di gestione" : "di cassa"}</span><b class="${ris < 0 ? "neg" : ""}">${money(ris)}</b><small>${S.pnComp === "competenza" && anniPrec.length ? `escluse partite di anni precedenti (${money(r2(sommaE(anniPrec) - sommaU(anniPrec)))})` : "entrate − uscite"}</small></div>
      <div class="kpi"><span class="eyebrow">${spett ? "Incasso per spettatore" : "Margine attività"}</span><b>${spett ? money(r2(Ebig / spett)) : money(margAtt)}</b><small>${spett ? `${spett.toLocaleString("it-IT")} spettatori dai C1` : "cinema, teatro, danza…"}</small></div>
    </section>
    <div class="insights">${ins}</div>
    ${indicatoriGestione(list, all, { E, U, eventi, c1Anno, mesiTrascorsi })}
    <div class="panel" style="margin-top:18px"><h2>Entrate e uscite mese per mese</h2><span class="hint">Tocca una barra per i dettagli</span>
      <div class="series-legend"><span><i class="sw" style="background:var(--accent)"></i>Entrate</span><span><i class="sw" style="background:var(--spese)"></i>Uscite</span></div>
      <div class="chart-wrap" id="pn-chart"></div></div>
    <div class="panel" style="margin-top:18px"><h2>Saldo cumulato</h2><span class="hint">Quanto è avanzato (o mancato) dall'inizio dell'anno: mostra i mesi in cui serve liquidità</span>
      <div class="chart-wrap" id="pn-cum"></div></div>
    <div class="st-grid">
      <div class="panel"><h2>Risultato per settore</h2><span class="hint">Entrate − uscite di ogni settore; a destra in positivo, a sinistra in perdita</span>
        <div class="dv">${sett.map((s) => `<div class="dv-row"><span class="nm" title="${esc(s.nome)}">${esc(s.nome)}</span><div class="dv-track"><div class="dv-bar ${s.m >= 0 ? "pos" : "neg"}" style="width:${(Math.abs(s.m) / maxAbs) * 50}%"></div></div><span class="v ${s.m < 0 ? "neg" : ""}">${money(s.m)}</span><span class="sub">entrate ${money(s.e)} · uscite ${money(s.u)}</span></div>`).join("")}</div></div>
      <div class="stack">
        <div class="panel"><h2>Dove vanno i soldi</h2><span class="hint">Uscite per categoria</span>
          <div class="hbars">${catU.slice(0, 9).map((c) => `<div class="hbar"><span class="nm" title="${esc(c.nome)}">${esc(c.nome)}</span><span class="v">${money(c.v)} · ${pct(c.v / (U || 1))}</span><div class="track"><div class="fill" style="width:${(c.v / catU[0].v) * 100}%;background:var(--spese)"></div></div></div>`).join("")}</div></div>
        <div class="panel"><h2>Da dove arrivano</h2><span class="hint">Entrate per categoria</span>
          <div class="hbars">${catE.slice(0, 6).map((c) => `<div class="hbar"><span class="nm" title="${esc(c.nome)}">${esc(c.nome)}</span><span class="v">${money(c.v)} · ${pct(c.v / (E || 1))}</span><div class="track"><div class="fill" style="width:${(c.v / catE[0].v) * 100}%"></div></div></div>`).join("")}</div></div>
      </div>
    </div>
    ${eventi.length ? `<div class="panel" style="margin-top:18px"><h2>Conto economico per evento</h2><span class="hint">Incassi e costi diretti registrati con l'evento in prima nota; spettatori dai C1 quando il titolo corrisponde</span>
      <div class="tbl-wrap"><table><thead><tr><th>Evento</th><th>Settore</th><th class="n">Entrate</th><th class="n">Costi diretti</th><th class="n">Margine</th><th class="n">Spettatori</th><th class="n">Margine / spett.</th></tr></thead><tbody>
      ${eventi.map((x) => `<tr><td>${esc(x.nome)}</td><td>${esc(x.settore)}</td><td class="n">${money(x.e)}</td><td class="n">${money(x.u)}</td><td class="n ${x.m < 0 ? "neg" : ""}"><b>${money(x.m)}</b></td><td class="n">${x.sp || "—"}</td><td class="n ${x.m < 0 ? "neg" : ""}">${x.sp ? money(r2(x.m / x.sp)) : "—"}</td></tr>`).join("")}
      </tbody></table></div></div>` : ""}
    <div class="panel" style="margin-top:18px"><h2>Movimenti</h2><span class="hint">${movs.length} movimenti${S.pnSett || q ? " filtrati" : ""} · ${money(sommaE(movs))} entrate · ${money(sommaU(movs))} uscite</span>
      <div class="pn-filters"><select id="pn-sett" aria-label="Settore"><option value="">Tutti i settori</option>${settori.map((s) => `<option${s === S.pnSett ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>
        <input type="search" id="pn-q" placeholder="Cerca descrizione, controparte, evento…" value="${esc(S.pnQ)}" aria-label="Cerca nei movimenti"></div>
      <div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Descrizione</th><th>Settore · categoria</th><th class="n">Entrate</th><th class="n">Uscite</th></tr></thead><tbody>
      ${movVis.map((r) => `<tr><td style="white-space:nowrap">${esc(parse(r.data).toLocaleDateString("it-IT", { day: "numeric", month: "short" }))}</td><td>${esc(r.descrizione || r.controparte)}${r.evento ? `<div class="hint">${esc(r.evento)}</div>` : ""}${/previst/i.test(r.tipo_movimento) ? ' <span class="pill acconto">Previsto</span>' : ""}${r.anno !== +r.data.slice(0, 4) ? ` <span class="pill annullata">comp. ${r.anno}</span>` : ""}</td><td>${esc(r.settore)}<div class="hint">${esc(r.categoria)}</div></td><td class="n">${r.entrate ? money(r.entrate) : ""}</td><td class="n">${r.uscite ? money(r.uscite) : ""}</td></tr>`).join("")}
      </tbody></table></div>
      ${movs.length > movVis.length ? `<button class="btn sm" type="button" id="pn-more" style="margin-top:10px">Mostra tutti i ${movs.length} movimenti</button>` : ""}</div>`;
  barChart($("#pn-chart"), mesi.map((x) => x.m), [
    { name: "Entrate", color: "var(--accent)", values: mesi.map((x) => x.e) },
    { name: "Uscite", color: "var(--spese)", values: mesi.map((x) => x.u) },
  ], (v) => eur.format(v));
  lineChart($("#pn-cum"), mesi.slice(0, ultimoMese + 1).map((x) => x.m), cumul.slice(0, ultimoMese + 1), (v) => eur.format(v));
  $("#pn-sett").onchange = (e) => { S.pnSett = e.target.value; renderBilancio(); };
  const qi = $("#pn-q"); qi.oninput = () => { S.pnQ = qi.value; clearTimeout(S._pnT); S._pnT = setTimeout(() => { renderBilancio(); const n = $("#pn-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  const more = $("#pn-more"); if (more) more.onclick = () => { S.pnTutti = true; renderBilancio(); };
}

// costi variabili: legati ai singoli spettacoli (crescono con l'attività); gli altri sono costi fissi di struttura
const CAT_VARIABILI = /^(U01|U02|U03|U05|U06|U07|U15)$/i;
const isVariabile = (r) => CAT_VARIABILI.test(r.cod_cat) || (!r.cod_cat && /noleggio|siae|commission|compagni|artist|service|extra/i.test(r.categoria));

function indicatoriGestione(list, all, ctx) {
  const { E, U, eventi, c1Anno, mesiTrascorsi } = ctx;
  if (!E && !U) return "";
  const pctS = (x) => (isFinite(x) ? (Math.round(x * 1000) / 10).toLocaleString("it-IT") + "%" : "—");
  const num = (x) => (isFinite(x) ? Math.round(x).toLocaleString("it-IT") : "—");
  const usc = list.filter((r) => r.uscite);
  const cVar = sommaU(usc.filter(isVariabile)), cFix = r2(U - cVar);
  const ricBig = sommaE(list.filter((r) => /^E01$/i.test(r.cod_cat))), ricAff = sommaE(list.filter((r) => /^E02$/i.test(r.cod_cat) || /affitt/i.test(r.categoria))),
    ricDon = sommaE(list.filter((r) => /^E03$/i.test(r.cod_cat) || /donaz|liberal/i.test(r.categoria)));
  const ricAltri = r2(E - ricBig - ricAff - ricDon);
  const mdc = r2(E - cVar), mdcPct = E ? mdc / E : NaN, ro = r2(mdc - cFix);
  const bep = mdcPct > 0 ? cFix / mdcPct : NaN, sicurezza = E && isFinite(bep) ? (E - bep) / E : NaN;
  const dol = ro > 0 ? mdc / ro : NaN;
  const autonomia = U ? (E - ricDon) / U : NaN;
  // cinema e spettacoli dai C1
  const cin = c1Anno.filter((c) => /cinema/i.test(c.tipo_evento || "cinema"));
  const posti = c1Anno.reduce((s, c) => s + capienza(c), 0), spett = c1Anno.reduce((s, c) => s + c.spettatori, 0);
  const paganti = c1Anno.reduce((s, c) => s + c.paganti, 0), lordoC1 = c1Anno.reduce((s, c) => s + c.lordo, 0);
  const omaggi = c1Anno.reduce((s, c) => s + c.omaggi, 0);
  const nettoCin = cin.reduce((s, c) => s + c.imponibile_iva, 0);
  const noleggio = sommaU(usc.filter((r) => /^U01$/i.test(r.cod_cat) || /noleggio/i.test(r.categoria)));
  const costiCinema = sommaU(usc.filter((r) => isAttivita(r) && isCinema(r)));
  const spettCin = cin.reduce((s, c) => s + c.spettatori, 0);
  const serate = new Set(c1Anno.map((c) => c.data)).size;
  // uso della sala dal calendario
  const Y = String(S.pnYear), fine = S.pnYear < new Date().getFullYear() ? `${Y}-12-31` : TODAY;
  const giorniAnno = Math.round((parse(fine) - parse(`${Y}-01-01`)) / 864e5) + 1;
  const giorniUsati = new Set(S.bookings.filter((b) => active(b) && b.data.startsWith(Y) && b.data <= fine).map((b) => b.data)).size;
  const affittiN = list.filter((r) => r.entrate > 0 && (/^E02$/i.test(r.cod_cat) || /affitt/i.test(r.categoria))).length;
  // concentrazione e stima
  const positivi = eventi.filter((x) => x.m > 0).sort((a, b) => b.m - a.m), totPos = positivi.reduce((s, x) => s + x.m, 0);
  const top3 = totPos ? positivi.slice(0, 3).reduce((s, x) => s + x.m, 0) / totPos : NaN;
  const reali = list.filter((r) => !/previst/i.test(r.tipo_movimento));
  const previsti = r2(sommaU(list) - sommaU(reali));
  const mediaMese = (sommaE(reali) - sommaU(reali)) / mesiTrascorsi;
  const stima = S.pnYear === new Date().getFullYear() ? r2(sommaE(reali) - sommaU(reali) + mediaMese * (12 - mesiTrascorsi) - previsti) : NaN;

  const card = (nome, valore, cosa, come, neg) => `<div class="ind"><span class="nm">${nome}</span><b class="${neg ? "neg" : ""}">${valore}</b><p>${cosa}</p><details><summary>Come si calcola</summary><div>${come}</div></details></div>`;
  const gruppo = (titolo, cards) => (cards.filter(Boolean).length ? `<div class="ind-group"><h3>${titolo}</h3><div class="ind-grid">${cards.filter(Boolean).join("")}</div></div>` : "");

  const ceRiga = (nome, v, cls) => `<tr class="${cls || ""}"><td>${nome}</td><td class="n ${v < 0 ? "neg" : ""}">${money(v)}</td><td class="n">${E ? pctS(v / E) : ""}</td></tr>`;
  const conto = `<div class="panel" style="margin-top:18px"><h2>Conto economico riclassificato</h2><span class="hint">A margine di contribuzione: prima i costi che dipendono dagli spettacoli, poi quelli della struttura · % sui ricavi</span>
    <div class="tbl-wrap"><table class="ce"><tbody>
      ${ceRiga("Ricavi da biglietteria", ricBig, "sub")}${ricAff ? ceRiga("Ricavi da affitti della sala", ricAff, "sub") : ""}${ricDon ? ceRiga("Erogazioni liberali e donazioni", ricDon, "sub") : ""}${ricAltri ? ceRiga("Altri ricavi", ricAltri, "sub") : ""}
      ${ceRiga("Totale ricavi", E, "tot")}
      ${[...raggruppa(usc.filter(isVariabile), "categoria").entries()].sort((a, b) => sommaU(b[1]) - sommaU(a[1])).map(([c, rs]) => ceRiga("− " + esc(c), -sommaU(rs), "sub")).join("")}
      ${ceRiga("Margine di contribuzione", mdc, "tot")}
      ${[...raggruppa(usc.filter((r) => !isVariabile(r)), "categoria").entries()].sort((a, b) => sommaU(b[1]) - sommaU(a[1])).map(([c, rs]) => ceRiga("− " + esc(c), -sommaU(rs), "sub")).join("")}
      ${ceRiga("Risultato operativo", ro, "big")}
      ${S.pnComp === "competenza" && all.some((r) => r.anno !== S.pnYear) ? ceRiga("Partite di anni precedenti (escluse sopra)", r2(sommaE(all.filter((r) => r.anno !== S.pnYear)) - sommaU(all.filter((r) => r.anno !== S.pnYear))), "sub") : ""}
    </tbody></table></div></div>`;

  return `<div class="panel" style="margin-top:18px"><h2>Indicatori di gestione</h2><span class="hint">Calcolati su ${S.pnComp === "competenza" ? "competenza " + Y : "tutti i movimenti del " + Y}; costi variabili = noleggio film, SIAE, commissioni, compagnie, service, extra serata</span>
    ${gruppo("Redditività", [
      card("Margine di contribuzione", `${money(mdc)} · ${pctS(mdcPct)}`, "Quanto resta dei ricavi dopo i costi legati agli spettacoli: è ciò che paga la struttura.", "Ricavi − costi variabili; in % sui ricavi."),
      card("Punto di pareggio", isFinite(bep) ? money(Math.round(bep)) : "—", isFinite(bep) ? `Ricavi annui necessari per coprire tutti i costi. Oggi ne avete ${money(E)}.` : "Non calcolabile: il margine di contribuzione è negativo.", "Costi fissi ÷ margine di contribuzione %."),
      card("Margine di sicurezza", pctS(sicurezza), isFinite(sicurezza) ? (sicurezza >= 0 ? "Di quanto potrebbero calare i ricavi prima di andare in perdita." : "Quanto mancano i ricavi per arrivare al pareggio.") : "", "(Ricavi − punto di pareggio) ÷ ricavi.", sicurezza < 0),
      card("Leva operativa", isFinite(dol) ? dol.toLocaleString("it-IT", { maximumFractionDigits: 1 }) + "×" : "—", isFinite(dol) ? `Se i ricavi crescono del 10%, il risultato cresce di circa il ${Math.round(dol * 10)}%.` : "Si calcola solo con risultato operativo positivo.", "Margine di contribuzione ÷ risultato operativo."),
      isFinite(stima) && card("Stima a fine anno", money(stima), "Proiezione del risultato al 31/12 con l'andamento medio dei mesi passati, meno i costi già previsti. È indicativa: non tiene conto della stagionalità.", "Risultato dei movimenti effettivi + media mensile × mesi mancanti − costi previsti.", stima < 0),
    ])}
    ${gruppo("Struttura dei costi e delle entrate", [
      card("Costi fissi", `${money(cFix)} · ${pctS(cFix / (U || 1))}`, `Circa ${money(Math.round(cFix / mesiTrascorsi))} al mese, anche senza spettacoli.`, "Uscite non legate ai singoli spettacoli (energia, acqua, assicurazioni, manutenzioni…)."),
      serate && card("Costo fisso per serata", money(Math.round(cFix / serate)), `Quanto pesa la struttura su ognuna delle ${serate} serate con biglietteria.`, "Costi fissi ÷ giorni con almeno un C1."),
      card("Autonomia finanziaria", pctS(autonomia), "Quanta parte dei costi è coperta con ricavi propri, senza donazioni.", "(Ricavi − donazioni) ÷ uscite totali.", autonomia < 1),
      card("Dipendenza dalle donazioni", pctS(ricDon / (E || 1)), "Quota delle entrate che arriva da erogazioni liberali.", "Donazioni ÷ ricavi."),
      isFinite(top3) && card("Concentrazione del margine", pctS(top3), `I 3 eventi migliori producono questa quota del margine degli eventi in attivo${top3 > 0.5 ? ": molto dipende da pochi titoli" : ""}.`, "Margine dei primi 3 eventi ÷ margine di tutti gli eventi in attivo."),
    ])}
    ${c1Anno.length ? gruppo("Biglietteria e cinema (dai C1)", [
      card("Riempimento sala", pctS(spett / (posti || 1)), `${num(spett)} spettatori su ${num(posti)} posti offerti in ${c1Anno.length} spettacoli.`, "Spettatori ÷ (capienza × numero di spettacoli)."),
      card("Prezzo medio del biglietto", money(r2(lordoC1 / (paganti || 1))), `Su ${num(paganti)} paganti; omaggi ${pctS(omaggi / (spett || 1))} degli ingressi.`, "Incasso lordo C1 ÷ spettatori paganti."),
      card("Ricavo per posto offerto", money(r2(lordoC1 / (posti || 1))), "Quanto rende ogni poltrona messa a disposizione: unisce prezzo e riempimento.", "Incasso lordo C1 ÷ (capienza × spettacoli)."),
      nettoCin > 0 && card("Quota al distributore", pctS(noleggio / nettoCin), "Parte dell'incasso netto IVA del cinema che va ai distributori per il noleggio dei film.", "Noleggio film ÷ incasso netto IVA dei C1 di cinema."),
      spettCin > 0 && card("Costo per spettatore (cinema)", money(r2(costiCinema / spettCin)), `Costi diretti dei settori cinema divisi per i ${num(spettCin)} spettatori dei film.`, "Uscite dei settori cinema ÷ spettatori C1 di cinema."),
    ]) : ""}
    ${S.bookings.length ? gruppo("Uso della sala", [
      card("Giorni di utilizzo", pctS(giorniUsati / giorniAnno), `${giorniUsati} giorni con almeno un evento su ${giorniAnno} trascorsi.`, "Giorni con eventi in calendario ÷ giorni dell'anno trascorsi."),
      ricAff > 0 && affittiN > 0 && card("Ricavo medio per affitto", money(Math.round(ricAff / affittiN)), `${affittiN} incassi da affitto registrati in prima nota.`, "Ricavi da affitti ÷ numero di incassi da affitto in prima nota."),
    ]) : ""}
  </div>${conto}`;
}

/* ---------- diagnosi: perché la prima nota o le donazioni non compaiono ---------- */
function diagnosiPrimaNota(dove) {
  const passi = [];
  const errPn = S.loadErr?.prima_nota;
  if (errPn) passi.push(`<b>In Supabase manca lo script 007_prima_nota.sql</b> (o non è andato a buon fine). Eseguilo nel SQL Editor e ricarica la pagina.<div class="hint">Messaggio del database: ${esc(errPn)}</div>`);
  else if (!S.primaNota.length) {
    passi.push(S.sync.primaNota
      ? `Lo script Google ha letto la prima nota ${ago(S.sync.primaNota)}, ma non ha mandato movimenti: controlla il log di <b>provaPrimaNota</b>.`
      : `<b>La prima nota non è ancora arrivata.</b> Nello script Google la proprietà <b>MODALITA</b> deve contenere <b>+primanota</b> (es. <code>lettura+email+cinema+c1+primanota</code>); poi esegui <b>provaPrimaNota</b> e controlla che il log dica «229 movimenti».`);
    passi.push(`Controlla che il codice dello script Google sia la versione <b>2026-10-30.7</b> o successiva (lo dice la prima riga del log).`);
  } else if (dove === "donazioni") {
    const cats = [...new Set(S.primaNota.filter((r) => r.entrate > 0).map((r) => `${r.cod_cat || "senza codice"} · ${r.categoria}`))];
    passi.push(`Nella prima nota ci sono ${S.primaNota.length} movimenti, ma nessuna entrata con categoria <b>E03 «Erogazioni liberali e donazioni»</b> o settore «Donazioni». Le categorie delle entrate trovate sono: ${cats.map(esc).join("; ") || "nessuna"}.`);
  }
  return `<div class="panel"><h2>${dove === "donazioni" ? "Le donazioni non sono ancora disponibili" : "Il bilancio non è ancora disponibile"}</h2>
    <span class="hint">Le ${dove === "donazioni" ? "donazioni" : "cifre"} arrivano dalla prima nota (file Excel nella cartella «PRIMA NOTA» su Drive), letta dallo script Google.</span>
    <ol style="margin:10px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:8px">${passi.map((x) => `<li>${x}</li>`).join("")}</ol></div>`;
}

/* ---------- schede di richiesta online ---------- */
const SCHEDA_GIORNI = 30, SCHEDA_URGENTE = 14; // da compilare 30 giorni prima; sotto i 14 è urgente
const giorniA = (d) => Math.round((parse(d) - parse(TODAY)) / 864e5);
const linkScheda = (s) => new URL("modulo/compila.html?t=" + s.token, location.href.split("#")[0]).href;
const schedaDi = (b) => S.schede.filter((s) => s.booking_id === b.id).sort((a, c) => c.creato.localeCompare(a.creato))[0];
const schedeDaVerificare = () => S.schede.filter((s) => s.stato === "compilata").length;
// eventi per cui di solito serve la scheda: in arrivo, non ricorrenti, non del cinema della sala
const serveScheda = (b) => active(b) && b.data >= TODAY && giorniA(b.data) <= 120 && !isRecurring(b) && !/cinema|proiezion|cineforum/i.test((b.tipo || "") + " " + b.titolo);
const STATI_SCHEDA = { da_inviare: "Da inviare", inviata: "Inviata", aperta: "Aperta", compilata: "Da verificare", approvata: "Approvata", respinta: "Da correggere", non_serve: "Non serve" };
function pillScheda(b) {
  const s = schedaDi(b);
  if (!s) return serveScheda(b) && giorniA(b.data) <= SCHEDA_GIORNI ? `<span class="pill dapagare">Scheda mancante</span>` : "";
  if (s.stato === "non_serve") return "";
  const cls = { approvata: "saldato", compilata: "acconto", respinta: "dapagare" }[s.stato] || "dafare";
  return `<span class="pill ${cls}">Scheda: ${STATI_SCHEDA[s.stato].toLowerCase()}</span>`;
}
function righeSchede() {
  // per ogni prenotazione conta solo la scheda più recente
  const conScheda = S.schede.map((s) => ({ s, b: S.bookings.find((b) => b.id === s.booking_id) })).filter((r) => !r.b || schedaDi(r.b) === r.s);
  const senza = S.bookings.filter((b) => serveScheda(b) && !schedaDi(b)).map((b) => ({ s: null, b }));
  return [...conScheda, ...senza].map((r) => {
    const data = (r.b && r.b.data) || (r.s && r.s.data_evento) || null;
    const gg = data ? giorniA(data) : null;
    const st = r.s ? r.s.stato : "nessuna";
    const chiusa = ["compilata", "approvata", "non_serve"].includes(st);
    return { ...r, data, gg, st, urgente: gg !== null && gg >= 0 && gg <= SCHEDA_URGENTE && !chiusa, ritardo: gg !== null && gg >= 0 && gg <= SCHEDA_GIORNI && !chiusa, passata: gg !== null && gg < 0 };
  });
}
const SC_FILTRI = [
  ["attive", "In corso", (r) => !r.passata && !["approvata", "non_serve"].includes(r.st)],
  ["urgenti", "Urgenti", (r) => r.urgente],
  ["daverificare", "Da verificare", (r) => r.st === "compilata"],
  ["attesa", "In attesa di risposta", (r) => ["inviata", "aperta", "respinta"].includes(r.st)],
  ["dainviare", "Da inviare", (r) => ["nessuna", "da_inviare"].includes(r.st) && !r.passata],
  ["approvate", "Approvate", (r) => r.st === "approvata"],
  ["tutte", "Tutte", (r) => r.st !== "non_serve" || true],
];
function renderSchede() {
  if (S.loadErr?.schede) { $("#sc-list").innerHTML = `<div class="warn">In Supabase manca lo script <b>010_schede.sql</b>: eseguilo nel SQL Editor e ricarica la pagina. (${esc(S.loadErr.schede)})</div>`; $("#sc-kpis").innerHTML = ""; return; }
  const righe = righeSchede();
  const n = (f) => righe.filter(f).length;
  $("#sc-kpis").innerHTML = `
    <div class="kpi"><span class="eyebrow">Da inviare</span><b>${n((r) => ["nessuna", "da_inviare"].includes(r.st) && !r.passata)}</b><small>eventi senza link mandato</small></div>
    <div class="kpi"><span class="eyebrow">In attesa</span><b>${n((r) => ["inviata", "aperta", "respinta"].includes(r.st))}</b><small>${n((r) => r.st === "aperta")} aperte ma non ancora inviate</small></div>
    <div class="kpi"><span class="eyebrow">Da verificare</span><b>${n((r) => r.st === "compilata")}</b><small>compilate dall'organizzatore</small></div>
    <div class="kpi"><span class="eyebrow">Urgenti</span><b class="${n((r) => r.urgente) ? "neg" : ""}">${n((r) => r.urgente)}</b><small>evento entro ${SCHEDA_URGENTE} giorni, scheda non arrivata</small></div>`;
  $("#sc-filters").innerHTML = SC_FILTRI.map(([k, l, f]) => `<button type="button" data-f="${k}" aria-pressed="${S.scFilter === k}">${l}<span class="c">${n(f)}</span></button>`).join("");
  $("#sc-filters").querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { S.scFilter = b.dataset.f; renderSchede(); }));
  const lista = righe.filter(SC_FILTRI.find((x) => x[0] === S.scFilter)[2]).sort((a, c) => (a.urgente === c.urgente ? (a.data || "9").localeCompare(c.data || "9") : a.urgente ? -1 : 1));
  if (!lista.length) { $("#sc-list").innerHTML = `<div class="empty">${S.scFilter === "attive" ? "Nessuna scheda da seguire: per gli eventi esterni in arrivo è tutto in ordine." : "Nessuna scheda in questo elenco."}</div>`; return; }
  const dt = (t) => (t ? new Date(t).toLocaleDateString("it-IT", { day: "numeric", month: "short" }) : "");
  $("#sc-list").innerHTML = `<div class="blist">${lista.map((r) => {
    const s = r.s, b = r.b, titolo = (b && b.titolo) || (s && s.titolo) || "Evento da definire";
    const chi = (b && b.referente) || (s && s.destinatario) || "";
    const tappa = (on, testo, cls = "") => `<span class="tappa ${on ? "on" : ""} ${cls}">${testo}</span>`;
    const tappe = !s ? `<span class="tappa ${r.ritardo ? "ko" : "warn-t"}">Scheda non ancora creata</span>`
      : s.stato === "non_serve" ? `<span class="tappa">Segnata come non necessaria</span>`
      : tappa(!!s.inviata_il, s.inviata_il ? `Inviata ${dt(s.inviata_il)}` : "Da inviare", s.inviata_il ? "" : "warn-t")
        + tappa(!!s.aperta_il, s.aperta_il ? `Aperta ${dt(s.aperta_il)}` : "Non ancora aperta")
        + tappa(!!s.compilata_il, s.compilata_il ? `Compilata ${dt(s.compilata_il)}` : "Non compilata", !s.compilata_il && r.ritardo ? "ko" : "")
        + (s.stato === "respinta" ? tappa(false, "Correzioni richieste", "warn-t") : tappa(s.stato === "approvata", s.stato === "approvata" ? `Approvata ${dt(s.verificata_il)}` : "Da approvare", s.stato === "compilata" ? "warn-t" : ""))
        + ({ allegato: tappa(true, "SIAE allegata"), da_ricevere: tappa(false, "SIAE da ricevere", s.stato === "approvata" ? "" : r.urgente ? "ko" : "warn-t"), non_serve: tappa(false, "SIAE non serve") }[siaeStato(s.dati)] || "")
        + (s.sollecitata_il ? `<span class="tappa">Sollecitata ${dt(s.sollecitata_il)}</span>` : "");
    const az = [];
    if (!s || ["da_inviare"].includes(s.stato)) az.push(`<button class="btn primary sm" type="button" data-invia="${esc(b ? b.id : "")}" data-sid="${esc(s ? s.id : "")}">Invia il link</button>`);
    if (s && ["inviata", "aperta", "respinta"].includes(s.stato)) az.push(`<button class="btn sm" type="button" data-sollecita="${esc(s.id)}">Sollecita</button>`, `<button class="btn ghost sm" type="button" data-link="${esc(s.id)}">Copia link</button>`);
    if (s && ["compilata", "approvata", "respinta"].includes(s.stato)) az.push(`<button class="btn ${s.stato === "compilata" ? "primary" : ""} sm" type="button" data-vedi="${esc(s.id)}">${s.stato === "compilata" ? "Verifica" : "Vedi risposte"}</button>`);
    if (!s || !["approvata", "non_serve", "compilata"].includes(s.stato)) az.push(`<button class="btn ghost sm" type="button" data-nonserve="${esc(b ? b.id : "")}" data-sid="${esc(s ? s.id : "")}">Non serve</button>`);
    if (s && s.stato === "non_serve") az.push(`<button class="btn ghost sm" type="button" data-riattiva="${esc(s.id)}">Serve</button>`);
    return `<article class="panel sc-row ${r.urgente ? "sc-urgente" : ""}">
      <div class="quando">${r.data ? `<b>${esc(fmtShort(r.data))}</b><span class="tra ${r.urgente ? "urg" : ""}">${r.gg === 0 ? "oggi" : r.gg > 0 ? `tra ${r.gg} giorni` : `${-r.gg} giorni fa`}</span>` : `<span>data da definire</span>`}</div>
      <div><div class="t">${esc(titolo)}</div><div class="m">${esc([chi, s && s.firma_nome ? `firmata da ${s.firma_nome}` : "", s && s.sicurezza ? { compatibile: "sicurezza: compatibile", condizioni: "sicurezza: con condizioni", non_compatibile: "sicurezza: non compatibile" }[s.sicurezza] : ""].filter(Boolean).join(" · "))}</div><div class="tappe">${tappe}</div></div>
      <div class="az">${az.join("")}</div>
    </article>`;
  }).join("")}</div>`;
  const L = $("#sc-list");
  L.querySelectorAll("[data-invia]").forEach((x) => (x.onclick = () => inviaScheda(x.dataset.invia, x.dataset.sid)));
  L.querySelectorAll("[data-sollecita]").forEach((x) => (x.onclick = () => sollecitaScheda(x.dataset.sollecita)));
  L.querySelectorAll("[data-link]").forEach((x) => (x.onclick = () => { const s = S.schede.find((y) => y.id === x.dataset.link); openCopyText(linkScheda(s)); }));
  L.querySelectorAll("[data-vedi]").forEach((x) => (x.onclick = () => apriScheda(x.dataset.vedi)));
  L.querySelectorAll("[data-nonserve]").forEach((x) => (x.onclick = async () => {
    x.disabled = true;
    try {
      if (x.dataset.sid) await run(sb.from("schede").update({ stato: "non_serve", aggiornato: new Date().toISOString() }).eq("id", x.dataset.sid), "Segnata: la scheda non serve");
      else { const b = S.bookings.find((y) => y.id === x.dataset.nonserve); await run(sb.from("schede").insert({ booking_id: b.id, titolo: b.titolo, data_evento: b.data, destinatario: b.referente || "", stato: "non_serve" }), "Segnata: la scheda non serve"); }
    } catch (e) { x.disabled = false; toast(errText(e)); }
  }));
  L.querySelectorAll("[data-riattiva]").forEach((x) => (x.onclick = async () => { try { await run(sb.from("schede").update({ stato: "da_inviare" }).eq("id", x.dataset.riattiva), "La scheda torna da inviare"); } catch (e) { toast(errText(e)); } }));
}
function messaggioScheda(s, b, sollecito) {
  const chi = ((b && b.referente) || s.destinatario || "").split(" ")[0];
  const titolo = (b && b.titolo) || s.titolo, data = (b && b.data) || s.data_evento;
  const firma = (S.me.nome || "").split(" ")[0];
  return [
    `Buongiorno${chi ? " " + chi : ""},`,
    sollecito
      ? `vi ricordiamo di compilare la scheda di richiesta della Sala San Tommaso Moro${titolo ? ` per «${titolo}»` : ""}${data ? ` del ${fmtDay(data, { day: "numeric", month: "long" })}` : ""}: ci serve per preparare la sala e la sicurezza.`
      : `per ${titolo ? `«${titolo}»` : "il vostro evento"}${data ? ` del ${fmtDay(data, { day: "numeric", month: "long" })}` : ""} alla Sala San Tommaso Moro vi chiediamo di compilare la scheda di richiesta: ci vogliono circa 5 minuti, anche dal telefono.`,
    linkScheda(s),
    "Grazie!" + (firma ? `\n${firma}` : ""),
  ].join("\n");
}
async function inviaScheda(bookingId, sid) {
  try {
    let s = sid ? S.schede.find((x) => x.id === sid) : null;
    const b = bookingId ? S.bookings.find((x) => x.id === bookingId) : s && S.bookings.find((x) => x.id === s.booking_id);
    if (!s) {
      const { data, error } = await sb.from("schede").insert({ booking_id: b.id, titolo: b.titolo, data_evento: b.data, destinatario: b.referente || "", contatto: b.telefono || b.email || "" }).select("*").single();
      if (error) throw error;
      s = data;
    }
    // aprire il messaggio da mandare vale come invio: la scheda passa a «inviata»
    await sb.from("schede").update({ stato: s.stato === "da_inviare" ? "inviata" : s.stato, inviata_il: s.inviata_il || new Date().toISOString(), aggiornato: new Date().toISOString() }).eq("id", s.id);
    openCopyText(messaggioScheda(s, b, false));
    await loadAll();
  } catch (e) { toast(errText(e)); }
}
async function sollecitaScheda(id) {
  const s = S.schede.find((x) => x.id === id), b = S.bookings.find((x) => x.id === s.booking_id);
  openCopyText(messaggioScheda(s, b, true));
  try { await run(sb.from("schede").update({ sollecitata_il: new Date().toISOString() }).eq("id", id)); } catch (e) { toast(errText(e)); }
}
const ETICHETTE = {
  ente: "Organizzatore", a_titolo: "Richiede come", cf: "CF / P. IVA", indirizzo: "Indirizzo", referente: "Referente", cellulare: "Cellulare", email: "Email", resp_sera: "Responsabile la sera", resp_cell: "Suo cellulare",
  titolo: "Titolo", tipo: "Tipo", descrizione: "Descrizione", ingresso: "Ingresso", prezzo: "Prezzo €", biglietti: "Biglietti gestiti da", fascia: "Fascia di pubblico", pubblico_n: "Pubblico previsto", bambini_n: "di cui bambini", carrozzina_n: "Persone in carrozzina", palco_n: "Persone sul palco",
  luci: "Luci di scena", sipario: "Sipario e quinte", audio: "Impianto audio", mic_filo: "Microfoni a filo", mic_filo_n: "n. microfoni a filo", radiomic: "Radiomicrofoni", radiomic_n: "n. radiomicrofoni", proiettore: "Proiettore e schermo", tavolo: "Tavolo relatori", tavolo_n: "posti al tavolo", mic_tavolo: "Microfoni da tavolo", mic_tavolo_n: "n. microfoni da tavolo", leggio: "Leggio",
  tecnico: "Tecnico", tecnico_nome: "Nome tecnico", tecnico_cell: "Cellulare tecnico", attrezzature: "Attrezzature da collegare", attrezzature_quali: "Quali", potenza_w: "Potenza totale (W)",
  scenografie: "Scenografie", scenografie_quali: "Cosa portano", ignifughi: "Materiali ignifughi classe 1", effetti: "Effetti", effetti_quali: "Quali effetti", durante: "Durante l'evento", pubblicabile: "Pubblicabile nel programma", locandina_entro: "Locandina entro", altro: "Altre richieste",
  siae: "Opere protette (SIAE)", siae_file: "Permesso SIAE", siae_dopo: "Permesso SIAE",
  ok_regole: "Regole accettate", ok_dichiarazione: "Dichiarazione accettata", ok_privacy: "Informativa privacy", firma: "Firmata da",
};
const GRUPPI_SCHEDA = [["Chi organizza", ["ente", "a_titolo", "cf", "indirizzo", "referente", "cellulare", "email", "resp_sera", "resp_cell"]], ["L'evento", ["titolo", "tipo", "descrizione", "ingresso", "prezzo", "biglietti", "fascia", "pubblico_n", "bambini_n", "carrozzina_n", "palco_n"]], ["Date e orari", ["orari"]],
  ["Palco e tecnica", ["luci", "sipario", "audio", "mic_filo", "mic_filo_n", "radiomic", "radiomic_n", "proiettore", "tavolo", "tavolo_n", "mic_tavolo", "mic_tavolo_n", "leggio", "tecnico", "tecnico_nome", "tecnico_cell", "attrezzature", "attrezzature_quali", "potenza_w"]],
  ["Scenografie, effetti e altro", ["scenografie", "scenografie_quali", "ignifughi", "effetti", "effetti_quali", "durante", "pubblicabile", "locandina_entro", "altro"]], ["SIAE", ["siae", "siae_file", "siae_dopo"]], ["Firma", ["ok_regole", "ok_dichiarazione", "ok_privacy", "firma"]]];
// permesso SIAE: a carico dell'organizzatore, da allegare alla scheda
function siaeStato(d) {
  if (!d || !d.siae) return "";
  if (d.siae === "no") return "non_serve";
  return (d.siae_file || []).length ? "allegato" : "da_ricevere";
}
function risposteHtml(d, conLink = true) {
  const val = (k, v) => (k === "siae" ? (v === "si" ? "sì: permesso a carico dell'organizzatore" : "no, nessuna opera protetta") : k === "siae_dopo" ? "non ancora allegato: lo mandano per email prima dell'evento" : v === true ? "sì" : Array.isArray(v) ? v.join(", ") : /locandina_entro/.test(k) ? fmtShort(v) : String(v));
  return GRUPPI_SCHEDA.map(([g, ks]) => {
    const righe = ks.flatMap((k) => {
      if (k === "orari") return (d.orari || []).map((o, i) => `<dt>Giorno ${i + 1}</dt><dd>${esc(o.data ? fmtDay(o.data) : "")}${o.all_da ? ` · allestimento ${esc(o.all_da)}–${esc(o.all_a)}` : ""}${o.porte ? ` · porte ${esc(o.porte)}` : ""} · inizio ${esc(o.inizio)}${o.fine ? `, fine ${esc(o.fine)}` : ""}${o.sgombero ? ` · sgombero ${esc(o.sgombero)}` : ""}</dd>`);
      const v = d[k];
      if (k === "siae_file") return (Array.isArray(v) ? v : []).map((f) => `<dt>${esc(ETICHETTE[k])}</dt><dd>${conLink ? `<a href="#" data-allegato="${esc(f.percorso)}">📎 ${esc(f.nome)}</a>` : `📎 ${esc(f.nome)}`}</dd>`);
      if (k === "siae_dopo" && (d.siae !== "si" || (d.siae_file || []).length)) return [];
      if (v === undefined || v === "" || v === false || (Array.isArray(v) && !v.length)) return [];
      return [`<dt>${esc(ETICHETTE[k] || k)}</dt><dd>${esc(val(k, v))}</dd>`];
    });
    return righe.length ? `<div><h4>${g}</h4><dl>${righe.join("")}</dl></div>` : "";
  }).join("");
}
const dlgSK = $("#dlg-scheda");
function apriScheda(id) {
  const s = S.schede.find((x) => x.id === id), b = S.bookings.find((x) => x.id === s.booking_id);
  S.editingScheda = s;
  $("#sk-head").textContent = (b && b.titolo) || s.dati.titolo || s.titolo || "Scheda";
  $("#sk-stato").textContent = `${STATI_SCHEDA[s.stato]} · compilata ${s.compilata_il ? new Date(s.compilata_il).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"} da ${s.firma_nome || "—"}${b ? ` · prenotazione del ${fmtShort(b.data)}` : " · non ancora in calendario"}`;
  $("#sk-risposte").innerHTML = risposteHtml(s.dati || {});
  $("#sk-risposte").querySelectorAll("[data-allegato]").forEach((a) => (a.onclick = async (e) => {
    e.preventDefault();
    const w = window.open("", "_blank");
    const { data, error } = await sb.storage.from("schede").createSignedUrl(a.dataset.allegato, 3600);
    if (error || !data) { if (w) w.close(); toast("Allegato non disponibile: " + ((error && error.message) || "riprova")); return; }
    if (w) w.location.href = data.signedUrl; else location.href = data.signedUrl;
  }));
  S.siaeAvvisato = null;
  dlgSK.querySelectorAll('[name="sk-sic"]').forEach((r) => (r.checked = r.value === s.sicurezza));
  $("#sk-note").value = s.sicurezza_note || "";
  $("#sk-error").innerHTML = "";
  $("#sk-copia").hidden = !b;
  dlgSK.showModal();
}
$("#sk-approva").onclick = async () => {
  const s = S.editingScheda, sic = (dlgSK.querySelector('[name="sk-sic"]:checked') || {}).value;
  if (!sic) { $("#sk-error").innerHTML = `<div class="warn">Indica il parere del responsabile della sicurezza.</div>`; return; }
  if (sic === "non_compatibile") { $("#sk-error").innerHTML = `<div class="warn">Con parere «non compatibile» la scheda non si approva: usa «Chiedi correzioni» o contatta l'organizzatore.</div>`; return; }
  if (siaeStato(s.dati) === "da_ricevere" && S.siaeAvvisato !== s.id) {
    S.siaeAvvisato = s.id;
    $("#sk-error").innerHTML = `<div class="warn">Il permesso SIAE non è allegato: è a carico dell'organizzatore e va consegnato prima dell'evento. Se l'avete già ricevuto per email, premi di nuovo «Approva».</div>`;
    return;
  }
  try { await run(sb.from("schede").update({ stato: "approvata", sicurezza: sic, sicurezza_note: $("#sk-note").value.trim(), verificata_da: S.me.id, verificata_il: new Date().toISOString() }).eq("id", s.id), "Scheda approvata"); dlgSK.close(); }
  catch (e) { $("#sk-error").innerHTML = `<div class="warn">${esc(errText(e))}</div>`; }
};
$("#sk-correggi").onclick = async () => {
  const s = S.editingScheda, b = S.bookings.find((x) => x.id === s.booking_id), note = $("#sk-note").value.trim();
  const sic = (dlgSK.querySelector('[name="sk-sic"]:checked') || {}).value || null;
  try {
    await run(sb.from("schede").update({ stato: "respinta", sicurezza: sic, sicurezza_note: note, verificata_da: S.me.id, verificata_il: new Date().toISOString() }).eq("id", s.id));
    dlgSK.close();
    openCopyText([`Buongiorno ${((b && b.referente) || s.firma_nome || "").split(" ")[0]},`, `abbiamo letto la scheda per la Sala San Tommaso Moro. Vi chiediamo di rivedere: ${note || "…"}.`, `Potete correggerla dallo stesso link: ${linkScheda(s)}`, "Grazie!"].join("\n"));
  } catch (e) { $("#sk-error").innerHTML = `<div class="warn">${esc(errText(e))}</div>`; }
};
$("#sk-copia").onclick = async () => {
  const s = S.editingScheda, b = S.bookings.find((x) => x.id === s.booking_id), d = s.dati || {};
  const extra = [d.ente && `Organizzatore: ${d.ente}`, d.pubblico_n && `Pubblico previsto: ${d.pubblico_n}`, d.tecnico && `Tecnico: ${d.tecnico}${d.tecnico_nome ? " (" + d.tecnico_nome + ")" : ""}`, d.resp_sera && `Responsabile la sera: ${d.resp_sera} ${d.resp_cell || ""}`].filter(Boolean).join(" · ");
  const rec = { referente: d.referente || b.referente, telefono: d.cellulare || b.telefono, email: d.email || b.email, note: [b.note, extra && `Dalla scheda: ${extra}`].filter(Boolean).join("\n") };
  try { await run(sb.from("bookings").update(rec).eq("id", b.id), "Dati copiati nella prenotazione"); } catch (e) { toast(errText(e)); }
};
$("#sk-stampa").onclick = () => {
  const s = S.editingScheda, w = window.open("", "_blank");
  if (!w) { toast("Il browser ha bloccato la finestra di stampa"); return; }
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Scheda · ${esc($("#sk-head").textContent)}</title><style>body{font:13px/1.4 system-ui,sans-serif;margin:24px;color:#111}h1{font:600 20px Georgia,serif}h4{margin:14px 0 4px;text-transform:uppercase;font-size:11px;letter-spacing:.06em;color:#555}dl{display:grid;grid-template-columns:34% 1fr;gap:3px 12px;margin:0}dt{color:#555}dd{margin:0}</style>
    <h1>Sala San Tommaso Moro · ${esc($("#sk-head").textContent)}</h1><p>${esc($("#sk-stato").textContent)}</p>${risposteHtml(s.dati || {}, false)}
    <h4>Responsabile della sicurezza</h4><p>${esc({ compatibile: "Compatibile", condizioni: "Compatibile con condizioni", non_compatibile: "Non compatibile" }[s.sicurezza] || "—")} ${esc(s.sicurezza_note || "")}</p><script>print()<\/script>`);
  w.document.close();
};
const dlgNS = $("#dlg-nuova-scheda");
$("#sc-nuova").onclick = () => { ["#ns-dest", "#ns-contatto", "#ns-titolo", "#ns-data"].forEach((id) => ($(id).value = "")); dlgNS.showModal(); };
$("#ns-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const { data, error } = await sb.from("schede").insert({ destinatario: $("#ns-dest").value.trim(), contatto: $("#ns-contatto").value.trim(), titolo: $("#ns-titolo").value.trim(), data_evento: $("#ns-data").value || null, stato: "inviata", inviata_il: new Date().toISOString() }).select("*").single();
    if (error) throw error;
    dlgNS.close(); openCopyText(messaggioScheda(data, null, false)); await loadAll();
  } catch (x) { toast(errText(x)); }
});

/* ---------- convenzione con il Comune ---------- */
// anno di convenzione che contiene una data: dalla data di inizio, un anno alla volta (senza data: anno solare)
function periodoConv(d) {
  if (!S.conv.inizio) { const y = d.slice(0, 4); return { inizio: `${y}-01-01`, fine: `${y}-12-31`, n: null }; }
  const [ay, am, ad] = S.conv.inizio.split("-").map(Number), [y, m, g] = d.split("-").map(Number);
  let k = y - ay; if (m < am || (m === am && g < ad)) k--;
  const da = new Date(ay + k, am - 1, ad), a = new Date(ay + k + 1, am - 1, ad - 1);
  return { inizio: iso(da), fine: iso(a), n: k + 1 };
}
function contaComune(p, escludi) {
  const giorni = new Set(S.bookings.filter((b) => b.comune && active(b) && b.id !== escludi && b.data >= p.inizio && b.data <= p.fine).map((b) => b.data));
  const date = [...giorni].sort();
  const usate = date.filter((x) => x <= TODAY).length;
  return { date, usate, programmate: date.length - usate, totale: date.length };
}
function hintComune() {
  const d = $("#b-data").value, el = $("#b-comune-hint");
  if (!d) { el.textContent = ""; return; }
  const p = periodoConv(d), c = contaComune(p, S.editing);
  const giaQuel = c.date.includes(d);
  const n = c.totale + ($("#b-comune").checked && !giaQuel ? 1 : 0);
  el.textContent = `${p.n ? `Anno ${p.n} della convenzione` : `Anno ${d.slice(0, 4)}`}: ${$("#b-comune").checked ? `questa è la serata n. ${giaQuel ? c.date.indexOf(d) + 1 : n} di ${S.conv.serate}` : `già ${c.totale} serate su ${S.conv.serate}`}${n > S.conv.serate ? " · oltre il numero previsto!" : ""}`;
  el.style.color = n > S.conv.serate ? "var(--due-fg)" : "";
}
["#b-comune", "#b-data"].forEach((id) => $(id).addEventListener("input", hintComune));

function renderComune() {
  const el = $("#cm-body");
  const N = S.conv.serate, A = S.conv.anni;
  const impostazioni = `<div class="panel" style="margin-top:18px"><h2>Impostazioni della convenzione</h2><span class="hint">${S.isAdmin ? "Senza data di inizio le serate si contano per anno solare (1° gennaio – 31 dicembre). La data serve solo se l'anno della convenzione parte in un altro giorno: allora compare anche il riepilogo di tutti gli anni." : "Le modifica un amministratore."}</span>
    <form id="cm-form" class="form" style="margin-top:10px">
      <div class="field t"><label for="cm-inizio">Data di inizio (facoltativa)</label><input id="cm-inizio" type="date" value="${esc(S.conv.inizio || "")}"${S.isAdmin ? "" : " disabled"}></div>
      <div class="field t"><label for="cm-serate">Serate all'anno</label><input id="cm-serate" type="number" min="1" value="${N}"${S.isAdmin ? "" : " disabled"}></div>
      <div class="field t"><label for="cm-anni">Durata (anni)</label><input id="cm-anni" type="number" min="1" value="${A}"${S.isAdmin ? "" : " disabled"}></div>
      ${S.isAdmin ? `<div class="field"><div><button class="btn primary" type="submit">Salva</button></div></div>` : ""}
    </form></div>`;
  // l'anno mostrato: quello in corso, oppure quello scelto con le frecce
  const rif = S.cmAnno ? (() => { const d = parse(TODAY); d.setFullYear(d.getFullYear() + S.cmAnno); return iso(d); })() : TODAY;
  const p = periodoConv(rif), c = contaComune(p);
  const resto = N - c.totale;
  const finita = S.conv.inizio && p.n > A, nonIniziata = S.conv.inizio && p.n < 1;
  const anni = S.conv.inizio ? Array.from({ length: A }, (_, i) => { const [ay, am, ad] = S.conv.inizio.split("-").map(Number); const pi = { inizio: iso(new Date(ay + i, am - 1, ad)), fine: iso(new Date(ay + i + 1, am - 1, ad - 1)), n: i + 1 }; return { ...pi, ...contaComune(pi) }; }) : [];
  const usateTot = anni.reduce((s, x) => s + x.usate, 0);
  const sospette = S.bookings.filter((b) => !b.comune && active(b) && b.data >= p.inizio && b.data <= p.fine && /\b(comune|comunale|comunali|sindac|assessor|patrocinio)/i.test(b.titolo + " " + (b.note || "")));
  const fmtD = (d) => parse(d).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
  const serate = S.bookings.filter((b) => b.comune && active(b) && b.data >= p.inizio && b.data <= p.fine).sort(byWhen);
  el.innerHTML = `
    <div class="${S.conv.inizio ? "conv" : ""}">
      <div class="panel"><div class="cal-head" style="margin-bottom:0"><h2 style="text-transform:none">Serate del Comune ${p.n ? `· anno ${p.n}` : p.inizio.slice(0, 4)}</h2>
          <div class="cal-nav"><button class="btn sm" type="button" id="cm-prev" aria-label="Anno precedente">‹</button><button class="btn sm" type="button" id="cm-oggi">Quest'anno</button><button class="btn sm" type="button" id="cm-next" aria-label="Anno successivo">›</button></div></div>
        <span class="hint">${N} serate all'anno · dal ${fmtD(p.inizio)} al ${fmtD(p.fine)}${p.n ? ` · anno ${p.n} di ${A} della convenzione` : ""}${finita ? " · la convenzione è conclusa" : nonIniziata ? " · la convenzione non è ancora iniziata" : ""}</span>
        <div class="conv-big">
          <div><span>Usate</span><b>${c.usate}</b></div>
          <div><span>In calendario</span><b>${c.programmate}</b></div>
          <div class="${resto < 0 ? "over" : "rest"}"><span>${resto < 0 ? "Oltre il previsto" : "Rimaste"}</span><b>${Math.abs(resto)}</b></div>
        </div>
        <div class="segbar" role="img" aria-label="${c.usate} usate, ${c.programmate} in calendario, ${Math.max(0, resto)} rimaste su ${N}">
          <i class="u" style="width:${(Math.min(c.usate, N) / Math.max(N, c.totale)) * 100}%"></i><i class="p" style="width:${(Math.min(c.programmate, Math.max(0, N - c.usate)) / Math.max(N, c.totale)) * 100}%"></i>${resto < 0 ? `<i class="x" style="width:${(-resto / c.totale) * 100}%"></i>` : ""}</div>
        <div class="conv-leg"><span><i class="sw" style="background:var(--accent)"></i>usate</span><span><i class="sw" style="background:color-mix(in oklab, var(--accent) 40%, var(--surface))"></i>in calendario</span><span><i class="sw" style="background:var(--sunk);border:1px solid var(--line)"></i>rimaste (${N} all'anno)</span></div>
        <h3 style="margin-top:16px">Le serate dell'anno</h3>
        ${serate.length ? `<div class="tbl-wrap"><table><tbody>${serate.map((b, i) => `<tr class="click" data-b="${esc(b.id)}"><td class="n" style="width:2.5em">${i + 1}.</td><td style="white-space:nowrap">${esc(fmtShort(b.data))}</td><td>${esc(b.titolo)}</td><td>${b.data <= TODAY ? '<span class="pill saldato">Fatta</span>' : '<span class="pill dafare">In programma</span>'}</td></tr>`).join("")}</tbody></table></div>`
          : `<div class="hint">Nessuna serata segnata. Per contarla, apri la prenotazione e spunta «Serata del Comune».</div>`}
        ${sospette.length ? `<h3 style="margin-top:16px">Forse sono serate del Comune?</h3><span class="hint">Eventi dell'anno con «Comune», «sindaco», «assessore» o «patrocinio», non ancora segnati</span>
          <div class="blist" style="margin-top:8px">${sospette.map((b) => `<div class="req panel" style="padding:10px 12px"><div class="top-line"><span><b>${esc(fmtShort(b.data))}</b> · ${esc(b.titolo)}</span><button class="btn sm" type="button" data-segna="${esc(b.id)}">Segna come serata del Comune</button></div></div>`).join("")}</div>` : ""}
      </div>
      ${S.conv.inizio ? `<div class="panel"><h2>Tutti gli anni della convenzione</h2>
        ${S.conv.inizio ? `<span class="hint">${usateTot} serate usate finora su ${N * A} in ${A} anni · fino al ${fmtD(anni[A - 1].fine)}</span>
        <div class="tbl-wrap" style="max-height:520px;overflow:auto"><table><thead><tr><th>Anno</th><th>Periodo</th><th class="n">Usate</th><th class="n">In cal.</th><th class="n">Rimaste</th></tr></thead><tbody>
          ${anni.map((x) => `<tr class="${x.n === p.n ? "oggi" : ""}"><td>${x.n}</td><td style="white-space:nowrap">${esc(parse(x.inizio).toLocaleDateString("it-IT", { month: "short", year: "numeric" }))} – ${esc(parse(x.fine).toLocaleDateString("it-IT", { month: "short", year: "numeric" }))}</td><td class="n">${x.usate || ""}</td><td class="n">${x.programmate || ""}</td><td class="n ${N - x.totale < 0 ? "neg" : ""}">${x.fine < TODAY ? (N - x.totale > 0 ? `${N - x.totale} non usate` : N - x.totale < 0 ? `${x.totale - N} in più` : "tutte") : N - x.totale}</td></tr>`).join("")}
        </tbody></table></div>` : ""}
      </div>` : ""}
    </div>${impostazioni}`;
  $("#cm-prev").onclick = () => { S.cmAnno--; renderComune(); };
  $("#cm-next").onclick = () => { S.cmAnno++; renderComune(); };
  $("#cm-oggi").onclick = () => { S.cmAnno = 0; renderComune(); };
  el.querySelectorAll("[data-b]").forEach((r) => (r.onclick = () => openBooking(S.bookings.find((b) => b.id === r.dataset.b))));
  el.querySelectorAll("[data-segna]").forEach((btn) => (btn.onclick = async () => { btn.disabled = true; try { await run(sb.from("bookings").update({ comune: true }).eq("id", btn.dataset.segna), "Segnata come serata del Comune"); } catch (e) { btn.disabled = false; toast(errText(e)); } }));
  const f = $("#cm-form");
  if (f && S.isAdmin) f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const rec = { convenzione_inizio: $("#cm-inizio").value || null, convenzione_serate: Math.max(1, Number($("#cm-serate").value) || 25), convenzione_anni: Math.max(1, Number($("#cm-anni").value) || 20) };
    try { await run(sb.from("settings").update(rec).eq("id", 1), "Convenzione salvata"); } catch (x) { toast(errText(x)); }
  });
}

/* ---------- donazioni e donatori ---------- */
const isDonazione = (r) => r.entrate > 0 && (/^E03$/i.test(r.cod_cat) || /donaz|liberal/i.test(r.categoria + " " + r.settore));
const TIPI_DON = { azienda: "Azienda", associazione: "Associazione o gruppo", privato: "Privato", ente: "Ente" };
// tipo proposto dal nome, finché non lo si sceglie nella scheda
const tipoStimato = (nome) => (/\b(s\.?\s?r\.?\s?l|s\.?\s?p\.?\s?a|s\.?\s?n\.?\s?c|s\.?\s?a\.?\s?s)\.?\b/i.test(nome) ? "azienda"
  : /\b(gruppo|associazione|asd|aps|pallavolo|volley|danza|coro|circolo|comitato|club|scout|catechismo|alpini|pro loco)\b/i.test(nome) ? "associazione"
  : /\b(comune|parrocchia|diocesi|scuola|istituto|regione|provincia)\b/i.test(nome) ? "ente" : "");
function donatoriDa(movs) {
  const m = new Map();
  movs.filter(isDonazione).forEach((r) => {
    const nome = r.controparte || r.descrizione.replace(/^(donazione|erogazione liberale)\s*/i, "") || "Senza nome";
    const k = normT(nome);
    if (!m.has(k)) m.set(k, { chiave: k, nome, doni: [] });
    m.get(k).doni.push(r);
  });
  return [...m.values()].map((d) => {
    const info = S.donatori.find((x) => x.chiave === d.chiave) || {};
    const doni = d.doni.sort((a, b) => a.data.localeCompare(b.data));
    return { ...d, info, nome: info.nome || d.nome, tipo: info.tipo || tipoStimato(d.nome), tipoCerto: !!info.tipo, doni,
      totale: r2(doni.reduce((s, r) => s + r.entrate, 0)), prima: doni[0].data, ultima: doni[doni.length - 1].data, anni: [...new Set(doni.map((r) => +r.data.slice(0, 4)))] };
  });
}
function renderDonazioni() {
  const tutte = S.primaNota.filter(isDonazione);
  const years = [...new Set([...tutte.map((r) => +r.data.slice(0, 4)), new Date().getFullYear()])].sort();
  $("#dn-years").innerHTML = [...years.map((y) => [String(y), String(y)]), ["tutti", "Tutti gli anni"]].map(([k, l]) => `<button type="button" data-y="${k}" aria-pressed="${String(S.dnYear) === k}">${l}</button>`).join("");
  $("#dn-years").querySelectorAll("[data-y]").forEach((b) => (b.onclick = () => { S.dnYear = b.dataset.y === "tutti" ? "tutti" : +b.dataset.y; renderDonazioni(); }));
  const el = $("#dn-body");
  if (!tutte.length) { el.innerHTML = diagnosiPrimaNota("donazioni"); return; }
  const avvisoDon = S.loadErr?.donatori ? `<div class="warn" style="margin-bottom:14px">Le donazioni ci sono, ma le schede dei donatori (contatti, ringraziamenti) non si possono salvare: in Supabase manca lo script <b>008_donatori.sql</b>. (${esc(S.loadErr.donatori)})</div>` : "";
  const Y = S.dnYear === "tutti" ? null : String(S.dnYear);
  const movs = Y ? tutte.filter((r) => r.data.startsWith(Y)) : tutte;
  const donatori = donatoriDa(Y ? S.primaNota.filter((r) => r.data.startsWith(Y)) : S.primaNota).sort((a, b) => b.totale - a.totale);
  const tutti = donatoriDa(S.primaNota);
  const tot = r2(movs.reduce((s, r) => s + r.entrate, 0));
  const entrateAnno = sommaE(Y ? S.primaNota.filter((r) => r.data.startsWith(Y)) : S.primaNota);
  const fissiAnno = sommaU((Y ? S.primaNota.filter((r) => r.data.startsWith(Y)) : S.primaNota).filter((r) => r.uscite && !isVariabile(r)));
  const media = donatori.length ? tot / movs.length : 0;
  const maxDono = Math.max(0, ...movs.map((r) => r.entrate));
  // concentrazione: quota dal 20% dei donatori più generosi
  const nTop = Math.max(1, Math.ceil(donatori.length * 0.2));
  const quotaTop = tot ? donatori.slice(0, nTop).reduce((s, d) => s + d.totale, 0) / tot : 0;
  // fedeltà
  const annoPrec = Y ? String(+Y - 1) : null;
  const storico = Y && tutte.some((r) => r.data < `${Y}-01-01`); // «nuovi» e «persi» hanno senso solo con dati degli anni prima
  const nuovi = Y ? donatori.filter((d) => tutti.find((t) => t.chiave === d.chiave).prima.startsWith(Y)) : [];
  const persi = Y ? tutti.filter((t) => t.anni.includes(+annoPrec) && !t.anni.includes(+Y)) : [];
  const ricorrenti = donatori.filter((d) => tutti.find((t) => t.chiave === d.chiave).doni.length > 1);
  const daRingraziare = donatori.filter((d) => !(d.info.ringraziati || {})[Y || d.ultima.slice(0, 4)]);
  const perTipo = ["azienda", "associazione", "privato", "ente", ""].map((t) => ({ t, ds: donatori.filter((d) => d.tipo === t) })).filter((x) => x.ds.length).map((x) => ({ ...x, v: x.ds.reduce((s, d) => s + d.totale, 0) }));
  const mesi = MESI.map((m, i) => ({ m, v: Y ? movs.filter((r) => r.data.startsWith(`${Y}-${pad(i + 1)}`)).reduce((s, r) => s + r.entrate, 0) : 0 }));
  const q = S.dnQ.trim().toLowerCase();
  const lista = donatori.filter((d) => !q || (d.nome + " " + (d.info.note || "") + " " + (d.info.email || "")).toLowerCase().includes(q));
  const ins = [
    `<div class="insight"><span class="k">Peso sul bilancio</span>Le donazioni sono il <b>${pct(tot / (entrateAnno || 1))}</b> delle entrate e coprono il <b>${pct(tot / (fissiAnno || 1))}</b> dei costi fissi della struttura.</div>`,
    donatori.length >= 3 && `<div class="insight"><span class="k">Concentrazione</span>${nTop === 1 ? "Il donatore più generoso ha dato" : `I ${nTop} donatori più generosi hanno dato`} il <b>${pct(quotaTop)}</b> del totale${quotaTop > 0.5 ? ": conviene curarli con attenzione" : ""}.</div>`,
    storico && persi.length > 0 && `<div class="insight"><span class="k">Da ricontattare</span><b>${persi.length}</b> donatori del ${annoPrec} non hanno ancora donato nel ${Y}: ${persi.slice(0, 4).map((d) => `<b>${esc(d.nome)}</b>`).join(", ")}${persi.length > 4 ? "…" : ""}.</div>`,
    storico && nuovi.length > 0 && `<div class="insight"><span class="k">Nuovi donatori</span><b>${nuovi.length}</b> su ${donatori.length} hanno donato per la prima volta nel ${Y}${ricorrenti.length ? `; ${ricorrenti.length} hanno donato più volte` : ""}.</div>`,
    daRingraziare.length > 0 && `<div class="insight"><span class="k">Da ringraziare</span><b>${daRingraziare.length}</b> donatori non risultano ancora ringraziati${Y ? ` per il ${Y}` : ""}. Apri la scheda per preparare la lettera.</div>`,
  ].filter(Boolean).join("");
  el.innerHTML = avvisoDon + `
    <section class="kpis" aria-label="In sintesi">
      <div class="kpi"><span class="eyebrow">Donazioni${Y ? " " + Y : ""}</span><b>${money(tot)}</b><small>${movs.length} versamenti</small></div>
      <div class="kpi"><span class="eyebrow">Donatori</span><b>${donatori.length}</b><small>${storico ? `${nuovi.length} nuovi · ${ricorrenti.length} ricorrenti` : `${ricorrenti.length} hanno donato più volte`}</small></div>
      <div class="kpi"><span class="eyebrow">Dono medio</span><b>${money(Math.round(media))}</b><small>il più alto ${money(maxDono)}</small></div>
      <div class="kpi"><span class="eyebrow">Da ringraziare</span><b>${daRingraziare.length}</b><small>ricevute da inviare: ${donatori.filter((d) => !(d.info.ricevute || {})[Y || d.ultima.slice(0, 4)]).length}</small></div>
    </section>
    <div class="insights">${ins}</div>
    <div class="st-grid" style="margin-top:0">
      ${Y ? `<div class="panel"><h2>Donazioni mese per mese</h2><span class="hint">${Y}</span><div class="chart-wrap" id="dn-chart"></div></div>` : `<div class="panel"><h2>Donazioni per anno</h2><div class="hbars">${years.map((y) => { const v = tutte.filter((r) => r.data.startsWith(String(y))).reduce((s, r) => s + r.entrate, 0); return `<div class="hbar"><span class="nm">${y}</span><span class="v">${money(v)}</span><div class="track"><div class="fill" style="width:${(v / Math.max(1, ...years.map((yy) => tutte.filter((r) => r.data.startsWith(String(yy))).reduce((s, r) => s + r.entrate, 0)))) * 100}%"></div></div></div>`; }).join("")}</div></div>`}
      <div class="panel"><h2>Chi dona</h2><span class="hint">Per tipo di donatore${perTipo.some((x) => x.t === "") ? " · alcuni sono da classificare nella scheda" : ""}</span>
        <div class="hbars">${perTipo.sort((a, b) => b.v - a.v).map((x) => `<div class="hbar"><span class="nm">${x.t ? TIPI_DON[x.t] : "Da classificare"}</span><span class="v">${money(x.v)} · ${pct(x.v / (tot || 1))} · ${x.ds.length}</span><div class="track"><div class="fill" style="width:${(x.v / (tot || 1)) * 100}%"></div></div></div>`).join("")}</div></div>
    </div>
    <div class="panel" style="margin-top:18px"><h2>Elenco dei donatori</h2><span class="hint">Tocca un nome per contatti, note, ringraziamento e ricevuta</span>
      <div class="pn-filters"><input type="search" id="dn-q" placeholder="Cerca un donatore…" value="${esc(S.dnQ)}" aria-label="Cerca un donatore"></div>
      <div class="tbl-wrap"><table><thead><tr><th>Donatore</th><th>Tipo</th><th class="n">Versamenti</th><th class="n">Totale</th><th>Ultima donazione</th><th>Ringraziato</th><th>Ricevuta</th></tr></thead><tbody>
      ${lista.map((d) => { const anno = Y || d.ultima.slice(0, 4); const ri = (d.info.ringraziati || {})[anno], rc = (d.info.ricevute || {})[anno];
        return `<tr class="click" data-don="${esc(d.chiave)}"><td><b>${esc(d.nome)}</b>${d.info.email || d.info.telefono ? `<div class="hint">${esc([d.info.email, d.info.telefono].filter(Boolean).join(" · "))}</div>` : ""}</td>
          <td>${d.tipo ? `${TIPI_DON[d.tipo]}${d.tipoCerto ? "" : ' <span class="hint">(stimato)</span>'}` : '<span class="hint">Da classificare</span>'}</td>
          <td class="n">${d.doni.length}</td><td class="n"><b>${money(d.totale)}</b></td><td>${esc(fmtShort(d.ultima))} · ${money(d.doni[d.doni.length - 1].entrate)}</td>
          <td>${ri ? `<span class="pill saldato">Sì</span>` : `<span class="pill acconto">Da fare</span>`}</td><td>${rc ? `<span class="pill saldato">Inviata</span>` : `<span class="pill annullata">No</span>`}</td></tr>`; }).join("")}
      </tbody></table></div></div>`;
  if (Y) barChart($("#dn-chart"), mesi.map((x) => x.m), [{ name: "Donazioni", color: "var(--accent)", values: mesi.map((x) => x.v) }], (v) => eur.format(v));
  el.querySelectorAll("[data-don]").forEach((r) => (r.onclick = () => openDonatore(tutti.find((d) => d.chiave === r.dataset.don))));
  const qi = $("#dn-q"); qi.oninput = () => { S.dnQ = qi.value; clearTimeout(S._dnT); S._dnT = setTimeout(() => { renderDonazioni(); const n = $("#dn-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
}
const dlgD = $("#dlg-donatore");
function openDonatore(d) {
  S.editingDon = d;
  const anno = String(S.dnYear === "tutti" ? d.ultima.slice(0, 4) : S.dnYear);
  $("#d-head").textContent = d.nome;
  $("#d-storia").innerHTML = `${d.doni.length} ${d.doni.length === 1 ? "donazione" : "donazioni"}, totale <b>${money(d.totale)}</b>: ` + d.doni.map((r) => `${esc(parse(r.data).toLocaleDateString("it-IT"))} ${money(r.entrate)}`).join(" · ");
  $("#d-nome").value = d.info.nome || d.nome;
  $("#d-tipo").value = d.info.tipo || "";
  for (const k of ["email", "telefono", "indirizzo", "note"]) $("#d-" + k).value = d.info[k] || "";
  $("#d-ringraziato").checked = !!(d.info.ringraziati || {})[anno];
  $("#d-ricevuta").checked = !!(d.info.ricevute || {})[anno];
  $("#d-ringraziato-l").textContent = `Ringraziato per il ${anno}`;
  $("#d-ricevuta-l").textContent = `Ricevuta ${anno} inviata`;
  $("#d-error").innerHTML = "";
  dlgD.showModal();
}
$("#donatore-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = S.editingDon, anno = String(S.dnYear === "tutti" ? d.ultima.slice(0, 4) : S.dnYear);
  const ri = { ...(d.info.ringraziati || {}) }, rc = { ...(d.info.ricevute || {}) };
  if ($("#d-ringraziato").checked) ri[anno] = ri[anno] || TODAY; else delete ri[anno];
  if ($("#d-ricevuta").checked) rc[anno] = rc[anno] || TODAY; else delete rc[anno];
  const rec = { chiave: d.chiave, nome: $("#d-nome").value.trim() || d.nome, tipo: $("#d-tipo").value || null, email: $("#d-email").value.trim(), telefono: $("#d-telefono").value.trim(),
    indirizzo: $("#d-indirizzo").value.trim(), note: $("#d-note").value.trim(), ringraziati: ri, ricevute: rc, aggiornato: new Date().toISOString() };
  try { await run(sb.from("donatori").upsert(rec), "Scheda del donatore salvata"); dlgD.close(); }
  catch (x) { $("#d-error").innerHTML = `<div class="warn">${esc(errText(x))}</div>`; }
});
$("#d-lettera").onclick = () => {
  const d = S.editingDon, anno = String(S.dnYear === "tutti" ? d.ultima.slice(0, 4) : S.dnYear);
  const doni = d.doni.filter((r) => r.data.startsWith(anno));
  const tipo = $("#d-tipo").value || d.tipo, nome = $("#d-nome").value.trim() || d.nome;
  const saluto = tipo === "privato" ? `Gentile ${nome},` : `Spettabile ${nome},`;
  const importi = doni.map((r) => `${money(r.entrate)} del ${parse(r.data).toLocaleDateString("it-IT")}`).join(" e ");
  dlgD.close();
  openCopyText([
    saluto, "",
    `a nome della Sala San Tommaso Moro di Piombino Dese desideriamo ringraziarvi di cuore per la vostra erogazione liberale${importi ? ` di ${importi}` : ""}.`,
    "Il vostro sostegno ci aiuta a mantenere aperta e accogliente la sala e a proporre alla comunità cinema, teatro, danza e incontri.",
    "", "Con riconoscenza,", (S.me.nome || "").split(" ")[0] ? `${S.me.nome}\nSala San Tommaso Moro` : "Sala San Tommaso Moro",
  ].join("\n"));
};
$("#dn-export").onclick = () => {
  const ds = donatoriDa(S.primaNota).sort((a, b) => b.totale - a.totale);
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const anni = [...new Set(S.primaNota.filter(isDonazione).map((r) => r.data.slice(0, 4)))].sort();
  const righe = [["Donatore", "Tipo", "Email", "Telefono", "Indirizzo", ...anni.map((a) => "Donato " + a), "Totale", "Ultima donazione", "Ringraziato", "Ricevuta", "Note"].join(";"),
    ...ds.map((d) => [cell(d.nome), cell(d.tipo ? TIPI_DON[d.tipo] : ""), cell(d.info.email), cell(d.info.telefono), cell(d.info.indirizzo),
      ...anni.map((a) => String(r2(d.doni.filter((r) => r.data.startsWith(a)).reduce((s, r) => s + r.entrate, 0))).replace(".", ",")),
      String(d.totale).replace(".", ","), d.ultima, cell(Object.keys(d.info.ringraziati || {}).join(", ")), cell(Object.keys(d.info.ricevute || {}).join(", ")), cell(d.info.note)].join(";"))];
  download(`sala-stm-donatori-${TODAY}.csv`, "﻿" + righe.join("\r\n"), "text/csv");
  toast("Elenco dei donatori scaricato");
};

/* ---------- sopralluoghi ---------- */
const SOP_STATI = { da_fare: "Da fare", fatto: "Fatto", annullato: "Annullato" };
const ESIGENZE = ["Proiettore e schermo", "Audio e microfoni", "Luci di scena", "Palco", "Sedie e tavoli", "Accessibilità", "Riscaldamento / aria condizionata", "Spazio per rinfresco", "Parcheggio"];
const INDIRIZZO = "via Roma 108, Piombino Dese";
const sopOnDay = (d) => S.sopralluoghi.filter((x) => x.data === d && x.stato !== "annullato").sort((a, b) => a.ora.localeCompare(b.ora));
const personName = (id) => { const p = S.profiles.find((x) => x.id === id); return p ? p.nome || p.email : id === S.me?.id ? S.me.nome || "tu" : ""; };
const SOP_FILTERS = [
  ["prossimi", "In programma", (x) => x.stato === "da_fare" && x.data >= TODAY],
  ["fatti", "Fatti", (x) => x.stato === "fatto"],
  ["scaduti", "Da aggiornare", (x) => x.stato === "da_fare" && x.data < TODAY],
  ["annullati", "Annullati", (x) => x.stato === "annullato"],
];
function renderSopralluoghi() {
  $("#btn-sop").hidden = !S.canWrite;
  $("#sop-filters").innerHTML = SOP_FILTERS.map(([k, l, f]) => `<button type="button" data-f="${k}" aria-pressed="${S.sopFilter === k}">${l}<span class="c">${S.sopralluoghi.filter(f).length}</span></button>`).join("");
  $("#sop-filters").querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { S.sopFilter = b.dataset.f; renderSopralluoghi(); }));
  const list = S.sopralluoghi.filter(SOP_FILTERS.find((x) => x[0] === S.sopFilter)[2]).sort((a, b) => (a.data + a.ora).localeCompare(b.data + b.ora));
  if (S.sopFilter !== "prossimi") list.reverse();
  const el = $("#sopralluoghi");
  if (!list.length) {
    el.innerHTML = `<div class="empty">${S.sopFilter === "prossimi"
      ? (S.canWrite ? "Nessun sopralluogo in programma. Fissane uno con «+ Nuovo sopralluogo», dal calendario o da una richiesta arrivata per email." : "Nessun sopralluogo in cui accompagni qualcuno.")
      : "Nessun sopralluogo in questo elenco."}</div>`;
    return;
  }
  el.innerHTML = `<div class="blist">${list.map((x) => {
    const d = parse(x.data);
    const busy = x.data_evento ? S.bookings.filter((b) => active(b) && b.data === x.data_evento) : [];
    const acc = x.accompagnatore_id ? personName(x.accompagnatore_id) : "";
    return `<article class="panel sop-card">
      <div class="sop-when"><span>${esc(d.toLocaleDateString("it-IT", { weekday: "short" }))}</span><b>${d.getDate()}</b><span>${esc(d.toLocaleDateString("it-IT", { month: "short" }))}</span><span class="h">${x.ora}</span></div>
      <div class="sop-body">
        <div class="t">${esc(x.nome)}${x.ente ? ` <span class="m">· ${esc(x.ente)}</span>` : ""}</div>
        ${x.evento || x.data_evento ? `<div class="m">${esc(x.evento || "Evento")}${x.data_evento ? ` · ${esc(fmtShort(x.data_evento))} <span class="pill ${busy.length ? "dapagare" : "saldato"}">${busy.length ? "data già occupata" : "data libera"}</span>` : ""}</div>` : ""}
        ${x.telefono || x.email ? `<div class="m">${esc([x.telefono, x.email].filter(Boolean).join(" · "))}</div>` : ""}
        <div class="m">${acc ? `Accompagna: <b>${esc(acc)}</b>` : `<span style="color:var(--opz-fg)">Nessuno ancora incaricato di accompagnare</span>`} · ${x.durata_min} min</div>
        ${x.esigenze.length ? `<div class="tags">${x.esigenze.map((e) => `<span class="tag">${esc(e)}</span>`).join("")}</div>` : ""}
        ${x.esito ? `<div class="m">${esc(x.esito)}</div>` : ""}
        <div class="btns" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <span class="pill ${x.stato === "fatto" ? "saldato" : x.stato === "annullato" ? "annullata" : "dafare"}">${SOP_STATI[x.stato]}</span>
          <button class="btn sm" type="button" data-open-sop="${esc(x.id)}">${S.canWrite || x.accompagnatore_id === S.me.id ? "Apri" : "Dettagli"}</button>
          ${x.stato === "da_fare" && (S.canWrite || x.accompagnatore_id === S.me.id) ? `<button class="btn sm" type="button" data-done="${esc(x.id)}">Segna come fatto</button>` : ""}
          ${S.canWrite && x.stato === "da_fare" ? `<button class="btn sm" type="button" data-msg="${esc(x.id)}">Messaggio di conferma</button>` : ""}
          ${S.canWrite && !x.booking_id && x.stato !== "annullato" ? `<button class="btn sm" type="button" data-book="${esc(x.id)}">Crea prenotazione</button>` : ""}
          ${x.booking_id ? `<span class="hint">Prenotazione creata</span>` : ""}
        </div>
      </div>
    </article>`;
  }).join("")}</div>`;
  const find = (id) => S.sopralluoghi.find((x) => x.id === id);
  el.querySelectorAll("[data-open-sop]").forEach((b) => (b.onclick = () => openSop(find(b.dataset.openSop))));
  el.querySelectorAll("[data-done]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await run(sb.from("sopralluoghi").update({ stato: "fatto", aggiornato: new Date().toISOString() }).eq("id", b.dataset.done), "Sopralluogo segnato come fatto"); } catch (e) { b.disabled = false; toast(errText(e)); }
  }));
  el.querySelectorAll("[data-msg]").forEach((b) => (b.onclick = () => openCopyText(sopMessage(find(b.dataset.msg)))));
  el.querySelectorAll("[data-book]").forEach((b) => (b.onclick = () => {
    const x = find(b.dataset.book);
    openBooking(null, x.data_evento || TODAY, {
      titolo: x.evento || `Evento ${x.ente || x.nome}`, referente: x.nome, telefono: x.telefono, email: x.email, tipo: "",
      note: [x.esigenze.length ? "Esigenze: " + x.esigenze.join(", ") + "." : "", x.esito].filter(Boolean).join("\n"),
    });
    S.sopToBook = x.id;
  }));
}
function sopMessage(x) {
  const giorno = fmtDay(x.data, { weekday: "long", day: "numeric", month: "long" });
  const acc = x.accompagnatore_id ? personName(x.accompagnatore_id) : "";
  const firma = (S.me.nome || "").split(" ")[0];
  return [
    `Buongiorno ${x.nome.split(" ")[0]},`,
    `le confermo il sopralluogo alla Sala San Tommaso Moro (${INDIRIZZO}) ${giorno} alle ${x.ora}.`,
    acc && acc !== S.me.nome ? `Ad accoglierla ci sarà ${acc}.` : "",
    x.esigenze.length ? `Potremo vedere insieme: ${x.esigenze.join(", ").toLowerCase()}.` : "",
    "Se dovesse cambiare qualcosa, può rispondere a questo messaggio.",
    `Grazie, a presto${firma ? "\n" + firma : ""}`,
  ].filter(Boolean).join("\n");
}

const dlgS = $("#dlg-sop");
function openSop(x, prefill) {
  if (!x && !S.canWrite) return;
  S.editingSop = x ? x.id : null;
  const v = x || { data: TODAY, ora: "17:00", durata_min: 30, nome: "", ente: "", telefono: "", email: "", evento: "", data_evento: "", accompagnatore_id: S.me.id, esigenze: [], stato: "da_fare", esito: "", richiesta_id: null, ...(prefill || {}) };
  S.sopFromRequest = x ? null : v.richiesta_id || null;
  $("#s-head").textContent = x ? `Sopralluogo · ${x.nome}` : "Nuovo sopralluogo";
  for (const k of ["data", "ora", "nome", "ente", "telefono", "email", "evento", "data_evento", "stato", "esito"]) $("#s-" + k).value = v[k] ?? "";
  $("#s-durata").value = String(v.durata_min || 30);
  const people = S.profiles.filter((p) => ["admin", "coordinatore", "volontario"].includes(p.ruolo));
  const opts = people.length ? people : [S.me];
  $("#s-accomp").innerHTML = `<option value="">Da decidere</option>` + opts.map((p) => `<option value="${esc(p.id)}"${p.id === v.accompagnatore_id ? " selected" : ""}>${esc(p.nome || p.email)}</option>`).join("")
    + (v.accompagnatore_id && !opts.some((p) => p.id === v.accompagnatore_id) ? `<option value="${esc(v.accompagnatore_id)}" selected>${esc(personName(v.accompagnatore_id) || "Volontario")}</option>` : "");
  $("#s-esigenze").innerHTML = ESIGENZE.map((e, i) => `<label><input type="checkbox" id="s-es-${i}" value="${esc(e)}"${v.esigenze.includes(e) ? " checked" : ""}> ${esc(e)}</label>`).join("");
  const readOnly = !S.canWrite && !(x && x.accompagnatore_id === S.me.id);
  const volunteer = !S.canWrite;
  dlgS.querySelectorAll("input,select,textarea").forEach((el) => (el.disabled = readOnly));
  if (volunteer && !readOnly) ["#s-data", "#s-ora", "#s-durata", "#s-nome", "#s-ente", "#s-telefono", "#s-email", "#s-accomp"].forEach((id) => ($(id).disabled = true));
  $("#s-submit").hidden = readOnly;
  $("#s-error").innerHTML = "";
  renderDeleteArea("#s-delete-area", !!x && S.canWrite, async () => { await run(sb.from("sopralluoghi").delete().eq("id", x.id), "Sopralluogo eliminato"); dlgS.close(); });
  checkSop();
  dlgS.showModal();
}
function checkSop() {
  const d = $("#s-data").value, o = $("#s-ora").value, dur = Number($("#s-durata").value) || 30;
  const fine = o ? addMin(o, dur) : "";
  const clash = d && o ? S.bookings.filter((b) => active(b) && b.data === d && !b.giornata_intera && b.inizio < fine && o < b.fine) : [];
  const allDay = d ? S.bookings.filter((b) => active(b) && b.data === d && b.giornata_intera) : [];
  const other = d && o ? S.sopralluoghi.filter((x) => x.id !== S.editingSop && x.stato !== "annullato" && x.data === d && x.ora < fine && o < addMin(x.ora, x.durata_min)) : [];
  $("#s-avail").innerHTML = clash.length || other.length
    ? `<div class="warn">In quell'orario la sala è occupata: ${[...clash.map((b) => `${esc(b.titolo)} (${b.inizio}–${b.fine})`), ...other.map((x) => `sopralluogo con ${esc(x.nome)} alle ${x.ora}`)].join("; ")}</div>`
    : d && o ? `<div class="ok-note">Sala libera dalle ${o} alle ${fine}${allDay.length ? ` · in giornata: ${allDay.map((b) => esc(b.titolo)).join(", ")}` : ""}</div>` : "";
  const de = $("#s-data_evento").value;
  const busy = de ? S.bookings.filter((b) => active(b) && b.data === de) : [];
  $("#s-evento-avail").innerHTML = de ? (busy.length
    ? `<div class="warn">Il ${esc(fmtShort(de))} la sala è già impegnata: ${busy.map((b) => `${esc(b.titolo)} (${orario(b).toLowerCase()})`).join("; ")}</div>`
    : `<div class="ok-note">Il ${esc(fmtShort(de))} la sala è libera</div>`) : "";
}
["#s-data", "#s-ora", "#s-durata", "#s-data_evento"].forEach((id) => $(id).addEventListener("input", checkSop));
$("#btn-sop").onclick = () => openSop(null);
$("#sop-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const g = (k) => $("#s-" + k).value.trim();
  const rec = {
    data: g("data"), ora: g("ora"), durata_min: Number(g("durata")) || 30, nome: g("nome"), ente: g("ente"), telefono: g("telefono"), email: g("email"),
    evento: g("evento"), data_evento: g("data_evento") || null, accompagnatore_id: $("#s-accomp").value || null, stato: g("stato"), esito: g("esito"),
    esigenze: [...$("#s-esigenze").querySelectorAll("input:checked")].map((i) => i.value), aggiornato: new Date().toISOString(),
  };
  if (!S.canWrite) for (const k of ["data", "ora", "durata_min", "nome", "ente", "telefono", "email", "accompagnatore_id"]) delete rec[k];
  const err = S.canWrite && !rec.nome ? "Scrivi chi viene al sopralluogo." : S.canWrite && (!rec.data || !rec.ora) ? "Scegli giorno e ora." : "";
  if (err) { $("#s-error").innerHTML = `<div class="warn">${err}</div>`; return; }
  const btn = $("#s-submit"); btn.disabled = true;
  try {
    if (S.editingSop) await run(sb.from("sopralluoghi").update(rec).eq("id", S.editingSop), "Sopralluogo aggiornato");
    else {
      await run(sb.from("sopralluoghi").insert({ ...rec, richiesta_id: S.sopFromRequest }), "Sopralluogo fissato");
      if (S.sopFromRequest) await run(sb.from("richieste").update({ stato: "convertita" }).eq("id", S.sopFromRequest));
    }
    dlgS.close();
  } catch (x) { $("#s-error").innerHTML = `<div class="warn">${esc(errText(x))}</div>`; }
  finally { btn.disabled = false; }
});

/* ---------- cassa ---------- */
const CASSA_NUM = ["fondo_iniziale", "online_euro", "contanti_euro", "pos_euro", "contati", "prelievo", "fondo_finale"];
const CASSA_INT = ["online_n", "contanti_n", "pos_n", "omaggi_n"];
const TAGLI = [100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05];
const mapCassa = (r) => {
  const c = { ...r, conteggio: r.conteggio || {} };
  for (const k of CASSA_NUM) c[k] = r[k] == null ? null : Number(r[k]);
  for (const k of CASSA_INT) c[k] = Number(r[k]) || 0;
  return c;
};
const totBiglietti = (c) => (c.online_euro || 0) + (c.contanti_euro || 0) + (c.pos_euro || 0);
const spettatori = (c) => c.online_n + c.contanti_n + c.pos_n + c.omaggi_n;
const bigliettiDal = (prefix) => S.cassa.filter((c) => c.data.startsWith(prefix)).reduce((s, c) => s + totBiglietti(c), 0);
const r2 = (v) => Math.round(v * 100) / 100;
const latestClosed = (exceptId) => S.cassa.filter((c) => c.stato === "chiusa" && c.id !== exceptId)
  .sort((a, b) => (b.data + (b.chiuso_il || b.creato)).localeCompare(a.data + (a.chiuso_il || a.creato)))[0];
const cassaTitle = (c) => c.titolo || (S.bookings.find((b) => b.id === c.booking_id) || {}).titolo || "Cassa";
function quadratura(c) {
  if (c.contati == null) return null;
  return r2(c.contati - ((c.fondo_iniziale || 0) + (c.contanti_euro || 0)));
}

function renderCassa() {
  const last = latestClosed();
  const open = S.cassa.filter((c) => c.stato === "aperta");
  $("#fondo-attuale").textContent = money(last ? last.fondo_finale : 0);
  $("#fondo-hint").textContent = last ? `dopo la chiusura del ${fmtShort(last.data)} · ${cassaTitle(last)}` : "nessuna cassa chiusa finora";
  if (open.length) $("#fondo-hint").textContent += ` · ${open.length} ${open.length > 1 ? "casse aperte" : "cassa aperta"}`;
  const el = $("#cassa-list");
  if (!S.cassa.length) {
    el.innerHTML = `<div class="empty">Nessuna cassa registrata. A inizio serata premi «+ Apri cassa»: il fondo iniziale viene proposto in automatico.</div>`;
    return;
  }
  const rows = [...S.cassa].sort((a, b) => (b.data + b.creato).localeCompare(a.data + a.creato));
  el.innerHTML = `<table><thead><tr><th>Data</th><th>Evento</th><th class="n">Spett.</th><th class="n">Online</th><th class="n">Contanti</th><th class="n">POS</th><th class="n">Totale</th><th>Quadratura</th>${S.canWrite ? "<th>C1</th>" : ""}<th class="n">Nuovo saldo</th></tr></thead><tbody>
    ${rows.map((c) => {
      const q = quadratura(c);
      const pill = c.stato === "aperta" ? '<span class="pill acconto">Aperta</span>'
        : q == null ? '<span class="pill annullata">Non contata</span>'
        : Math.abs(q) < 0.005 ? '<span class="pill saldato">Quadra</span>'
        : `<span class="pill dapagare">${q > 0 ? "+" : "−"}${money(Math.abs(q))}</span>`;
      return `<tr class="click" data-c="${esc(c.id)}"><td>${esc(fmtShort(c.data))}</td><td>${esc(cassaTitle(c))}</td><td class="n">${spettatori(c)}</td><td class="n">${money(c.online_euro)}</td><td class="n">${money(c.contanti_euro)}</td><td class="n">${money(c.pos_euro)}</td><td class="n"><b>${money(totBiglietti(c))}</b></td><td>${pill}</td>${S.canWrite ? `<td>${c1Pill(c1CheckDay(c.data))}</td>` : ""}<td class="n">${c.stato === "chiusa" ? money(c.fondo_finale) : "—"}</td></tr>`;
    }).join("")}</tbody></table>`;
  el.querySelectorAll("[data-c]").forEach((r) => (r.onclick = () => openCassa(S.cassa.find((c) => c.id === r.dataset.c))));
}

const dlgK = $("#dlg-cassa");
const numVal = (id) => { const v = $(id).value; return v === "" ? null : Number(v); };
function fillEventOptions(date, selectedId) {
  const evs = S.bookings.filter((b) => b.data === date && active(b)).sort(byWhen);
  $("#c-evento").innerHTML = evs.map((b) => `<option value="${esc(b.id)}"${b.id === selectedId ? " selected" : ""}>${esc(b.titolo)}${b.giornata_intera ? "" : " · " + b.inizio}</option>`).join("")
    + `<option value=""${!selectedId && evs.length ? "" : " selected"}>Altro (scrivi il titolo)</option>`;
  if (!selectedId && evs.length) $("#c-evento").value = evs[0].id;
  $("#c-titolo-wrap").hidden = $("#c-evento").value !== "";
}
function openCassaFor(date) {
  const existing = S.cassa.find((c) => c.data === date && c.stato === "aperta");
  openCassa(existing || null, date);
}
function openCassa(c, date) {
  if (!S.canCassa) return;
  S.editingCassa = c ? c.id : null;
  const prev = latestClosed(c && c.id);
  const v = c || { data: date || TODAY, booking_id: null, titolo: "", fondo_iniziale: prev ? prev.fondo_finale : 0, online_n: 0, online_euro: 0, contanti_n: 0, contanti_euro: 0, pos_n: 0, pos_euro: 0, omaggi_n: 0, contati: null, conteggio: {}, prelievo: 0, note: "", stato: "aperta" };
  $("#c-head").textContent = c ? `Cassa · ${fmtShort(v.data)}` : "Apri cassa";
  $("#c-data").value = v.data;
  fillEventOptions(v.data, v.booking_id);
  $("#c-titolo").value = v.titolo || "";
  for (const k of ["fondo_iniziale", ...CASSA_INT, "online_euro", "contanti_euro", "pos_euro", "prelievo"]) {
    const el = $("#c-" + (k === "fondo_iniziale" ? "fondo" : k));
    el.value = v[k] || v[k] === 0 ? (v[k] === 0 && !c && k !== "fondo_iniziale" && k !== "prelievo" ? "" : v[k]) : "";
    el.dataset.manual = c ? "1" : "";
  }
  $("#c-contati").value = v.contati == null ? "" : v.contati;
  $("#c-note").value = v.note || "";
  $("#c-fondo-hint").textContent = c ? "" : prev ? `Proposto dal saldo della cassa del ${fmtShort(prev.data)}` : "Prima cassa: inserisci quanto c'è nel cassetto";
  $("#c-prezzo-hint").textContent = S.prezzoBiglietto ? `Con il numero di biglietti l'importo si calcola a ${money(S.prezzoBiglietto)} l'uno; puoi correggerlo` : "";
  renderConteggio(v.conteggio || {});
  $("#c-conteggio").hidden = !Object.values(v.conteggio || {}).some((n) => n > 0);
  const locked = c && c.stato === "chiusa" && !S.isAdmin;
  dlgK.querySelectorAll("input,select,textarea").forEach((el) => (el.disabled = locked));
  $("#c-save").hidden = locked; $("#c-close").hidden = locked || (c && c.stato === "chiusa");
  $("#c-save").textContent = c && c.stato === "chiusa" ? "Salva modifiche" : "Salva";
  $("#c-status").textContent = c && c.stato === "chiusa"
    ? `Chiusa il ${new Date(c.chiuso_il || c.aggiornato).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${S.isAdmin ? " · da amministratore puoi ancora correggerla" : ""}` : "";
  $("#c-error").innerHTML = "";
  renderDeleteArea("#c-delete-area", !!c && S.isAdmin, async () => { await run(sb.from("cassa").delete().eq("id", c.id), "Cassa eliminata"); dlgK.close(); });
  calcCassa();
  dlgK.showModal();
}
function renderConteggio(cont) {
  $("#c-conteggio").innerHTML = TAGLI.map((t) => `<label><span>${t >= 1 ? t + " €" : Math.round(t * 100) + " cent"}</span>× <input type="number" min="0" step="1" inputmode="numeric" data-taglio="${t}" value="${cont[t] || ""}" aria-label="Pezzi da ${t} euro"></label>`).join("")
    + `<div class="tot"><span>Totale contato: <b id="c-cont-tot" class="num"></b></span><button class="btn sm" type="button" id="c-cont-use">Usa come contanti contati</button></div>`;
  $("#c-conteggio").querySelectorAll("[data-taglio]").forEach((i) => i.addEventListener("input", () => { updateConteggio(true); }));
  $("#c-cont-use").onclick = () => { updateConteggio(true); };
  updateConteggio(false);
}
function readConteggio() {
  const out = {};
  $("#c-conteggio").querySelectorAll("[data-taglio]").forEach((i) => { const n = Number(i.value) || 0; if (n > 0) out[i.dataset.taglio] = n; });
  return out;
}
function updateConteggio(apply) {
  const tot = r2(Object.entries(readConteggio()).reduce((s, [t, n]) => s + Number(t) * n, 0));
  $("#c-cont-tot").textContent = money(tot);
  if (apply && tot > 0) { $("#c-contati").value = tot; calcCassa(); }
}
$("#c-conta-toggle").onclick = () => { $("#c-conteggio").hidden = !$("#c-conteggio").hidden; };
function readCassa() {
  const g = (k) => numVal("#c-" + k) || 0;
  const rec = {
    data: $("#c-data").value, booking_id: $("#c-evento").value || null,
    titolo: $("#c-evento").value ? "" : $("#c-titolo").value.trim(),
    fondo_iniziale: g("fondo"), online_n: g("online_n"), online_euro: g("online_euro"), contanti_n: g("contanti_n"), contanti_euro: g("contanti_euro"),
    pos_n: g("pos_n"), pos_euro: g("pos_euro"), omaggi_n: g("omaggi_n"),
    contati: numVal("#c-contati"), conteggio: readConteggio(), prelievo: g("prelievo"), note: $("#c-note").value.trim(),
  };
  const attesi = r2(rec.fondo_iniziale + rec.contanti_euro);
  rec.fondo_finale = r2((rec.contati == null ? attesi : rec.contati) - rec.prelievo);
  return rec;
}
function calcCassa() {
  const c = readCassa();
  const attesi = r2(c.fondo_iniziale + c.contanti_euro);
  $("#c-tot-n").textContent = `${spettatori(c)} spett.`;
  $("#c-tot-euro").textContent = money(totBiglietti(c));
  $("#c-attesi").textContent = money(attesi);
  const box = $("#c-diff-box");
  box.classList.remove("ok", "ko");
  if (c.contati == null) { $("#c-diff").textContent = "—"; $("#c-diff-txt").textContent = "inserisci i contanti contati"; }
  else {
    const d = r2(c.contati - attesi);
    $("#c-diff").textContent = Math.abs(d) < 0.005 ? "Quadra" : (d > 0 ? "+" : "−") + money(Math.abs(d));
    $("#c-diff-txt").textContent = Math.abs(d) < 0.005 ? "i contanti corrispondono" : d > 0 ? "in cassa ci sono più soldi del previsto" : "in cassa mancano dei soldi";
    box.classList.add(Math.abs(d) < 0.005 ? "ok" : "ko");
  }
  $("#c-saldo").textContent = money(c.fondo_finale);
}
["online", "contanti", "pos"].forEach((k) => {
  $(`#c-${k}_n`).addEventListener("input", () => {
    const e = $(`#c-${k}_euro`);
    if (S.prezzoBiglietto && !e.dataset.manual) e.value = r2((Number($(`#c-${k}_n`).value) || 0) * S.prezzoBiglietto) || "";
    calcCassa();
  });
  $(`#c-${k}_euro`).addEventListener("input", (ev) => { ev.target.dataset.manual = ev.target.value === "" ? "" : "1"; calcCassa(); });
});
["#c-fondo", "#c-omaggi_n", "#c-contati", "#c-prelievo"].forEach((id) => $(id).addEventListener("input", calcCassa));
$("#c-data").addEventListener("change", () => fillEventOptions($("#c-data").value, null));
$("#c-evento").addEventListener("change", () => { $("#c-titolo-wrap").hidden = $("#c-evento").value !== ""; });

async function saveCassa(close) {
  const rec = readCassa();
  const prevRec = S.cassa.find((c) => c.id === S.editingCassa);
  if (!rec.data) { $("#c-error").innerHTML = `<div class="warn">Scegli la data.</div>`; return; }
  if (!rec.booking_id && !rec.titolo) { $("#c-error").innerHTML = `<div class="warn">Scegli l'evento o scrivi un titolo.</div>`; return; }
  if (close && rec.contati == null) { $("#c-error").innerHTML = `<div class="warn">Per chiudere la cassa inserisci i contanti contati.</div>`; $("#c-contati").focus(); return; }
  if (close) Object.assign(rec, { stato: "chiusa", chiuso_da: S.me.id, chiuso_il: new Date().toISOString() });
  rec.aggiornato = new Date().toISOString();
  const btns = [$("#c-save"), $("#c-close")]; btns.forEach((b) => (b.disabled = true));
  try {
    if (prevRec) await run(sb.from("cassa").update(rec).eq("id", prevRec.id), close ? "Cassa chiusa" : "Cassa salvata");
    else {
      const { data, error } = await sb.from("cassa").insert({ ...rec, creato_da: S.me.id }).select("id").single();
      if (error) throw error;
      S.editingCassa = data.id;
      toast(close ? "Cassa chiusa" : "Cassa aperta e salvata");
      await loadAll();
    }
    if (close) { dlgK.close(); openCopyText(riepilogoCassa(S.cassa.find((c) => c.id === S.editingCassa) || { ...rec, id: S.editingCassa })); }
    else dlgK.close();
  } catch (x) { $("#c-error").innerHTML = `<div class="warn">${esc(errText(x))}</div>`; }
  finally { btns.forEach((b) => (b.disabled = false)); }
}
$("#cassa-form").addEventListener("submit", (e) => { e.preventDefault(); saveCassa(false); });
$("#c-close").onclick = () => saveCassa(true);
$("#c-copy").onclick = () => { const c = readCassa(); openCopyText(riepilogoCassa({ ...c, stato: "bozza" })); };
$("#btn-cassa").onclick = () => openCassaFor(TODAY);

function riepilogoCassa(c) {
  const q = quadratura(c);
  return [
    `*Cassa · ${cassaTitle(c)}*`,
    fmtDay(c.data),
    "",
    `Fondo iniziale: ${money(c.fondo_iniziale)}`,
    `Online: ${c.online_n} biglietti · ${money(c.online_euro)}`,
    `Botteghino contanti: ${c.contanti_n} · ${money(c.contanti_euro)}`,
    `Botteghino POS: ${c.pos_n} · ${money(c.pos_euro)}`,
    c.omaggi_n ? `Omaggi: ${c.omaggi_n}` : null,
    `*Totale incasso: ${money(totBiglietti(c))}* · ${spettatori(c)} spettatori`,
    "",
    `Contanti attesi: ${money((c.fondo_iniziale || 0) + (c.contanti_euro || 0))}`,
    c.contati == null ? "Contanti contati: da contare" : `Contanti contati: ${money(c.contati)} (${Math.abs(q) < 0.005 ? "quadra" : (q > 0 ? "+" : "−") + money(Math.abs(q))})`,
    c.prelievo ? `Prelevato: ${money(c.prelievo)}` : null,
    `*Nuovo saldo cassa: ${money(c.fondo_finale)}*`,
    c.note ? `Note: ${c.note}` : null,
  ].filter((x) => x !== null).join("\n");
}

/* ---------- spese e tariffe ---------- */
function openExpense(x) {
  S.editingExp = x ? x.id : null;
  const v = x || { data: TODAY, categoria: "Utenze", descrizione: "", importo: "" };
  $("#e-head").textContent = x ? "Spesa" : "Registra spesa";
  for (const k of ["data", "categoria", "descrizione", "importo"]) $("#e-" + k).value = v[k] ?? "";
  $("#e-error").innerHTML = "";
  renderDeleteArea("#e-delete-area", !!x, async () => { await run(sb.from("expenses").delete().eq("id", x.id), "Spesa eliminata"); dlgE.close(); });
  dlgE.showModal();
}
$("#btn-exp").onclick = () => openExpense(null);
$("#expense-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const rec = { data: $("#e-data").value, categoria: $("#e-categoria").value, descrizione: $("#e-descrizione").value.trim(), importo: Number($("#e-importo").value) || 0 };
  if (!rec.data || !(rec.importo > 0)) { $("#e-error").innerHTML = `<div class="warn">Inserisci data e importo.</div>`; return; }
  try {
    if (S.editingExp) await run(sb.from("expenses").update(rec).eq("id", S.editingExp), "Spesa salvata");
    else await run(sb.from("expenses").insert(rec), "Spesa salvata");
    dlgE.close(); S.year = +rec.data.slice(0, 4); render();
  } catch (x) { $("#e-error").innerHTML = `<div class="warn">${esc(errText(x))}</div>`; }
});
$("#rates-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = { prezzo_biglietto: $("#r-biglietto").value === "" ? null : Number($("#r-biglietto").value) };
  if (S.tariffeDb) r.tariffe = { ...Object.fromEntries(["galleria", "platea", "tutta", "iva", "biglietteria", "tappeto", "commerciale"].map((k) => [k, Number($("#r-" + k).value) || 0])), iva_supplementi: $("#r-iva-supp").checked, costi_annui: S.tariffe.costi_annui ?? null, giornate_annue: S.tariffe.giornate_annue ?? null };
  try { await run(sb.from("settings").update(r).eq("id", 1), "Tariffe salvate"); } catch (x) { toast(errText(x)); }
});

/* ---------- esportazione (backup) ---------- */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#btn-export").onclick = () => {
  const stamp = TODAY;
  download(`sala-stm-backup-${stamp}.json`, JSON.stringify({ esportato: new Date().toISOString(), prenotazioni: S.bookings, iscrizioni: S.signups, spese: S.expenses, cassa: S.cassa, sopralluoghi: S.sopralluoghi, film: S.films, proiezioni: S.proiezioni, c1: S.c1, prima_nota: S.primaNota, donatori: S.donatori, schede: S.schede, tariffe: S.tariffe, persone: S.profiles }, null, 2), "application/json");
  const cols = ["data", "inizio", "fine", "titolo", "tipo", "referente", "telefono", "email", "stato", "prezzo", "incassato", "note"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(";"), ...[...S.bookings].sort(byWhen).map((b) => cols.map((c) => (typeof b[c] === "number" ? String(b[c]).replace(".", ",") : cell(b[c]))).join(";"))].join("\r\n");
  download(`sala-stm-prenotazioni-${stamp}.csv`, "﻿" + csv, "text/csv");
  toast("Backup scaricato");
};

/* ---------- navigazione ---------- */
$("#btn-new").onclick = () => openBooking(null, S.view === "calendario" ? S.selected : TODAY);
$("#cal-prev").onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); renderCalendar(); };
$("#cal-next").onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); renderCalendar(); };
$("#cal-today").onclick = () => { S.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); S.selected = TODAY; renderCalendar(); renderDay(); };
$("#q").addEventListener("input", (e) => { S.q = e.target.value; renderList(); });
$("#toggle-table").onclick = () => { S.showTable = !S.showTable; renderEconomy(); };
/* ---------- sito web: confronto tra www.salasantommasomoro.it e il programma ---------- */
const TIPI_SITO = { manca: "Da aggiungere", orario: "Orario da correggere", giorno: "Date scritte male", annullato: "Annullati ancora online", home: "Home da aggiornare", verifica: "Sul sito ma non in calendario" };
let sitoMod = null, sitoPagine = null;
async function controllaSito() {
  S.sito.stato = "carico";
  if (S.view === "sito") renderSito();
  try {
    sitoMod = sitoMod || (await import(`./sito.js?v=${VERSIONE}`));
    const r = await fetch(sitoMod.SITO_API, { cache: "no-store" });
    if (!r.ok) throw new Error("il sito risponde " + r.status);
    sitoPagine = await r.json();
    S.sito = { ...S.sito, stato: "ok", err: "", letto: new Date().toISOString(), pagine: sitoPagine.length };
  } catch (e) {
    S.sito = { ...S.sito, stato: "errore", err: e.message || String(e) };
  }
  confrontaSito();
  render();
}
// rifà il confronto con i dati attuali dell'app (senza rileggere il sito)
function confrontaSito() {
  if (!sitoMod || !sitoPagine) return;
  const app = [
    ...S.proiezioni.map((p) => { const f = S.films.find((x) => x.id === p.film_id); return f && { data: p.data, ora: p.ora, titolo: f.titolo, tipo: "cinema" }; }).filter(Boolean),
    ...S.bookings.map((b) => ({ data: b.data, ora: b.giornata_intera ? "" : b.inizio, titolo: b.titolo, tipo: "evento", annullato: b.stato === "annullata" })),
  ];
  S.sito.voci = sitoMod.confronta(sitoMod.appuntamentiDelSito(sitoPagine, TODAY), app, TODAY);
}
const sitoIgnorate = () => new Set((S.sitoCfg && S.sitoCfg.ignora) || []);
const sitoAvvisate = () => new Set((S.sitoCfg && S.sitoCfg.avvisati) || []);
// segnalazioni da mostrare: senza quelle ignorate; «nuove» = non ancora mandate a chi aggiorna il sito
const sitoVisibili = () => S.sito.voci.filter((v) => !sitoIgnorate().has(v.chiave));
const sitoNuovi = () => (S.canWrite ? sitoVisibili().filter((v) => v.tipo !== "verifica" && !sitoAvvisate().has(v.chiave)) : []);

function renderSito() {
  if (sitoPagine) confrontaSito();
  const el = $("#sito-body"), cfg = S.sitoCfg, chi = (cfg && cfg.nome) || "chi aggiorna il sito";
  const avvisate = sitoAvvisate(), ignorate = sitoIgnorate();
  const voci = sitoVisibili(), nascoste = S.sito.voci.filter((v) => ignorate.has(v.chiave));
  // selezione predefinita: le nuove (le «da verificare» riguardano il calendario della sala, non il sito)
  for (const v of voci) if (!(v.chiave in S.sitoSel)) S.sitoSel[v.chiave] = v.tipo !== "verifica" && !avvisate.has(v.chiave);
  const dt = (t) => new Date(t).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const stato = S.sito.stato === "carico" ? "Controllo in corso…" : S.sito.stato === "errore" ? `Non riesco a leggere il sito: ${S.sito.err}` : S.sito.letto ? `Controllato ${ago(S.sito.letto)} · ${S.sito.pagine} pagine lette` : "";
  const gruppi = Object.keys(TIPI_SITO).map((t) => [t, voci.filter((v) => v.tipo === t)]).filter(([, l]) => l.length);
  const nSel = voci.filter((v) => S.sitoSel[v.chiave]).length;
  el.innerHTML = `
    <div class="toolbar">
      <div><h2>Sito della sala</h2><span class="hint ${S.sito.stato === "errore" ? "neg" : ""}">${esc(stato)}</span></div>
      <div class="actions"><a class="btn" href="https://www.salasantommasomoro.it/" target="_blank" rel="noopener">Apri il sito</a><button class="btn" type="button" id="sito-ricontrolla"${S.sito.stato === "carico" ? " disabled" : ""}>Controlla adesso</button></div>
    </div>
    ${!cfg ? `<div class="warn" style="margin-bottom:12px">Per salvare il contatto di chi aggiorna il sito e le segnalazioni già mandate esegui in Supabase lo script <b>012_sito.sql</b>. Il controllo funziona anche senza.</div>` : ""}
    <div class="panel sito-chi">
      <div><span class="eyebrow">Chi aggiorna il sito</span>
        ${cfg && S.isAdmin ? `<form id="sito-contatto" class="sito-contatto"><input id="sito-nome" value="${esc(cfg.nome)}" placeholder="Nome" aria-label="Nome di chi aggiorna il sito"><input id="sito-cell" value="${esc(cfg.cell)}" placeholder="Cellulare (per WhatsApp)" inputmode="tel" aria-label="Cellulare"><button class="btn sm" type="submit">Salva</button></form>`
          : `<div><b>${esc(chi)}</b>${cfg && cfg.cell ? ` · ${esc(cfg.cell)}` : ""}</div>`}
        ${cfg && cfg.avvisatoIl ? `<span class="hint">Ultimo avviso mandato ${esc(dt(cfg.avvisatoIl))}</span>` : ""}</div>
      <div class="sito-avvisa"><button class="btn primary" type="button" id="sito-avvisa"${nSel ? "" : " disabled"}>Avvisa ${esc(cfg && cfg.nome ? cfg.nome : "per l'aggiornamento")}${nSel ? ` (${nSel})` : ""}</button>
        <span class="hint">Prepara il messaggio con le voci spuntate, da mandare su WhatsApp o copiare.</span></div>
    </div>
    ${S.sito.stato === "carico" && !sitoPagine ? `<div class="empty">Sto leggendo il sito…</div>`
      : !sitoPagine ? `<div class="empty">Il sito non è stato ancora letto. Premi «Controlla adesso».</div>`
      : !gruppi.length ? `<div class="empty">Il sito è in ordine: film, orari ed eventi dei prossimi 45 giorni corrispondono al programma. ✓</div>`
      : gruppi.map(([t, lista]) => `<section class="panel sito-gruppo"><div class="section-head"><h3>${TIPI_SITO[t]}</h3><span class="hint">${t === "verifica" ? "Controlla nel calendario: se l'evento è confermato, aggiungilo all'app; se è annullato, va tolto dal sito." : t === "manca" ? "In programma su Cinebot o con un'altra data, ma non sul sito." : ""}</span></div>
          ${lista.map((v) => `<div class="sito-voce"><label class="check"><input type="checkbox" data-sel="${esc(v.chiave)}"${S.sitoSel[v.chiave] ? " checked" : ""}> <span>${esc(v.testo)}</span></label>
            <div class="az">${avvisate.has(v.chiave) ? `<span class="pill acconto">già segnalato</span>` : ""}${cfg ? `<button class="btn ghost sm" type="button" data-ignora="${esc(v.chiave)}" title="Non mostrarla più">Non serve</button>` : ""}</div></div>`).join("")}
        </section>`).join("")}
    ${nascoste.length ? `<p class="hint" style="margin-top:12px">${nascoste.length} ${nascoste.length === 1 ? "segnalazione nascosta" : "segnalazioni nascoste"} con «Non serve». <button class="btn ghost sm" type="button" id="sito-ripristina">Mostrale di nuovo</button></p>` : ""}
    <p class="hint" style="margin-top:12px">Come funziona: l'app legge le pagine del sito e le confronta con le proiezioni di Cinebot e con gli eventi del calendario dei prossimi 45 giorni. Gli eventi del calendario (anche gli affitti privati) si segnalano solo se sul sito compaiono con un'altra data o sono annullati.</p>`;
  $("#sito-ricontrolla").onclick = () => controllaSito();
  el.querySelectorAll("[data-sel]").forEach((c) => (c.onchange = () => { S.sitoSel[c.dataset.sel] = c.checked; renderSito(); }));
  el.querySelectorAll("[data-ignora]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await run(sb.rpc("sito_segna", { p_ignora: [...new Set([...ignorate, b.dataset.ignora])] }), "Segnalazione nascosta"); } catch (e) { toast(errText(e)); b.disabled = false; }
  }));
  if ($("#sito-ripristina")) $("#sito-ripristina").onclick = async () => { try { await run(sb.rpc("sito_segna", { p_ignora: [] }), "Segnalazioni di nuovo visibili"); } catch (e) { toast(errText(e)); } };
  if ($("#sito-contatto")) $("#sito-contatto").onsubmit = async (e) => {
    e.preventDefault();
    try { await run(sb.from("settings").update({ sito_nome: $("#sito-nome").value.trim(), sito_cellulare: $("#sito-cell").value.trim() }).eq("id", 1), "Contatto salvato"); } catch (x) { toast(errText(x)); }
  };
  $("#sito-avvisa").onclick = async () => {
    const scelte = voci.filter((v) => S.sitoSel[v.chiave]);
    const nome = ((cfg && cfg.nome) || "").split(" ")[0], firma = (S.me.nome || "").split(" ")[0];
    openCopyText([`Ciao${nome ? " " + nome : ""},`, `sul sito della sala (salasantommasomoro.it) ci sono da aggiornare queste cose:`, ...scelte.map((v) => `• ${v.testo}`), "Grazie!" + (firma ? `\n${firma}` : "")].join("\n"), cfg && cfg.cell);
    if (cfg) {
      // ricordo cosa è stato segnalato, tenendo solo le segnalazioni ancora attuali
      const attuali = new Set(S.sito.voci.map((v) => v.chiave));
      scelte.forEach((v) => (S.sitoSel[v.chiave] = false));
      try { await run(sb.rpc("sito_segna", { p_avvisati: [...new Set([...[...avvisate].filter((k) => attuali.has(k)), ...scelte.map((v) => v.chiave)])] })); } catch (e) { toast(errText(e)); }
    }
  };
}

/* ---------- le tariffe coprono i costi? ---------- */
// costi della struttura che una giornata di sala fa sostenere: si escludono biglietteria online (U03) e comunicazione (U11),
// che riguardano le attività della sala e non gli affitti; l'assicurazione (U13) si paga una volta l'anno e non si proietta
const TC_ESCLUSE = /^(U03|U11)$/i, TC_ANNUALI = /^U13$/i, TC_VARIABILI = /^(U08|U09)$/i;
function analisiTariffe() {
  const anno = new Date().getFullYear(), Y = String(anno), T = S.tariffe;
  const giorni = Math.round((parse(TODAY) - parse(`${Y}-01-01`)) / 864e5) + 1, f = 365 / giorni;
  const pn = S.primaNota.filter((r) => r.anno === anno);
  const struttura = pn.filter((r) => r.uscite && (r.cod_settore || 0) < 100);
  const rilevanti = struttura.filter((r) => !TC_ESCLUSE.test(r.cod_cat || ""));
  const stima = (lista) => r2(sommaU(lista.filter((r) => TC_ANNUALI.test(r.cod_cat || ""))) + sommaU(lista.filter((r) => !TC_ANNUALI.test(r.cod_cat || ""))) * f);
  const costiAuto = stima(rilevanti), costiAnnui = Number(T.costi_annui) > 0 ? Number(T.costi_annui) : costiAuto;
  // giornate di apertura: prenotazioni, proiezioni e serate con borderò, una volta per data
  const date = new Set([...S.bookings.filter((b) => active(b)).map((b) => b.data), ...S.proiezioni.map((p) => p.data), ...S.c1.map((c) => c.data)].filter((d) => d.startsWith(Y) && d <= TODAY));
  const giornateAuto = Math.round(date.size * f), giornate = Number(T.giornate_annue) > 0 ? Number(T.giornate_annue) : giornateAuto;
  const costoGiorno = giornate ? costiAnnui / giornate : NaN;
  const variabileGiorno = giornate ? stima(rilevanti.filter((r) => TC_VARIABILI.test(r.cod_cat || ""))) / giornate : 0;
  // copertura dei costi della struttura da inizio anno: solo entrate su cui si può contare (le donazioni non sono certe)
  const costiStruttura = sommaU(struttura);
  const affitti = sommaE(pn.filter((r) => r.entrate > 0 && (/^E02$/i.test(r.cod_cat) || /affitt/i.test(r.categoria))));
  const donazioni = sommaE(pn.filter(isDonazione));
  const margineAttivita = r2(sommaE(pn.filter(isAttivita)) - sommaU(pn.filter(isAttivita)));
  const scoperto = r2(costiStruttura - affitti - margineAttivita);
  const affittiN = S.bookings.filter((b) => active(b) && !b.comune && b.prezzo > 0 && b.data.startsWith(Y) && b.data <= TODAY).length;
  const previstiN = S.bookings.filter((b) => active(b) && !b.comune && b.prezzo > 0 && b.data.startsWith(Y) && b.data > TODAY).length;
  return { anno, giorni, f, costiAuto, costiAnnui, giornateAuto, giornate, giorniUsati: date.size, costoGiorno, variabileGiorno, costiStruttura, affitti, donazioni, margineAttivita, scoperto, affittiN, previstiN, rilevanti };
}

function renderTariffeCosti() {
  const el = $("#tc-body");
  if (!el) return;
  if (!S.primaNota.length) { el.innerHTML = `<p class="hint">Servono i movimenti della prima nota (Economia → Bilancio) per confrontare tariffe e costi.</p>`; return; }
  const a = analisiTariffe(), T = S.tariffe, iva = (Number(T.iva) || 0) / 100;
  if (!a.giornate || !isFinite(a.costoGiorno)) { el.innerHTML = `<p class="hint">Non ci sono ancora giornate di apertura nel ${a.anno} per fare il calcolo.</p>`; return; }
  const pct = (x) => (x >= 0 ? "+" : "") + Math.round(x * 100).toLocaleString("it-IT") + "%";
  const arrot = (x) => Math.ceil(x / 10) * 10;
  const spazi = Object.keys(SPAZI).map((k) => ({ k, nome: SPAZI[k].replace(/ \(.*\)/, ""), netto: Number(T[k]) || 0 }));
  const sotto = spazi.filter((s) => s.netto < a.costoGiorno);
  const minimo = spazi.reduce((m, s) => (s.netto < m.netto ? s : m), spazi[0]);
  const margineMin = minimo.netto / a.costoGiorno - 1;
  const verdetto = sotto.length
    ? `<div class="warn">Da aumentare: ${sotto.map((s) => `<b>${esc(s.nome)}</b> almeno ${money(arrot(a.costoGiorno))} + IVA (oggi ${money(s.netto)}, ${pct(arrot(a.costoGiorno) / s.netto - 1)})`).join("; ")}. Una giornata di sala costa circa ${money(Math.round(a.costoGiorno))}.</div>`
    : `<div class="ok-note">Le tariffe coprono il costo di una giornata di sala (circa <b>${money(Math.round(a.costoGiorno))}</b>). Il margine più stretto è la ${esc(minimo.nome.toLowerCase())}: i costi possono crescere del <b>${Math.round(margineMin * 100)}%</b> prima che vada sotto costo. Per ora non serve aumentare.</div>`;
  const gapAnnuo = a.scoperto * a.f, contributoPlatea = (Number(T.platea) || 0) - a.variabileGiorno;
  const donNota = a.donazioni ? ` Le donazioni (${money(a.donazioni)} da inizio anno) non le conto perché non sono certe: quando arrivano ${a.scoperto > 0 ? (a.donazioni >= a.scoperto ? "coprono lo scoperto, ma non ci si può contare" : "riducono lo scoperto") : "sono un margine in più"}.` : "";
  const copertura = a.scoperto > 0
    ? `<p>Da inizio anno i costi della struttura (${money(a.costiStruttura)}) sono coperti da affitti ${money(a.affitti)} e margine delle attività ${money(a.margineAttivita)}: restano <b class="neg">scoperti ${money(a.scoperto)}</b> (circa ${money(Math.round(gapAnnuo))} sull'anno). Per coprirli servirebbero circa <b>${contributoPlatea > 0 ? Math.ceil(gapAnnuo / contributoPlatea) : "—"} affitti di platea in più</b> all'anno${a.affitti > 0 ? `, oppure, con gli stessi affitti, tariffe più alte del <b>${Math.round(a.scoperto / a.affitti * 100)}%</b>` : ""}.${donNota}</p>`
    : `<p>Da inizio anno i costi della struttura (${money(a.costiStruttura)}) sono coperti da affitti ${money(a.affitti)} e margine delle attività ${money(a.margineAttivita)}, con un <b>avanzo di ${money(-a.scoperto)}</b>, senza contare le donazioni.${donNota}</p>`;
  const quota = a.costiStruttura ? Math.round(a.affitti / a.costiStruttura * 100) : 0;
  el.innerHTML = `${verdetto}
    <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Spazio</th><th class="n">Tariffa netta</th><th class="n">Con IVA</th><th class="n">Costo giornata</th><th class="n">Margine</th></tr></thead><tbody>
      ${spazi.map((s) => `<tr><td>${esc(s.nome)}</td><td class="n">${money(s.netto)}</td><td class="n">${money(r2(s.netto * (1 + iva)))}</td><td class="n">${money(Math.round(a.costoGiorno))}</td><td class="n ${s.netto < a.costoGiorno ? "neg" : ""}">${money(Math.round(s.netto - a.costoGiorno))} (${pct(s.netto / a.costoGiorno - 1)})</td></tr>`).join("")}
    </tbody></table></div>
    <h3 style="margin-top:14px">E i costi della struttura?</h3>
    ${copertura}
    <p class="hint">Gli affitti coprono il ${quota}% dei costi della struttura: ${a.affittiN} ${a.affittiN === 1 ? "affitto" : "affitti"} a pagamento da inizio anno${a.previstiN ? `, ${a.previstiN === 1 ? "un altro" : "altri " + a.previstiN} già in calendario` : ""}.${quota < 25 ? " Più che il prezzo, conta quante volte la sala viene affittata." : ""}</p>
    <details><summary>Come si calcola e cosa puoi correggere</summary><div>
      <p><b>Costo di una giornata</b> = costi annui della struttura ÷ giornate di apertura. Costi: prima nota ${a.anno}, settori della struttura, senza biglietteria online e comunicazione (servono alle attività, non agli affitti); l'assicurazione conta una volta, il resto è proiettato sull'anno (${a.giorni} giorni trascorsi): <b>${money(a.costiAuto)}</b>. Giornate: date con prenotazioni, proiezioni o borderò fino a oggi (${a.giorniUsati}), proiettate sull'anno: <b>${a.giornateAuto}</b>.</p>
      <p>Se una bolletta non è ancora registrata (per esempio l'energia) la stima è bassa: puoi scrivere qui i valori che conosci. Vuoto = calcolo automatico.</p>
      <form id="tc-form" class="sito-contatto" novalidate><label class="hint" for="tc-costi">Costi annui (€)</label><input id="tc-costi" type="number" min="0" step="1" inputmode="decimal" placeholder="${Math.round(a.costiAuto)}" value="${Number(T.costi_annui) > 0 ? T.costi_annui : ""}">
        <label class="hint" for="tc-giornate">Giornate di apertura</label><input id="tc-giornate" type="number" min="0" step="1" inputmode="numeric" placeholder="${a.giornateAuto}" value="${Number(T.giornate_annue) > 0 ? T.giornate_annue : ""}">
        <button class="btn sm" type="submit">${S.tariffeDb ? "Salva" : "Ricalcola"}</button></form>
      <p class="hint">Gli «affitti in più» considerano per ogni affitto la tariffa della platea meno energia e acqua di una giornata (${money(Math.round(a.variabileGiorno))}). Gli importi della prima nota sono quelli incassati, IVA compresa se c'era.</p>
    </div></details>`;
  $("#tc-form").onsubmit = async (e) => {
    e.preventDefault();
    const nuovo = { ...S.tariffe, costi_annui: Number($("#tc-costi").value) || null, giornate_annue: Number($("#tc-giornate").value) || null };
    if (!S.tariffeDb) { S.tariffe = nuovo; renderTariffeCosti(); return; }
    try { await run(sb.from("settings").update({ tariffe: nuovo }).eq("id", 1), "Valori salvati"); } catch (x) { toast(errText(x)); }
  };
}

/* ---------- promemoria per chi è di turno ---------- */
// per i prossimi tre giorni: un messaggio per giorno con eventi, fasce, nomi e posti ancora scoperti
function promemoriaTurni() {
  const giorni = [0, 1, 2].map((n) => addDays(TODAY, n));
  return giorni.map((d) => ({ data: d, eventi: S.bookings.filter((b) => active(b) && b.data === d && turni(b).length).sort(byWhen) })).filter((g) => g.eventi.length);
}
function testoPromemoria(g) {
  const quando = g.data === TODAY ? "oggi" : g.data === addDays(TODAY, 1) ? "domani" : "";
  const righe = [`⏰ Promemoria turni · ${quando ? quando + " " : ""}${fmtDay(g.data, { weekday: "long", day: "numeric", month: "long" })}`, ""];
  for (const b of g.eventi) {
    righe.push(`📍 ${b.titolo}${b.giornata_intera ? "" : ` (${b.inizio}–${b.fine})`}`);
    for (const t of turni(b)) {
      const ppl = signupsFor(b.id, t.id), mancano = Math.max(0, (Number(t.posti) || 0) - ppl.length);
      righe.push(`• ${t.label} ${t.inizio}–${t.fine}: ${ppl.length ? ppl.map((x) => x.nome).join(", ") : "nessuno"}${mancano ? ` — ${mancano === 1 ? "manca ancora 1 persona" : `mancano ancora ${mancano} persone`}: chi può?` : ""}`);
    }
    righe.push("");
  }
  const io = (S.me.nome || "").split(" ")[0];
  righe.push(`${io ? `Per qualsiasi cosa scrivete a ${io}. ` : ""}Grazie a tutti! 🙏`);
  return righe.join("\n");
}
function renderPromemoria() {
  const el = $("#shift-promemoria");
  if (!el) return;
  const gg = S.canWrite ? promemoriaTurni() : [];
  el.hidden = !gg.length;
  el.innerHTML = gg.length ? `<div class="panel promemoria"><div class="section-head"><h3>Promemoria per chi è di turno</h3><span class="hint">Il messaggio con eventi, orari e nomi, da mandare nel gruppo il giorno prima</span></div>
    <div class="actions">${gg.map((g, i) => { const scop = g.eventi.reduce((s, b) => { const c = coverage(b); return s + c.need - c.have; }, 0);
      return `<button class="btn${g.data === addDays(TODAY, 1) ? " primary" : ""}" type="button" data-prom="${i}">${g.data === TODAY ? "Oggi" : g.data === addDays(TODAY, 1) ? "Domani" : fmtShort(g.data)} · ${g.eventi.length} ${g.eventi.length === 1 ? "evento" : "eventi"}${scop ? ` · ${scop} scoperti` : ""}</button>`; }).join("")}</div></div>` : "";
  el.querySelectorAll("[data-prom]").forEach((b) => (b.onclick = () => openCopyText(testoPromemoria(gg[+b.dataset.prom]))));
}

/* ---------- cose da fare per ogni film ---------- */
const GIORNI_RICHIESTA = 21; // il supporto si chiede al distributore almeno tre settimane prima
const GIORNI_SITO = 10;      // e il film va sul sito almeno dieci giorni prima
const SUPPORTO_ART = { file: "il file", dvd: "il DVD", bluray: "il Blu-ray", link: "il link" };
const normFilm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function coseDaFareFilm() {
  const out = [], fino = addDays(TODAY, 45);
  const mancaSito = new Set((S.sito.voci || []).filter((v) => v.tipo === "manca" || v.tipo === "orario").map((v) => normFilm((v.testo.match(/«([^»]+)»/) || [])[1])));
  for (const f of S.films) {
    const nx = nextShow(f), nuovo = f.creato && (Date.now() - new Date(f.creato)) < 7 * 864e5;
    if (nx && nx.data <= fino) {
      const t = (testo, entro, azione) => out.push({ f, testo, entro, azione, nuovo, prima: nx.data });
      if (f.acquisizione === "da_procurare") t(`Chiedere ${SUPPORTO_ART[f.supporto] || "il DVD o il file"} al distributore${f.distributore ? ` (${f.distributore})` : ""}`, addDays(nx.data, -GIORNI_RICHIESTA), "richiesto");
      else if (f.acquisizione === "in_arrivo") t(`Controllare che arrivi ${SUPPORTO_ART[f.supporto] || "il supporto"}`, addDays(nx.data, -GIORNI_PROVA - 2), "arrivato");
      if (f.prova_esito === "problemi") t(`Risolvere i problemi della prova${f.prova_note ? `: ${f.prova_note}` : ""}`, addDays(nx.data, -2), "apri");
      else if (f.prova_esito !== "ok") t("Fare la prova di proiezione", addDays(nx.data, -GIORNI_PROVA), "apri");
      if (S.canWrite && mancaSito.has(normFilm(f.titolo))) t("Mettere il film (con gli orari giusti) sul sito della sala", addDays(nx.data, -GIORNI_SITO), "sito");
    }
    // dopo la proiezione: la fattura del noleggio deve comparire in prima nota (solo l'amministratore la vede)
    const ultima = showsOf(f).filter((p) => p.data < TODAY).pop();
    if (S.isAdmin && S.primaNota.length && ultima && ultima.data >= addDays(TODAY, -60) && !nx) {
      const n = normFilm(f.titolo);
      const pagato = S.primaNota.some((r) => r.uscite > 0 && normFilm(`${r.evento} ${r.descrizione}`).includes(n));
      if (!pagato) out.push({ f, testo: "Il noleggio non risulta ancora in prima nota: controllare la fattura del distributore", entro: addDays(ultima.data, 30), azione: "", nuovo: false, prima: ultima.data });
    }
  }
  return out.sort((a, b) => a.entro.localeCompare(b.entro));
}
function renderCoseFilm() {
  const el = $("#film-todo");
  if (!el) return;
  const lista = coseDaFareFilm();
  el.hidden = !lista.length;
  if (!lista.length) { el.innerHTML = ""; return; }
  const scad = (d) => { const g = Math.round((parse(d) - parse(TODAY)) / 864e5); return g < 0 ? `<span class="pill dapagare">in ritardo di ${-g} ${-g === 1 ? "giorno" : "giorni"}</span>` : g <= 3 ? `<span class="pill acconto">${g === 0 ? "oggi" : `entro ${fmtShort(d)}`}</span>` : `<span class="hint">entro ${esc(fmtShort(d))}</span>`; };
  const bottone = (x, i) => ({ richiesto: `<button class="btn sm" type="button" data-todo="${i}">Fatto: richiesto</button>`, arrivato: `<button class="btn sm" type="button" data-todo="${i}">Arrivato</button>`, apri: `<button class="btn sm" type="button" data-todo="${i}">Apri il film</button>`, sito: `<a class="btn sm" href="#sito">Vai a Sito web</a>` }[x.azione] || "");
  el.innerHTML = `<div class="panel film-todo"><div class="section-head"><h3>Cose da fare per i film</h3><span class="hint">Prossimi 45 giorni · supporto ${GIORNI_RICHIESTA} giorni prima, prova ${GIORNI_PROVA}, sito ${GIORNI_SITO}</span></div>
    ${lista.map((x, i) => `<div class="todo-riga"><div><b>${esc(x.f.titolo)}</b>${x.nuovo ? ' <span class="pill confermata">Nuovo da Cinebot</span>' : ""} <span class="hint">· ${x.prima >= TODAY ? "prima proiezione" : "proiettato"} ${esc(fmtShort(x.prima))}</span><div>${esc(x.testo)}</div></div><div class="az">${scad(x.entro)}${bottone(x, i)}</div></div>`).join("")}</div>`;
  el.querySelectorAll("[data-todo]").forEach((b) => (b.onclick = async () => {
    const x = lista[+b.dataset.todo];
    if (x.azione === "apri") { openFilm(x.f); return; }
    b.disabled = true;
    const rec = x.azione === "richiesto" ? { acquisizione: "in_arrivo" } : { acquisizione: "disponibile", disponibile_il: TODAY };
    try { await run(sb.from("films").update({ ...rec, aggiornato: new Date().toISOString() }).eq("id", x.f.id), x.azione === "richiesto" ? "Segnato: supporto richiesto" : "Segnato: supporto arrivato. Dove è stato messo? Scrivilo nel film."); }
    catch (e) { b.disabled = false; toast(errText(e)); }
  }));
}

/* ---------- quanti volontari servono ---------- */
// regole della sala (si cambiano nella pagina Turni; salvate in settings.tariffe.turni)
const PUBBLICO = {
  senza: "Senza pubblico in sala (prove, allestimenti, riunioni)",
  galleria: "Pubblico solo in galleria",
  libero: "Pubblico in platea, ingresso libero",
  pagamento: "Spettacolo a pagamento",
};
const TURNI_DEFAULT = { senza: 1, galleria: 2, libero: 3, pagamento: 4 };
const regoleTurni = () => ({ ...TURNI_DEFAULT, ...((S.tariffe && S.tariffe.turni) || {}) });
// che tipo di pubblico ha un evento: la scelta salvata, altrimenti dedotta da cinema, scheda e tariffa (null = da scegliere)
function pubblicoDi(b) {
  const t = b.tariffa || {};
  if (PUBBLICO[t.pubblico]) return { k: t.pubblico, auto: false };
  const sk = S.schede.filter((x) => x.booking_id === b.id && x.dati && Object.keys(x.dati).length).sort((x, y) => (y.compilata_il || "").localeCompare(x.compilata_il || ""))[0];
  const d = (sk && sk.dati) || {};
  // una proiezione che cade dentro l'orario dell'evento (o nello stesso giorno, se l'evento è «tutto il giorno»)
  const film = S.proiezioni.some((p) => p.data === b.data && (b.giornata_intera || (p.ora >= addMin(b.inizio, -30) && p.ora < b.fine)));
  const k = film || /cinema|proiezion/i.test(b.tipo) || d.ingresso === "pagamento" || t.biglietteria ? "pagamento"
    : d.fascia === "galleria" || t.spazio === "galleria" ? "galleria"
    : d.ingresso || d.fascia || ["platea", "tutta"].includes(t.spazio) || /spettacolo|concerto|conferenza|incontro/i.test(b.tipo) ? "libero"
    : /riunione|assemblea|corso|laboratorio|prova/i.test(`${b.tipo} ${b.titolo}`) ? "senza" : null;
  return { k, auto: true };
}
// un turno che copre l'evento con mezz'ora prima e dopo; oltre le 5 ore in due fasce
// per gli eventi «tutto il giorno» l'orario si prende dalle proiezioni di quel giorno; senza, non si può proporre (null)
function orarioTurni(b) {
  if (!b.giornata_intera) return [addMin(b.inizio, -30), addMin(b.fine, 30)];
  const ore = S.proiezioni.filter((p) => p.data === b.data).map((p) => p.ora).sort();
  return ore.length ? [addMin(ore[0], -30), addMin(ore[ore.length - 1], 150)] : null;
}
function turniProposti(b, k) {
  const n = regoleTurni()[k] || 1, o = orarioTurni(b);
  if (!o) return null;
  const [i, f] = o;
  const min = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  if (min(f) - min(i) <= 300) return [{ id: uidv(), label: k === "senza" ? "Presenza in sala" : "Servizio in sala", inizio: i, fine: f, posti: n }];
  const meta = addMin(i, Math.round((min(f) - min(i)) / 60) * 30);
  return [{ id: uidv(), label: "Primo turno", inizio: i, fine: meta, posti: n }, { id: uidv(), label: "Secondo turno", inizio: meta, fine: f, posti: n }];
}

// eventi dei prossimi 30 giorni senza turni: da qui si creano con un tocco
function renderSenzaTurni() {
  const el = $("#shift-mancano");
  if (!el) return;
  const fino = addDays(TODAY, 30);
  const lista = S.canWrite ? S.bookings.filter((b) => b.stato === "confermata" && b.data >= TODAY && b.data <= fino && !turni(b).length).sort(byWhen) : [];
  const R = regoleTurni();
  el.hidden = !S.canWrite;
  if (!S.canWrite) return;
  const opz = (sel) => `<option value="">Pubblico?</option>${Object.entries(PUBBLICO).map(([k, l]) => `<option value="${k}"${sel === k ? " selected" : ""}>${esc(l)} · ${R[k]}</option>`).join("")}`;
  el.innerHTML = `<div class="panel promemoria">
    <div class="section-head"><h3>Eventi senza turni</h3><span class="hint">Eventi confermati dei prossimi 30 giorni · il numero di persone segue le regole della sala</span></div>
    ${lista.length ? lista.map((b) => { const p = pubblicoDi(b);
      return `<div class="todo-riga"><div><b>${esc(fmtShort(b.data))}</b> · ${esc(b.titolo)} <span class="hint">${esc(orario(b))}</span>${p.auto && p.k ? ` <span class="hint">· dedotto: ${esc(PUBBLICO[p.k].split(" (")[0].toLowerCase())}</span>` : ""}</div>
        <div class="az"><select data-pub="${esc(b.id)}" aria-label="Pubblico di ${esc(b.titolo)}">${opz(p.k)}</select>${orarioTurni(b) ? `<button class="btn sm primary" type="button" data-crea="${esc(b.id)}"${p.k ? "" : " disabled"}>Crea turni${p.k ? ` (${R[p.k]})` : ""}</button>` : `<button class="btn sm" type="button" data-apri="${esc(b.id)}" title="L'evento è «tutto il giorno»: indica l'orario">Orario da indicare</button>`}</div></div>`; }).join("")
      + `<div class="actions" style="margin-top:8px"><button class="btn" type="button" id="crea-tutti"${lista.some((b) => pubblicoDi(b).k && orarioTurni(b)) ? "" : " disabled"}>Crea i turni per tutti quelli con il pubblico indicato</button></div>`
      : `<div class="hint">Tutti gli eventi dei prossimi 30 giorni hanno i turni. ✓</div>`}
    <details class="regole-turni"><summary>Regole: quante persone servono</summary>
      <form id="regole-form" class="sito-contatto" novalidate>${Object.entries(PUBBLICO).map(([k, l]) => `<label class="hint" for="rt-${k}">${esc(l.split(" (")[0])}</label><input id="rt-${k}" type="number" min="0" max="20" step="1" value="${R[k]}"${S.isAdmin ? "" : " disabled"}>`).join("")}
        ${S.isAdmin ? `<button class="btn sm" type="submit">Salva regole</button>` : ""}</form>
      ${S.isAdmin && !S.tariffeDb ? `<p class="hint">Per salvare le regole esegui in Supabase lo script 013_tariffe.sql.</p>` : ""}
    </details></div>`;
  // la scelta del pubblico resta nella prenotazione (insieme alla tariffa)
  const salvaPubblico = (b, k) => (S.tariffeDb ? sb.from("bookings").update({ tariffa: { ...(b.tariffa || {}), pubblico: k } }).eq("id", b.id) : Promise.resolve({}));
  const crea = async (b, k) => {
    const { error } = await sb.from("bookings").update({ turni: turniProposti(b, k), ...(S.tariffeDb ? { tariffa: { ...(b.tariffa || {}), pubblico: k } } : {}) }).eq("id", b.id);
    if (error) throw error;
  };
  el.querySelectorAll("[data-pub]").forEach((s) => (s.onchange = async () => {
    const b = S.bookings.find((x) => x.id === s.dataset.pub);
    if (!s.value) return;
    b.tariffa = { ...(b.tariffa || {}), pubblico: s.value };
    renderSenzaTurni();
    try { const r = await salvaPubblico(b, s.value); if (r.error) throw r.error; } catch (e) { toast(errText(e)); }
  }));
  el.querySelectorAll("[data-apri]").forEach((x) => (x.onclick = () => openBooking(S.bookings.find((y) => y.id === x.dataset.apri))));
  el.querySelectorAll("[data-crea]").forEach((x) => (x.onclick = async () => {
    const b = S.bookings.find((y) => y.id === x.dataset.crea), k = pubblicoDi(b).k;
    x.disabled = true;
    try { await crea(b, k); toast(`Turni creati: ${regoleTurni()[k]} ${regoleTurni()[k] === 1 ? "persona" : "persone"}`); await loadAll(); } catch (e) { x.disabled = false; toast(errText(e)); }
  }));
  if ($("#crea-tutti")) $("#crea-tutti").onclick = async (ev) => {
    ev.target.disabled = true;
    let n = 0;
    try { for (const b of lista) { const k = pubblicoDi(b).k; if (k && orarioTurni(b)) { await crea(b, k); n++; } } toast(`Turni creati per ${n} ${n === 1 ? "evento" : "eventi"}`); } catch (e) { toast(errText(e)); }
    await loadAll();
  };
  if ($("#regole-form")) $("#regole-form").onsubmit = async (e) => {
    e.preventDefault();
    const turniR = Object.fromEntries(Object.keys(PUBBLICO).map((k) => [k, Math.max(0, Number($("#rt-" + k).value) || 0)]));
    if (!S.tariffeDb) { S.tariffe = { ...S.tariffe, turni: turniR }; renderSenzaTurni(); return; }
    try { await run(sb.from("settings").update({ tariffe: { ...S.tariffe, turni: turniR } }).eq("id", 1), "Regole dei turni salvate"); } catch (x) { toast(errText(x)); }
  };
}

// testo per il sondaggio WhatsApp: una domanda e un'opzione per ogni fascia dei prossimi giorni
function testoSondaggio(giorni) {
  const fino = addDays(TODAY, giorni);
  const eventi = S.bookings.filter((b) => active(b) && b.data >= TODAY && b.data <= fino && turni(b).length).sort(byWhen);
  const opzioni = eventi.flatMap((b) => turni(b).map((t) => {
    const mancano = Math.max(0, (Number(t.posti) || 0) - signupsFor(b.id, t.id).length);
    return { testo: `${fmtShort(b.data)} · ${b.titolo} · ${t.inizio}–${t.fine}`, mancano };
  })).filter((o) => o.mancano > 0);
  if (!opzioni.length) return "";
  const f = (s) => parse(s).toLocaleDateString("it-IT", { day: "numeric", month: "long" });
  return [`📋 Sondaggio da creare su WhatsApp (📎 → Sondaggio)`, "", `DOMANDA:`, `Turni in sala dal ${f(TODAY)} al ${f(fino)}: quando ci sei?`, "",
    `OPZIONI (una per riga${opzioni.length > 12 ? "; WhatsApp ne accetta 12: fai due sondaggi" : ""}):`, ...opzioni.map((o) => `${o.testo} (${o.mancano === 1 ? "serve 1" : `servono ${o.mancano}`})`), "",
    `Ricordati di attivare «Consenti più risposte». Poi scrivi i nomi nella pagina Turni con «+ Aggiungi».`].join("\n");
}

/* ---------- volontari con link personale ---------- */
const linkTurni = (v) => new URL("modulo/turni.html?t=" + v.token, location.href.split("#")[0]).href;
function renderVolontari() {
  const el = $("#shift-volontari");
  if (!el) return;
  el.hidden = !S.canWrite;
  if (!S.canWrite) return;
  if (S.loadErr2?.volontari) { el.innerHTML = `<div class="panel promemoria"><div class="warn">Per i link personali dei volontari esegui in Supabase lo script <b>014_turni_link.sql</b> e ricarica la pagina.</div></div>`; return; }
  const att = S.volontari.filter((v) => v.attivo), off = S.volontari.filter((v) => !v.attivo);
  const conta = (v) => S.signups.filter((x) => x.volontarioId === v.id && S.bookings.some((b) => b.id === x.bookingId && b.data >= TODAY)).length;
  const riga = (v) => `<div class="todo-riga"><div><b>${esc(v.nome)}</b> <span class="hint">${esc(v.cellulare || "senza cellulare")}${v.attivo ? ` · ${conta(v)} turni in programma` : " · disattivato"}</span></div>
    <div class="az">${v.attivo ? `<button class="btn sm" type="button" data-vlink="${esc(v.id)}">Manda il link</button><button class="btn ghost sm" type="button" data-voff="${esc(v.id)}">Disattiva</button>` : `<button class="btn ghost sm" type="button" data-von="${esc(v.id)}">Riattiva</button>`}</div></div>`;
  el.innerHTML = `<div class="panel promemoria"><details${S.volAperto ? " open" : ""} id="vol-det"><summary><b>Volontari con link personale</b> <span class="hint">· ${att.length} attivi · ognuno si segna dal suo link e vede chi c'è già</span></summary>
    <form id="vol-form" class="sito-contatto" style="margin-top:10px"><input id="vol-nome" placeholder="Nome (come lo vedranno gli altri)" aria-label="Nome del volontario" maxlength="60"><input id="vol-cell" placeholder="Cellulare (per WhatsApp)" inputmode="tel" aria-label="Cellulare"><button class="btn sm primary" type="submit">Aggiungi</button></form>
    ${att.map(riga).join("") || `<p class="hint">Nessun volontario ancora: aggiungili qui sopra e manda a ciascuno il suo link.</p>`}
    ${off.length ? `<p class="hint" style="margin-top:8px">Disattivati: il loro link non funziona più.</p>${off.map(riga).join("")}` : ""}
    <div class="actions" style="margin-top:10px"><button class="btn" type="button" id="vol-gruppo">Avviso per il gruppo</button></div></details></div>`;
  $("#vol-det").ontoggle = (e) => (S.volAperto = e.target.open);
  $("#vol-form").onsubmit = async (e) => {
    e.preventDefault();
    const nome = $("#vol-nome").value.trim().replace(/\s+/g, " "), cellulare = $("#vol-cell").value.trim();
    if (!nome) { $("#vol-nome").focus(); return; }
    if (S.volontari.some((v) => v.attivo && v.nome.toLowerCase() === nome.toLowerCase())) { toast(`C'è già un volontario «${nome}»: aggiungi l'iniziale del cognome`); return; }
    try { await run(sb.from("volontari").insert({ nome, cellulare }), `${nome} aggiunto: ora mandagli il link`); } catch (x) { toast(errText(x)); }
  };
  el.querySelectorAll("[data-vlink]").forEach((b) => (b.onclick = () => {
    const v = S.volontari.find((x) => x.id === b.dataset.vlink), io = (S.me.nome || "").split(" ")[0];
    openCopyText([`Ciao ${v.nome}!`, "Questo è il tuo link per i turni della Sala San Tommaso Moro: lo apri, vedi le fasce con chi c'è già e tocchi «Ci sono» dove puoi esserci.", linkTurni(v), "Salvalo, vale sempre (anche per i prossimi turni). Grazie!" + (io ? `\n${io}` : "")].join("\n"), v.cellulare);
  }));
  el.querySelectorAll("[data-voff],[data-von]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.voff || b.dataset.von, on = !!b.dataset.von;
    try { await run(sb.from("volontari").update({ attivo: on }).eq("id", id), on ? "Volontario riattivato" : "Link disattivato"); } catch (x) { toast(errText(x)); }
  }));
  $("#vol-gruppo").onclick = () => {
    const fino = addDays(TODAY, 14), eventi = S.bookings.filter((b) => b.stato === "confermata" && b.data >= TODAY && b.data <= fino && turni(b).length).sort(byWhen);
    const righe = eventi.flatMap((b) => turni(b).map((t) => ({ b, t, m: Math.max(0, (Number(t.posti) || 0) - signupsFor(b.id, t.id).length) }))).filter((x) => x.m);
    if (!righe.length) { toast("Nei prossimi 14 giorni i turni sono tutti coperti"); return; }
    openCopyText([`📋 Turni in sala dei prossimi giorni: ci sono ancora posti!`, "", ...righe.map((x) => `• ${fmtShort(x.b.data)} · ${x.b.titolo} · ${x.t.inizio}–${x.t.fine} (${x.m === 1 ? "serve 1 persona" : `servono ${x.m} persone`})`), "", "Segnatevi dal vostro link personale. Se non lo trovate, scrivetemi e ve lo rimando. Grazie! 🙏"].join("\n"));
  };
}

/* ---------- la serata: tutto quello che serve a chi apre la sala, su una pagina ---------- */
const CAPIENZA = { galleria: "fino a 134 persone (solo galleria)", platea: "fino a 338 persone (platea)", tutta: "fino a 472 persone (platea e galleria)" };
// giorni con qualcosa in sala: eventi non annullati e proiezioni
const giorniConEventi = () => [...new Set([...S.bookings.filter(active).map((b) => b.data), ...S.proiezioni.map((p) => p.data)])].sort();
function renderSerata() {
  const el = $("#serata-body");
  const giorni = giorniConEventi();
  // senza una scelta, la serata di oggi o la prossima con qualcosa in sala
  const d = S.serataData || giorni.find((x) => x >= TODAY) || TODAY, prima = [...giorni].reverse().find((x) => x < d), dopo = giorni.find((x) => x > d);
  const eventi = S.bookings.filter((b) => active(b) && b.data === d).sort(byWhen);
  const film = S.proiezioni.filter((p) => p.data === d).map((p) => ({ p, f: S.films.find((x) => x.id === p.film_id) })).filter((x) => x.f).sort((a, b) => a.p.ora.localeCompare(b.p.ora));
  const quando = d === TODAY ? "Stasera" : d === addDays(TODAY, 1) ? "Domani" : d < TODAY ? "Serata passata" : "Prossima serata";
  const tel = (n) => (n ? `<a href="tel:${esc(String(n).replace(/[^\d+]/g, ""))}">${esc(n)}</a>` : "");
  const riga = (et, v) => (v ? `<div class="sr-riga"><span>${et}</span><div>${v}</div></div>` : "");
  const schedaDi = (b) => S.schede.filter((x) => x.booking_id === b.id && x.dati && Object.keys(x.dati).length).sort((x, y) => (y.compilata_il || "").localeCompare(x.compilata_il || ""))[0];

  const blocchiEventi = eventi.map((b) => {
    const sk = schedaDi(b), dd = (sk && sk.dati) || {}, pub = pubblicoDi(b).k;
    const spazio = dd.fascia || (b.tariffa && b.tariffa.spazio) || (pub === "galleria" ? "galleria" : "");
    const turniHtml = turni(b).map((t) => {
      const ppl = signupsFor(b.id, t.id), manca = Math.max(0, (Number(t.posti) || 0) - ppl.length);
      return `<div class="sr-turno"><b>${esc(t.label)}</b> <span class="hint">${esc(t.inizio)}–${esc(t.fine)}</span><div>${ppl.length ? ppl.map((x) => `<span class="person solo${isMine(x) ? " me" : ""}">${esc(x.nome)}</span>`).join(" ") : '<span class="hint">nessuno</span>'}${manca ? ` <span class="pill dapagare">${manca === 1 ? "manca 1 persona" : `mancano ${manca} persone`}</span>` : ""}</div></div>`;
    }).join("");
    const tecnico = { sala: "serve il tecnico della sala", nostro: `loro tecnico${dd.tecnico_nome ? ": " + esc(dd.tecnico_nome) : ""} ${tel(dd.tecnico_cell)}`, nessuno: "non serve" }[dd.tecnico];
    const daIncassare = S.canWrite ? residuo(b) : 0;
    return `<article class="panel sr-evento">
      <div class="section-head"><h3>${esc(b.titolo)}</h3><span class="pill ${b.stato}">${STATI[b.stato]}</span></div>
      <div class="sr-ora">${esc(orario(b))}${b.tipo ? ` · ${esc(b.tipo)}` : ""}${pub ? ` · ${esc(PUBBLICO[pub].split(" (")[0].toLowerCase())}` : ""}</div>
      ${riga("Capienza", spazio && CAPIENZA[spazio] ? esc(CAPIENZA[spazio]) + (dd.pubblico_n ? ` · attesi circa ${esc(dd.pubblico_n)}` : "") : dd.pubblico_n ? `attesi circa ${esc(dd.pubblico_n)}` : "")}
      ${S.canWrite ? riga("Organizzatore", [esc(dd.ente || b.referente), b.referente && dd.ente ? esc(b.referente) : "", tel(dd.cellulare || b.telefono)].filter(Boolean).join(" · ")) : ""}
      ${S.canWrite ? riga("Responsabile in sala", dd.resp_sera ? `${esc(dd.resp_sera)} ${tel(dd.resp_cell)}` : "") : ""}
      ${S.canWrite ? riga("Tecnico", tecnico || "") : ""}
      ${S.canWrite ? riga("Da sapere", [dd.carrozzina_n ? `${esc(dd.carrozzina_n)} persone in carrozzina` : "", dd.bambini_n ? `${esc(dd.bambini_n)} bambini` : "", dd.effetti && dd.effetti !== "nessuno" ? `effetti: ${esc(dd.effetti === "fumo" ? "macchina del fumo" : dd.effetti_quali || "altro")}` : "", dd.attrezzature === "si" ? `attrezzature loro: ${esc(dd.attrezzature_quali || "sì")}${dd.potenza_w ? ` (${esc(dd.potenza_w)} W)` : ""}` : "", dd.scenografie === "si" ? `scenografie: ${esc(dd.scenografie_quali || "sì")}` : "", dd.siae === "si" ? (siaeStato(dd) === "allegato" ? "permesso SIAE allegato" : "permesso SIAE da ricevere") : ""].filter(Boolean).join(" · ")) : ""}
      ${S.canWrite && sk && sk.sicurezza ? riga("Sicurezza", `${esc({ compatibile: "compatibile", condizioni: "compatibile con condizioni", non_compatibile: "non compatibile" }[sk.sicurezza])}${sk.sicurezza_note ? ": " + esc(sk.sicurezza_note) : ""}`) : ""}
      ${S.canWrite && !sk && !b.comune && b.prezzo > 0 ? riga("Scheda", '<span class="hint">l\'organizzatore non ha compilato la scheda</span>') : ""}
      ${daIncassare > 0 ? riga("Da incassare", `<b>${money(daIncassare)}</b> su ${money(b.prezzo)}`) : ""}
      ${b.note && S.canWrite ? riga("Note", esc(b.note)) : ""}
      ${turniHtml ? `<h4>Chi è di turno</h4>${turniHtml}` : `<p class="hint">Nessun turno previsto per questo evento.</p>`}
    </article>`;
  }).join("");

  const blocchiFilm = film.length ? `<article class="panel sr-evento"><div class="section-head"><h3>Cinema</h3></div>
    ${film.map(({ p, f }) => { const r = readiness(f);
      return `<div class="sr-riga"><span>${esc(p.ora)}</span><div><b>${esc(f.titolo)}</b> <span class="pill ${pillCls[r.cls]}">${esc(r.text)}</span><div class="hint">${[f.supporto ? SUPPORTI[f.supporto] : "supporto da decidere", f.dove ? `si trova: ${esc(f.dove)}` : "", f.prova_esito === "problemi" && f.prova_note ? `problemi alla prova: ${esc(f.prova_note)}` : ""].filter(Boolean).join(" · ")}</div></div></div>`; }).join("")}
    ${S.canCassa ? `<div class="actions" style="margin-top:8px"><a class="btn sm" href="#cassa">Apri la cassa</a></div>` : ""}</article>` : "";

  el.innerHTML = `
    <div class="toolbar">
      <div><span class="eyebrow">${quando}</span><h2>${esc(fmtDay(d, { weekday: "long", day: "numeric", month: "long" }))}</h2></div>
      <div class="seg" role="group" aria-label="Cambia giorno"><button type="button" data-g="${prima || ""}"${prima ? "" : " disabled"} aria-label="Serata precedente">‹</button><button type="button" data-g="">Prossima</button><button type="button" data-g="${dopo || ""}"${dopo ? "" : " disabled"} aria-label="Serata successiva">›</button></div>
    </div>
    ${!eventi.length && !film.length ? `<div class="empty">In questo giorno la sala è libera.</div>` : `<div class="sr-grid">${blocchiFilm}${blocchiEventi}</div>`}
    <details class="panel sr-sicurezza"><summary><b>Prima di aprire e alla chiusura</b></summary><ul>
      <li>Uscite di emergenza e percorsi liberi, anche all'esterno; luci di emergenza accese.</li>
      <li>Non superare la capienza: 134 solo galleria, 338 platea, 472 platea e galleria.</li>
      <li>Niente passeggini in sala; carrozzine per persone con disabilità sì. Ascensore solo per chi ne ha bisogno.</li>
      <li>Niente fiamme, candele, cibo e bevande in sala.</li>
      <li>Alla chiusura: luci, riscaldamento o condizionatore spenti, porte chiuse, allarme inserito.</li>
    </ul></details>`;
  el.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => { S.serataData = b.dataset.g || null; renderSerata(); }));
}

/* ---------- conviene prendere questo film? ---------- */
// proiezioni di cinema degli ultimi 12 mesi (le serate di danza, teatro e concerti hanno un altro pubblico)
const c1Cinema = () => { const da = addDays(TODAY, -365); return S.c1.filter((c) => c.data >= da && c.data < TODAY && c.spettatori > 0 && (!c.tipo_evento || /cinema|film|proiez/i.test(c.tipo_evento))); };
const nettoPerSpettatore = (list) => { const sp = list.reduce((s, c) => s + c.spettatori, 0); return sp ? list.reduce((s, c) => s + (Number(c.imponibile_iva) || Number(c.lordo) / 1.1 || 0), 0) / sp : 0; };
const quantile = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
// spettatori attesi in un giorno della settimana e fascia: media e forbice (un quarto delle serate sotto, un quarto sopra)
function attesiSlot(g, fa) {
  const tutti = c1Cinema(), slot = tutti.filter((c) => giorno(c) === g && fascia(c.ora) === fa), fasciaTutta = tutti.filter((c) => fascia(c.ora) === fa);
  const base = slot.length >= 3 ? slot : fasciaTutta.length >= 3 ? fasciaTutta : tutti;
  const v = base.map((c) => c.spettatori);
  return { media: mean(v), basso: quantile(v, 0.25), alto: quantile(v, 0.75), n: base.length, come: slot.length >= 3 ? `${slot.length} proiezioni di ${GIORNI[g]} ${fa}` : fasciaTutta.length >= 3 ? `${fasciaTutta.length} proiezioni di ${fa}` : `${tutti.length} proiezioni` };
}
// margine di una proiezione con n spettatori: incasso netto meno noleggio (minimo garantito o percentuale) e altri costi
function margineProiezione(n, c) {
  const incasso = n * c.netto;
  const noleggio = c.tipo === "forfait" ? c.forfait : Math.max(c.minimo || 0, incasso * (c.perc || 0) / 100);
  return { incasso, noleggio, margine: incasso - noleggio - (c.altri || 0) };
}
function pareggio(c) { for (let n = 0; n <= 600; n++) if (margineProiezione(n, c).margine >= 0) return n; return null; }

const dlgConv = $("#dlg-conviene");
$("#btn-conviene").onclick = apriConviene;
["#cv-film", "#cv-giorno", "#cv-fascia", "#cv-n", "#cv-tipo", "#cv-perc", "#cv-minimo", "#cv-forfait", "#cv-netto", "#cv-altri"].forEach((x) => $(x).addEventListener("input", aggiornaConviene));
function apriConviene() {
  const lista = c1Cinema(), netto = nettoPerSpettatore(lista);
  const prossimi = S.films.filter((f) => nextShow(f));
  $("#cv-film").innerHTML = `<option value="">Un film nuovo (scegli giorno e orario)</option>${prossimi.map((f) => `<option value="${esc(f.id)}">${esc(f.titolo)} · ${showsOf(f).filter((p) => p.data >= TODAY).length} proiezioni in programma</option>`).join("")}`;
  $("#cv-netto").value = netto ? r2(netto) : "";
  $("#cv-netto-hint").textContent = lista.length ? `media degli ultimi 12 mesi (${lista.length} proiezioni), IVA esclusa` : "nessun C1 di cinema negli ultimi 12 mesi: scrivilo tu";
  const a = S.isAdmin && S.primaNota.length ? analisiTariffe() : null;
  $("#cv-altri").value = a && isFinite(a.variabileGiorno) ? Math.round(a.variabileGiorno) : 0;
  aggiornaConviene();
  dlgConv.showModal();
}
function aggiornaConviene() {
  const fid = $("#cv-film").value, tipo = $("#cv-tipo").value;
  $("#cv-quando").hidden = !!fid;
  $("#cv-perc-wrap").hidden = tipo === "forfait"; $("#cv-min-wrap").hidden = tipo !== "perc"; $("#cv-forfait-wrap").hidden = tipo !== "forfait";
  const c = { tipo, perc: Number($("#cv-perc").value) || 0, minimo: Number($("#cv-minimo").value) || 0, forfait: Number($("#cv-forfait").value) || 0, netto: Number($("#cv-netto").value) || 0, altri: Number($("#cv-altri").value) || 0 };
  const f = fid && S.films.find((x) => x.id === fid);
  const slot = f ? showsOf(f).filter((p) => p.data >= TODAY).map((p) => ({ g: parse(p.data).getDay(), fa: fascia(p.ora), et: `${fmtShort(p.data)} ${p.ora}` }))
    : Array.from({ length: Math.max(1, Number($("#cv-n").value) || 1) }, () => ({ g: Number($("#cv-giorno").value), fa: $("#cv-fascia").value, et: `${GIORNI[Number($("#cv-giorno").value)]} ${$("#cv-fascia").value}` }));
  if (!c.netto || !c1Cinema().length) { $("#cv-esito").innerHTML = `<div class="warn">Servono i C1 delle proiezioni passate e l'incasso netto per spettatore.</div>`; return; }
  const righe = slot.map((s) => ({ ...s, ...attesiSlot(s.g, s.fa) })), pa = pareggio(c);
  // il minimo garantito di solito vale per il film intero se le proiezioni sono più d'una: lo spalmo sulle proiezioni
  const cTot = { ...c, minimo: c.minimo / righe.length, forfait: c.forfait / righe.length };
  const tot = (k) => righe.reduce((s, r) => s + margineProiezione(r[k], cTot).margine, 0);
  const mMedia = tot("media"), mBasso = tot("basso"), mAlto = tot("alto");
  const paTot = pareggio(cTot), attesiMedia = mean(righe.map((r) => r.media));
  const verdetto = mBasso >= 0 ? `<div class="ok-note">Conviene: anche in una serata scarsa si va in pari. Margine previsto <b>${money(Math.round(mMedia))}</b> (tra ${money(Math.round(mBasso))} e ${money(Math.round(mAlto))}).</div>`
    : mMedia >= 0 ? `<div class="warn" style="background:var(--opz-bg);color:var(--opz-fg)">Si può fare, con un po' di rischio: in media si guadagnano <b>${money(Math.round(mMedia))}</b>, ma con poco pubblico si perdono fino a ${money(Math.round(-mBasso))}. Servono almeno <b>${paTot}</b> spettatori a proiezione; di solito ne vengono ${Math.round(attesiMedia)}.</div>`
    : `<div class="warn">Non conviene a queste condizioni: servono <b>${paTot ?? "oltre 600"}</b> spettatori a proiezione per andare in pari, di solito ne vengono ${Math.round(attesiMedia)}. Perdita prevista <b>${money(Math.round(-mMedia))}</b>. Prova a chiedere un minimo più basso o un orario con più pubblico.</div>`;
  $("#cv-esito").innerHTML = `${verdetto}
    <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Proiezione</th><th class="n">Spettatori attesi</th><th class="n">Incasso netto</th><th class="n">Margine</th></tr></thead><tbody>
      ${righe.map((r) => { const m = margineProiezione(r.media, cTot); return `<tr><td>${esc(r.et)}<div class="hint">${esc(r.come)}</div></td><td class="n">${Math.round(r.media)} <span class="hint">(${Math.round(r.basso)}–${Math.round(r.alto)})</span></td><td class="n">${money(Math.round(m.incasso))}</td><td class="n ${m.margine < 0 ? "neg" : ""}">${money(Math.round(m.margine))}</td></tr>`; }).join("")}
    </tbody></table></div>
    <p class="hint">Pareggio di una singola proiezione con queste condizioni: ${pa ?? "oltre 600"} spettatori${righe.length > 1 ? `; con ${righe.length} proiezioni ${c.tipo === "forfait" ? "il forfait" : "il minimo garantito"} si divide e bastano ${paTot ?? "oltre 600"} spettatori a proiezione` : ""}. La percentuale del distributore è calcolata sull'incasso al netto dell'IVA.</p>`;
}

/* ---------- consigli di programmazione ---------- */
// rassegna di ogni C1: il settore della prima nota in cui è registrato l'incasso di quella serata
function settoreDiC1(c) {
  const r = S.primaNota.find((x) => x.data === c.data && x.entrate > 0 && (x.cod_settore || 0) >= 100 && /^E01$/i.test(x.cod_cat || "")) || S.primaNota.find((x) => (x.cod_settore || 0) >= 100 && normT(x.evento || "") && normT(x.evento).includes(normT(c.titolo).slice(0, 12)));
  return r ? r.settore : "";
}
function consigliProgrammazione(list) {
  const out = [], media = mean(list.map((c) => c.spettatori)), netto = nettoPerSpettatore(list);
  // costo medio di noleggio per proiezione di cinema (solo l'amministratore vede la prima nota)
  const anni = new Set(list.map((c) => +c.data.slice(0, 4)));
  const noleggi = S.primaNota.filter((r) => anni.has(r.anno) && r.uscite > 0 && (/^U01$/i.test(r.cod_cat || "") || /noleggio/i.test(r.categoria)));
  const proiezCinema = list.filter((c) => anni.has(+c.data.slice(0, 4))).length;
  const nolMedio = noleggi.length && proiezCinema ? sommaU(noleggi) / proiezCinema : 0;
  const soglia = nolMedio && netto ? Math.ceil(nolMedio / netto) : 0;
  // fasce sotto la soglia di pareggio o molto sotto la media
  const celle = ORDINE_GIORNI.flatMap((g) => ["pomeriggio", "sera"].map((fa) => ({ g, fa, cs: list.filter((c) => giorno(c) === g && fascia(c.ora) === fa) }))).filter((x) => x.cs.length >= 3);
  celle.forEach((x) => (x.avg = mean(x.cs.map((c) => c.spettatori))));
  const deboli = celle.filter((x) => (soglia ? x.avg < soglia : x.avg < media * 0.6)).sort((a, b) => a.avg - b.avg);
  const forti = celle.filter((x) => x.avg > media * 1.3).sort((a, b) => b.avg - a.avg);
  if (soglia) out.push(`<b>Soglia di pareggio</b>: un film costa in media ${money(Math.round(nolMedio))} di noleggio a proiezione e ogni spettatore porta ${money(r2(netto))} netti, quindi servono circa <b>${soglia} spettatori</b> per coprire il noleggio.`);
  const il = (g) => (g === 0 ? "la domenica" : `il ${GIORNI[g]}`);
  const d2 = deboli.slice(0, 2), f2 = forti.slice(0, 2);
  if (d2.length) out.push(`<b>Da ripensare</b>: ${d2.map((x) => `${il(x.g)} ${x.fa} (${Math.round(x.avg)} spettatori in media su ${x.cs.length} proiezioni)`).join(" e ")} ${soglia ? (d2.length > 1 ? "restano sotto la soglia di pareggio" : "resta sotto la soglia di pareggio") : d2.length > 1 ? "rendono molto meno della media" : "rende molto meno della media"}: lì meglio ridurre le proiezioni o mettere solo titoli forti.`);
  if (f2.length) out.push(`<b>Da sfruttare</b>: ${f2.map((x) => `${il(x.g)} ${x.fa} (${Math.round(x.avg)} in media)`).join(" e ")}: è lì che conviene mettere i film su cui si punta di più.`);
  // italiani o stranieri (dalla nazionalità del C1)
  const ita = list.filter((c) => /ital/i.test(c.nazionalita || "")), est = list.filter((c) => c.nazionalita && !/ital/i.test(c.nazionalita));
  if (ita.length >= 3 && est.length >= 3) { const mi = mean(ita.map((c) => c.spettatori)), me = mean(est.map((c) => c.spettatori));
    out.push(`<b>Italiani o stranieri</b>: i film italiani portano ${Math.round(mi)} spettatori a proiezione, gli stranieri ${Math.round(me)}${Math.abs(mi - me) / Math.max(mi, me) > 0.2 ? ` (${mi > me ? "gli italiani" : "gli stranieri"} rendono di più)` : ", più o meno uguale"}.`); }
  // omaggi
  const sp = list.reduce((s, c) => s + c.spettatori, 0), om = list.reduce((s, c) => s + c.omaggi, 0);
  if (sp && om / sp > 0.08) out.push(`<b>Omaggi</b>: sono il ${Math.round(om / sp * 100)}% degli ingressi; se sono tanti, valuta di limitarli alle serate con poco pubblico.`);
  // film portati due volte: se il secondo passaggio rende meno della metà
  return { out, soglia, nolMedio };
}
function renderRassegne(list) {
  if (!S.primaNota.length) return "";
  const per = new Map();
  for (const c of list) { const s = settoreDiC1(c) || "Senza rassegna"; if (!per.has(s)) per.set(s, []); per.get(s).push(c); }
  const anni = new Set(list.map((c) => +c.data.slice(0, 4)));
  const righe = [...per.entries()].map(([s, cs]) => {
    const mov = S.primaNota.filter((r) => r.settore === s && anni.has(r.anno));
    const marg = mov.length ? sommaE(mov) - sommaU(mov) : null;
    return { s, n: cs.length, media: mean(cs.map((c) => c.spettatori)), riemp: mean(cs.map(fill)), marg, margPr: marg === null ? null : marg / cs.length };
  }).sort((a, b) => b.n - a.n);
  if (righe.length < 2) return "";
  return `<div class="panel" style="margin-top:14px"><h2>Le rassegne a confronto</h2><span class="hint">Dai C1 e dalla prima nota del periodo · margine = entrate meno uscite della rassegna</span>
    <div class="tbl-wrap"><table><thead><tr><th>Rassegna</th><th class="n">Proiezioni</th><th class="n">Spettatori medi</th><th class="n">Riempimento</th><th class="n">Margine</th><th class="n">a proiezione</th></tr></thead><tbody>
    ${righe.map((r) => `<tr><td>${esc(r.s)}</td><td class="n">${r.n}</td><td class="n">${Math.round(r.media)}</td><td class="n">${pct(r.riemp)}</td><td class="n ${r.marg < 0 ? "neg" : ""}">${r.marg === null ? "—" : money(Math.round(r.marg))}</td><td class="n ${r.margPr < 0 ? "neg" : ""}">${r.margPr === null ? "—" : money(Math.round(r.margPr))}</td></tr>`).join("")}
    </tbody></table></div></div>`;
}

/* ---------- preventivo dell'anno ---------- */
function renderPreventivo() {
  const el = $("#pv-body");
  if (!el) return;
  if (!S.isAdmin) { el.innerHTML = ""; return; }
  const anno = S.pnYear, Y = String(anno), corrente = anno === new Date().getFullYear();
  if (!S.preventivoDb) { el.innerHTML = `<div class="panel" style="margin-top:14px"><h2>Preventivo ${anno}</h2><div class="warn">Per il preventivo esegui in Supabase lo script <b>015_preventivo.sql</b> e ricarica la pagina.</div></div>`; return; }
  const prev = (S.preventivo && S.preventivo[Y]) || {};
  const pn = S.primaNota.filter((r) => r.anno === anno);
  const settori = new Map();
  [...S.primaNota].sort((a, b) => (a.cod_settore || 0) - (b.cod_settore || 0)).forEach((r) => { if (r.cod_settore != null && !settori.has(String(r.cod_settore))) settori.set(String(r.cod_settore), r.settore); });
  Object.keys(prev).forEach((k) => { if (!settori.has(k)) settori.set(k, prev[k].nome || k); });
  const giorni = Math.round((parse(corrente ? TODAY : `${Y}-12-31`) - parse(`${Y}-01-01`)) / 864e5) + 1, f = corrente ? 365 / giorni : 1;
  const righe = [...settori.entries()].map(([k, nome]) => {
    const mov = pn.filter((r) => String(r.cod_settore) === k), ce = sommaE(mov), cu = sommaU(mov), p = prev[k] || {};
    const stE = corrente ? ce * f : ce, stU = corrente ? cu * f : cu;
    const avvisi = [];
    if (p.u > 0 && cu > p.u) avvisi.push(`uscite oltre il previsto di ${money(Math.round(cu - p.u))}`);
    else if (p.u > 0 && corrente && stU > p.u * 1.05) avvisi.push(`a questo ritmo le uscite arrivano a ${money(Math.round(stU))}`);
    if (p.e > 0 && corrente && stE < p.e * 0.85 && giorni > 90) avvisi.push(`a questo ritmo le entrate arrivano a ${money(Math.round(stE))}`);
    return { k, nome, p, ce, cu, stE, stU, avvisi };
  });
  const T = (fn) => righe.reduce((s, r) => s + (fn(r) || 0), 0);
  const prevRis = T((r) => r.p.e) - T((r) => r.p.u), consRis = T((r) => r.ce) - T((r) => r.cu);
  const conAvvisi = righe.filter((r) => r.avvisi.length);
  // proposta: il consuntivo dell'anno prima, se in prima nota; altrimenti la proiezione dell'anno in corso
  // l'anno prima vale solo se in prima nota c'è davvero (non qualche riga di partite arretrate)
  const primaTutta = S.primaNota.filter((r) => r.anno === anno - 1), prima = new Set(primaTutta.map((r) => r.data.slice(0, 7))).size >= 6 ? primaTutta : [];
  const proposta = () => Object.fromEntries(righe.map((r) => { const mv = prima.filter((x) => String(x.cod_settore) === r.k); return [r.k, { nome: r.nome, e: Math.round(prima.length ? sommaE(mv) : r.stE), u: Math.round(prima.length ? sommaU(mv) : r.stU) }]; }));
  const vuoto = !Object.keys(prev).length;
  el.innerHTML = `<div class="panel" style="margin-top:14px">
    <div class="section-head"><h2>Preventivo ${anno}</h2><span class="hint">Entrate e uscite previste per settore, confrontate con la prima nota${corrente ? ` · «a fine anno» proietta i ${giorni} giorni trascorsi` : ""}</span></div>
    ${conAvvisi.length ? `<div class="warn" style="margin-bottom:10px">${conAvvisi.map((r) => `<b>${esc(r.nome)}</b>: ${r.avvisi.join("; ")}`).join("<br>")}</div>` : !vuoto ? `<div class="ok-note" style="margin-bottom:10px">Tutti i settori sono dentro il preventivo.</div>` : ""}
    ${vuoto ? `<p class="hint">Il preventivo ${anno} è vuoto. Scrivi le cifre previste oppure parti da una proposta: ${prima.length ? `il consuntivo ${anno - 1}` : "la proiezione dell'anno in corso"}.</p><button class="btn sm" type="button" id="pv-proponi">Proponi le cifre</button>` : ""}
    <form id="pv-form" novalidate><div class="tbl-wrap"><table class="pv"><thead><tr><th>Settore</th><th class="n">Entrate previste</th><th class="n">Entrate finora</th><th class="n">Uscite previste</th><th class="n">Uscite finora</th>${corrente ? `<th class="n">Saldo a fine anno</th>` : ""}</tr></thead><tbody>
      ${righe.map((r) => `<tr class="${r.avvisi.length ? "pv-avviso" : ""}"><td>${esc(r.nome)}</td>
        <td class="n"><input type="number" min="0" step="1" inputmode="numeric" data-k="${esc(r.k)}" data-c="e" value="${r.p.e ?? ""}" aria-label="Entrate previste ${esc(r.nome)}"></td><td class="n">${money(Math.round(r.ce))}${r.p.e ? `<div class="hint">${Math.round(r.ce / r.p.e * 100)}%</div>` : ""}</td>
        <td class="n"><input type="number" min="0" step="1" inputmode="numeric" data-k="${esc(r.k)}" data-c="u" value="${r.p.u ?? ""}" aria-label="Uscite previste ${esc(r.nome)}"></td><td class="n ${r.p.u && r.cu > r.p.u ? "neg" : ""}">${money(Math.round(r.cu))}${r.p.u ? `<div class="hint">${Math.round(r.cu / r.p.u * 100)}%</div>` : ""}</td>
        ${corrente ? `<td class="n ${r.stE - r.stU < 0 ? "neg" : ""}">${money(Math.round(r.stE - r.stU))}</td>` : ""}</tr>`).join("")}
      <tr class="tot"><td><b>Totale</b></td><td class="n"><b>${money(Math.round(T((r) => r.p.e)))}</b></td><td class="n">${money(Math.round(T((r) => r.ce)))}</td><td class="n"><b>${money(Math.round(T((r) => r.p.u)))}</b></td><td class="n">${money(Math.round(T((r) => r.cu)))}</td>${corrente ? `<td class="n">${money(Math.round(T((r) => r.stE - r.stU)))}</td>` : ""}</tr>
    </tbody></table></div>
    <p class="hint">Risultato previsto ${money(Math.round(prevRis))} · finora ${money(Math.round(consRis))}. Le proiezioni a fine anno sono indicative: bollette e assicurazione arrivano a scadenze irregolari.</p>
    <div class="actions"><button class="btn primary" type="submit">Salva il preventivo</button></div></form></div>`;
  const salva = async (dati) => {
    const tutto = { ...(S.preventivo || {}), [Y]: dati };
    try { await run(sb.from("settings").update({ preventivo: tutto }).eq("id", 1), "Preventivo salvato"); } catch (x) { toast(errText(x)); }
  };
  if ($("#pv-proponi")) $("#pv-proponi").onclick = () => salva(proposta());
  $("#pv-form").onsubmit = (e) => {
    e.preventDefault();
    const dati = {};
    el.querySelectorAll("input[data-k]").forEach((i) => { const k = i.dataset.k; dati[k] = dati[k] || { nome: settori.get(k) }; if (i.value !== "") dati[k][i.dataset.c] = Number(i.value); });
    salva(Object.fromEntries(Object.entries(dati).filter(([, v]) => v.e != null || v.u != null)));
  };
}

function route() {
  const h = location.hash.slice(1);
  S.view = VIEWS[h] && canSee(h) ? h : "calendario";
  render();
}
addEventListener("hashchange", route);

let tt;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 2600); }
