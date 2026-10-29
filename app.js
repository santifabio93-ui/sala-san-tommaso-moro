import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

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
const DEFAULT_RATES = { tariffaOra: 25, tariffaMezza: 80, tariffaGiorno: 150 };
const VIEWS = {
  calendario: { label: "Calendario", roles: ["admin", "coordinatore", "volontario"] },
  prenotazioni: { label: "Prenotazioni", roles: ["admin", "coordinatore"] },
  richieste: { label: "Richieste", roles: ["admin", "coordinatore"] },
  sopralluoghi: { label: "Sopralluoghi", roles: ["admin", "coordinatore", "volontario"] },
  turni: { label: "Turni", roles: ["admin", "coordinatore", "volontario"] },
  cassa: { label: "Cassa", roles: ["admin", "coordinatore"] },
  economia: { label: "Economia", roles: ["admin"] },
  utenti: { label: "Persone", roles: ["admin"] },
};

const cfg = window.SALA_CONFIG || {};
if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || cfg.supabaseUrl.includes("INSERISCI")) {
  show("setup");
  throw new Error("config.js non compilato");
}
const canSee = (k) => (k === "cassa" ? S.canCassa : VIEWS[k].roles.includes(S.role));
const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { flowType: "pkce" } });

const S = {
  session: null, me: null, role: null, canWrite: false, isAdmin: false, canSign: false,
  bookings: [], expenses: [], signups: [], profiles: [], requests: [], invites: [], rates: { ...DEFAULT_RATES }, sync: {},
  reqFilter: "nuove", fromRequest: null, cassa: [], editingCassa: null, canCassa: false,
  sopralluoghi: [], sopFilter: "prossimi", editingSop: null, sopFromRequest: null,
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
const { data: { session: initial } } = await sb.auth.getSession();
if (!initial) show("login");

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
  $("#tabs").innerHTML = Object.keys(VIEWS).filter(canSee).map((k) => [k, VIEWS[k]]).map(([k, v]) => `<a href="#${k}" data-v="${k}">${v.label}</a>`).join("");
  show("app");
  route();
  await loadAll();
  startRealtime();
}

/* ---------- dati ---------- */
const mapBooking = (r) => ({ ...r, inizio: hm(r.inizio), fine: hm(r.fine), prezzo: Number(r.prezzo) || 0, incassato: Number(r.incassato) || 0, turni: Array.isArray(r.turni) ? r.turni : [] });
const mapSignup = (r) => ({ id: r.id, bookingId: r.booking_id, slotId: r.slot_id, nome: r.nome, uid: r.user_id, creato: r.creato });

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
    ];
    const [b, s, e, st, p, rq, inv, so, ca] = await Promise.all(q.map((x) => x || Promise.resolve({ data: null })));
    const err = [b, s, e, st, p, rq, inv, so, ca].find((r) => r && r.error);
    if (err) toast("Impossibile caricare i dati: " + err.error.message);
    if (b.data) S.bookings = b.data.map(mapBooking);
    if (s.data) S.signups = s.data.map(mapSignup);
    if (e.data) S.expenses = e.data.map((r) => ({ ...r, importo: Number(r.importo) || 0 }));
    if (st.data) {
      S.rates = { tariffaOra: Number(st.data.tariffa_ora), tariffaMezza: Number(st.data.tariffa_mezza), tariffaGiorno: Number(st.data.tariffa_giorno) };
      S.sync = { calendario: st.data.sync_calendario, email: st.data.sync_email };
      S.prezzoBiglietto = st.data.prezzo_biglietto == null ? null : Number(st.data.prezzo_biglietto);
    }
    if (p.data) S.profiles = p.data;
    if (rq.data) S.requests = rq.data;
    if (inv.data) S.invites = inv.data;
    if (ca.data) S.cassa = ca.data.map(mapCassa);
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
  for (const table of ["bookings", "signups", "expenses", "richieste", "cassa", "sopralluoghi"]) channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleReload);
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
function suggestPrice(inizio, fine) {
  const h = hours(inizio, fine), r = S.rates;
  const hourly = h * (Number(r.tariffaOra) || 0);
  const cap = h <= 4 ? Number(r.tariffaMezza) : Number(r.tariffaGiorno);
  return Math.round(cap > 0 ? Math.min(hourly || cap, cap) : hourly);
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

/* ---------- render ---------- */
function render() {
  if (!S.role) return;
  document.querySelectorAll("#tabs a").forEach((a) => { if (a.dataset.v === S.view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  const nReq = S.requests.filter((r) => r.stato === "nuova").length, tabReq = document.querySelector('#tabs a[data-v="richieste"]');
  if (tabReq) tabReq.innerHTML = "Richieste" + (nReq ? `<span class="badge">${nReq}</span>` : "");
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
    econ = `<div class="kpi"><span class="eyebrow">Saldo ${y}</span><b>${money(inc - spe)}</b><small>${money(inc)} incassati − ${money(spe)} spese</small></div>`;
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
  $("#cal-sync").textContent = S.canWrite && S.sync.calendario ? `Google Calendar della sala sincronizzato ${ago(S.sync.calendario)}` : "";
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
  fill("#r-ora", S.rates.tariffaOra); fill("#r-mezza", S.rates.tariffaMezza); fill("#r-giorno", S.rates.tariffaGiorno); fill("#r-biglietto", S.prezzoBiglietto);
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
  if (!b) $("#b-prezzo").value = suggestPrice(v.inizio, v.fine) || "";
  S.draftTurni = turni(v).map((t) => ({ ...t }));
  renderSlotEditor();
  $("#b-giornata").checked = !!v.giornata_intera;
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
  const i = $("#b-inizio").value || "16:00", f = $("#b-fine").value || "20:00";
  S.draftTurni.push(
    { id: uidv(), label: "Allestimento", inizio: addMin(i, -60), fine: i, posti: 2 },
    { id: uidv(), label: "Accoglienza e servizio", inizio: i, fine: f, posti: 2 },
    { id: uidv(), label: "Riordino e pulizie", inizio: f, fine: addMin(f, 60), posti: 2 },
  );
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
$("#b-suggest").onclick = () => { $("#b-prezzo").value = suggestPrice($("#b-inizio").value, $("#b-fine").value) || ""; };
$("#b-saldo").onclick = () => { $("#b-incassato").value = $("#b-prezzo").value || 0; };

$("#booking-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const g = (k) => $("#b-" + k).value.trim();
  const rec = {
    titolo: g("titolo"), referente: g("referente"), tipo: g("tipo"), telefono: g("telefono"), email: g("email"),
    data: g("data"), giornata_intera: $("#b-giornata").checked,
    inizio: $("#b-giornata").checked ? "00:00" : g("inizio"), fine: $("#b-giornata").checked ? "23:59" : g("fine"),
    prezzo: Number(g("prezzo")) || 0, incassato: Number(g("incassato")) || 0, stato: g("stato"), note: g("note"),
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
function openCopyText(text) {
  $("#copy-text").value = text;
  $("#copy-status").textContent = "";
  updateWaLink();
  dlgC.showModal();
}
const updateWaLink = () => { $("#wa-open").href = "https://wa.me/?text=" + encodeURIComponent($("#copy-text").value); };
$("#copy-text").addEventListener("input", updateWaLink);
$("#copy-btn").onclick = () => {
  const ta = $("#copy-text");
  const fallback = () => { ta.focus(); ta.select(); $("#copy-status").textContent = "Testo selezionato: copialo con Copia del tuo dispositivo."; };
  try { navigator.clipboard.writeText(ta.value).then(() => { $("#copy-status").textContent = "Copiato. Ora incollalo nel gruppo WhatsApp."; }, fallback); }
  catch (e) { fallback(); }
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
  el.innerHTML = `<table><thead><tr><th>Data</th><th>Evento</th><th class="n">Spett.</th><th class="n">Online</th><th class="n">Contanti</th><th class="n">POS</th><th class="n">Totale</th><th>Quadratura</th><th class="n">Nuovo saldo</th></tr></thead><tbody>
    ${rows.map((c) => {
      const q = quadratura(c);
      const pill = c.stato === "aperta" ? '<span class="pill acconto">Aperta</span>'
        : q == null ? '<span class="pill annullata">Non contata</span>'
        : Math.abs(q) < 0.005 ? '<span class="pill saldato">Quadra</span>'
        : `<span class="pill dapagare">${q > 0 ? "+" : "−"}${money(Math.abs(q))}</span>`;
      return `<tr class="click" data-c="${esc(c.id)}"><td>${esc(fmtShort(c.data))}</td><td>${esc(cassaTitle(c))}</td><td class="n">${spettatori(c)}</td><td class="n">${money(c.online_euro)}</td><td class="n">${money(c.contanti_euro)}</td><td class="n">${money(c.pos_euro)}</td><td class="n"><b>${money(totBiglietti(c))}</b></td><td>${pill}</td><td class="n">${c.stato === "chiusa" ? money(c.fondo_finale) : "—"}</td></tr>`;
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
  const r = { tariffa_ora: Number($("#r-ora").value) || 0, tariffa_mezza: Number($("#r-mezza").value) || 0, tariffa_giorno: Number($("#r-giorno").value) || 0, prezzo_biglietto: $("#r-biglietto").value === "" ? null : Number($("#r-biglietto").value) };
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
  download(`sala-stm-backup-${stamp}.json`, JSON.stringify({ esportato: new Date().toISOString(), prenotazioni: S.bookings, iscrizioni: S.signups, spese: S.expenses, cassa: S.cassa, sopralluoghi: S.sopralluoghi, tariffe: S.rates, persone: S.profiles }, null, 2), "application/json");
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
function route() {
  const h = location.hash.slice(1);
  S.view = VIEWS[h] && canSee(h) ? h : "calendario";
  render();
}
addEventListener("hashchange", route);

let tt;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 2600); }
