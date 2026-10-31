// © 2026 Fabio Santi, per la Sala San Tommaso Moro. Tutti i diritti riservati (vedi LICENSE).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

// Scheda di richiesta online: l'organizzatore la apre dal link personale (?t=codice), senza account.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cfg = window.SALA_CONFIG || {};
const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false } });
const token = new URLSearchParams(location.search).get("t");
const BOZZA = "stm-scheda-" + token;
const fmtData = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "");

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); }
function mostra(html) { $("#app").innerHTML = html; }

// --- elementi del modulo ---
const scelta = (nome, opzioni, valore, tipo = "radio") => `<div class="scelte" data-campo="${nome}">${opzioni.map(([v, l]) =>
  `<label><input type="${tipo}" name="${nome}" value="${v}"${(tipo === "radio" ? valore === v : (valore || []).includes(v)) ? " checked" : ""}> ${l}</label>`).join("")}</div>`;
const campo = (nome, etichetta, v, extra = "", obb = false, cls = "") => `<div class="campo ${cls}"><label for="f-${nome}" class="${obb ? "obbl" : ""}">${etichetta}</label><input id="f-${nome}" name="${nome}" value="${esc(v)}" ${extra}></div>`;
const voce = (nome, etichetta, d, num = null) => `<label class="voce"><input type="checkbox" name="${nome}"${d[nome] ? " checked" : ""}> ${etichetta}${num ? `<input type="number" name="${num.nome}" min="0" max="${num.max || 99}" value="${esc(d[num.nome] ?? "")}" aria-label="Quanti" placeholder="n.">` : ""}</label>`;

function rigaOrari(r, i) {
  return `<div class="riga-orari" data-riga="${i}">
    <div class="campo"><label class="${i === 0 ? "obbl" : ""}">Data</label><input type="date" name="o_data" value="${esc(r.data)}"></div>
    <div class="campo"><label>Allestim. dalle</label><input type="time" name="o_all_da" value="${esc(r.all_da)}"></div>
    <div class="campo"><label>alle</label><input type="time" name="o_all_a" value="${esc(r.all_a)}"></div>
    <div class="campo"><label>Porte</label><input type="time" name="o_porte" value="${esc(r.porte)}"></div>
    <div class="campo"><label class="${i === 0 ? "obbl" : ""}">Inizio</label><input type="time" name="o_inizio" value="${esc(r.inizio)}"></div>
    <div class="campo"><label>Fine</label><input type="time" name="o_fine" value="${esc(r.fine)}"></div>
    <div class="campo"><label>Sgombero</label><input type="time" name="o_sgombero" value="${esc(r.sgombero)}"></div>
    ${i > 0 ? `<button class="btn ghost sm" type="button" data-togli="${i}" aria-label="Togli il giorno">✕</button>` : "<span></span>"}
  </div>`;
}

function modulo(d, info) {
  const orari = d.orari && d.orari.length ? d.orari : [{ data: info.data || "", inizio: info.giornata_intera ? "" : info.inizio || "", fine: info.giornata_intera ? "" : info.fine || "" }];
  return `
  ${info.stato === "compilata" ? `<div class="ok-note no-print">Avete già inviato la scheda il ${esc(new Date(info.compilata_il).toLocaleDateString("it-IT"))}. Potete correggerla e inviarla di nuovo.</div>` : ""}
  ${info.stato === "respinta" ? `<div class="warn no-print">La sala ha chiesto di rivedere alcune risposte: correggetele e inviate di nuovo la scheda.</div>` : ""}
  <p>Gentile organizzatore, compilate questa scheda per ${info.titolo ? `<b>${esc(info.titolo)}</b>` : "il vostro evento"}${info.data ? ` del <b>${esc(fmtData(info.data))}</b>` : ""}. Ci vogliono circa 5 minuti; i campi con <span style="color:var(--due-fg)">*</span> sono obbligatori. Le risposte si salvano su questo dispositivo mentre scrivete.</p>
  <form id="scheda" novalidate>
  <section class="sez"><h2><span class="n">1</span>Chi organizza</h2>
    <div class="griglia">
      ${campo("ente", "Ente, associazione o persona", d.ente, "", true, "full")}
      <div class="campo full"><span class="lbl">Richiedete la sala come</span>${scelta("a_titolo", [["parrocchia", "gruppo della Parrocchia"], ["comune", "Comune"], ["associazione", "associazione"], ["scuola", "scuola"], ["privato", "privato"], ["altro", "altro"]], d.a_titolo)}</div>
      ${campo("cf", "Codice fiscale o P. IVA (per la ricevuta)", d.cf)}
      ${campo("indirizzo", "Indirizzo", d.indirizzo)}
      ${campo("referente", "Referente", d.referente ?? info.referente, "autocomplete=\"name\"", true)}
      ${campo("cellulare", "Cellulare", d.cellulare ?? info.telefono, "type=\"tel\" autocomplete=\"tel\"", true)}
      ${campo("email", "Email", d.email ?? info.email, "type=\"email\" autocomplete=\"email\"", false, "full")}
      ${campo("resp_sera", "Responsabile presente il giorno dell'evento (se diverso)", d.resp_sera)}
      ${campo("resp_cell", "Suo cellulare", d.resp_cell, "type=\"tel\"")}
    </div></section>

  <section class="sez"><h2><span class="n">2</span>L'evento</h2>
    <div class="griglia">
      ${campo("titolo", "Titolo", d.titolo ?? info.titolo, "", true, "full")}
      <div class="campo full"><span class="lbl obbl">Tipo di evento</span>${scelta("tipo", [["teatro", "teatro"], ["concerto", "concerto"], ["danza", "danza / saggio"], ["cinema", "cinema / proiezione"], ["conferenza", "conferenza / incontro"], ["scuola", "scuola"], ["altro", "altro"]], d.tipo)}</div>
      <div class="campo full"><label for="f-descrizione">In breve, cosa succede</label><textarea id="f-descrizione" name="descrizione">${esc(d.descrizione)}</textarea></div>
      <div class="campo full"><span class="lbl">Ingresso</span>${scelta("ingresso", [["libero", "libero"], ["offerta", "a offerta"], ["pagamento", "a pagamento"]], d.ingresso)}
        <div class="cond" data-se="ingresso=pagamento"><div class="griglia">${campo("prezzo", "Prezzo del biglietto (€)", d.prezzo, "inputmode=\"decimal\"")}
          <div class="campo"><span class="lbl">Biglietti gestiti da</span>${scelta("biglietti", [["sala", "la sala (Cinebot)"], ["organizzatore", "voi"]], d.biglietti)}</div></div></div></div>
      <div class="cond campo full" data-se-in="tipo=teatro,concerto,danza,cinema"><span class="hint">Spettacoli, concerti, danza e proiezioni si fanno in <b>platea</b>, che ha il palco (fino a 338 persone).</span>
        <label class="voce" style="margin-top:6px"><input type="checkbox" name="galleria_anche"${d.galleria_anche || d.fascia === "tutta" ? " checked" : ""}> Serve anche la galleria (più di 338 persone, fino a 472)</label></div>
      <div class="cond campo full" data-se-in="tipo=conferenza,scuola,altro"><span class="lbl obbl">Spazio</span>${scelta("fascia", [["galleria", "galleria, fino a 134 persone (conferenze e incontri)"], ["platea", "platea con il palco, fino a 338"], ["tutta", "platea e galleria, fino a 472"]], d.fascia)}</div>
      <div class="campo full"><div class="scelte">
        <label>Persone previste <input class="num" type="number" min="0" max="472" name="pubblico_n" value="${esc(d.pubblico_n ?? "")}"></label>
        <label>di cui bambini <input class="num" type="number" min="0" name="bambini_n" value="${esc(d.bambini_n ?? "")}"></label>
        <label>persone in carrozzina <input class="num" type="number" min="0" name="carrozzina_n" value="${esc(d.carrozzina_n ?? "")}"></label>
        <label>persone sul palco <input class="num" type="number" min="0" name="palco_n" value="${esc(d.palco_n ?? "")}"></label></div>
        <span class="hint">Se vengono bambini piccoli, avvisate le famiglie: i passeggini non sono ammessi in sala.</span></div>
    </div></section>

  <section class="sez"><h2><span class="n">3</span>Date e orari</h2><span class="hint">Una riga per ogni giorno. La sala va lasciata libera entro l'orario di sgombero.</span>
    <div id="orari">${orari.map(rigaOrari).join("")}</div>
    <button class="btn sm no-print" type="button" id="aggiungi-giorno" style="margin-top:8px">+ Aggiungi un giorno</button></section>

  <section class="sez"><h2><span class="n">4</span>Palco e tecnica</h2><span class="hint">Spuntate solo ciò che vi serve: impianti e attrezzature della sala si usano con il personale della sala.</span>
    <div class="voci">
      ${voce("luci", "luci di scena", d)}${voce("sipario", "sipario e quinte", d)}${voce("audio", "impianto audio", d)}
      ${voce("mic_filo", "microfoni a filo", d, { nome: "mic_filo_n", max: 5 })}${voce("radiomic", "radiomicrofoni (max 2)", d, { nome: "radiomic_n", max: 2 })}
      ${voce("proiettore", "proiettore e schermo (HDMI)", d)}${voce("tavolo", "tavolo relatori, posti", d, { nome: "tavolo_n", max: 10 })}
      ${voce("mic_tavolo", "microfoni da tavolo (max 3)", d, { nome: "mic_tavolo_n", max: 3 })}
    </div>
    <div class="campo" style="margin-top:12px"><span class="lbl">Tecnico</span>${scelta("tecnico", [["nostro", "abbiamo un nostro tecnico"], ["nessuno", "non serve"]], d.tecnico === "sala" ? "" : d.tecnico)}<span class="hint">La sala non ha un tecnico: se vi servono luci o audio oltre all'uso semplice, portate il vostro.</span></div>
    <div class="cond" data-se="tecnico=nostro"><div class="griglia">${campo("tecnico_nome", "Nome del tecnico", d.tecnico_nome)}${campo("tecnico_cell", "Cellulare del tecnico", d.tecnico_cell, "type=\"tel\"")}</div></div>
    <div class="campo" style="margin-top:12px"><span class="lbl">Portate attrezzature da collegare alla corrente (fari, mixer, amplificatori…)?</span>${scelta("attrezzature", [["no", "no"], ["si", "sì"]], d.attrezzature)}</div>
    <div class="cond" data-se="attrezzature=si"><div class="griglia">${campo("attrezzature_quali", "Quali", d.attrezzature_quali)}${campo("potenza_w", "Potenza totale circa (Watt)", d.potenza_w, "inputmode=\"numeric\"")}</div>
      <span class="hint">Se possibile inviate la scheda tecnica a salatommasomoro@gmail.com</span></div>
  </section>

  <section class="sez"><h2><span class="n">5</span>Scenografie, effetti e altro</h2>
    <div class="campo"><span class="lbl">Portate scenografie o arredi?</span>${scelta("scenografie", [["no", "no"], ["si", "sì"]], d.scenografie)}</div>
    <div class="cond" data-se="scenografie=si"><div class="griglia">${campo("scenografie_quali", "Cosa portate", d.scenografie_quali, "", false, "full")}</div>
      <label class="voce" style="margin-top:8px"><input type="checkbox" name="ignifughi"${d.ignifughi ? " checked" : ""}> Tessuti e materiali di scena sono ignifughi (classe 1) e ne portiamo il certificato</label></div>
    <div class="campo" style="margin-top:12px"><span class="lbl">Effetti speciali</span>${scelta("effetti", [["nessuno", "nessuno"], ["fumo", "macchina del fumo o della nebbia"], ["altro", "altro"]], d.effetti)}
      <span class="hint">Fiamme, candele, petardi e coriandoli non sono ammessi.</span></div>
    <div class="cond" data-se="effetti=altro">${campo("effetti_quali", "Quali effetti", d.effetti_quali)}</div>
    <div class="campo" style="margin-top:12px"><span class="lbl">Durante l'evento</span>${scelta("durante", [["riprese", "riprese video o foto"], ["streaming", "diretta streaming"], ["vendita", "vendita di libri, CD o altro"]], (d.durante || []).filter((x) => x !== "rinfresco"), "checkbox")}</div>
    <div class="griglia" style="margin-top:12px">
      <div class="campo"><span class="lbl">Possiamo pubblicare l'evento nel programma della sala?</span>${scelta("pubblicabile", [["si", "sì"], ["no", "no"]], d.pubblicabile)}</div>
      ${campo("locandina_entro", "Ci mandate la locandina entro il", d.locandina_entro, "type=\"date\"")}
      <div class="campo full"><label for="f-altro">Altre richieste o esigenze</label><textarea id="f-altro" name="altro">${esc(d.altro)}</textarea></div>
    </div></section>

  ${info.siae_sala ? "" : `<section class="sez"><h2><span class="n">6</span>SIAE e diritti d'autore</h2>
    <span class="hint">Il permesso SIAE e i diritti d'autore sono <b>a carico dell'organizzatore</b>. Servono quando nell'evento si usano musica (dal vivo o registrata), film, spettacoli o altre opere protette.</span>
    <div class="campo"><span class="lbl obbl">L'evento usa musica, film o altre opere protette da diritto d'autore?</span>${scelta("siae", [["si", "sì"], ["no", "no, nessuna opera protetta"]], d.siae)}</div>
    <div class="cond" data-se="siae=si">
      <div class="campo" style="margin-top:10px"><label for="f-siae-file">Allegate il permesso SIAE (PDF o foto, massimo 10 MB)</label>
        <input id="f-siae-file" type="file" accept="application/pdf,image/*" class="no-print">
        <div id="siae-caricati" class="hint">${(d.siae_file || []).map((f) => `✓ ${esc(f.nome)} allegato`).join("<br>")}</div></div>
      <label class="voce" style="margin-top:8px"><input type="checkbox" name="siae_dopo"${d.siae_dopo ? " checked" : ""}> Il permesso non l'abbiamo ancora: lo mandiamo a salatommasomoro@gmail.com prima dell'evento</label>
    </div>
  </section>`}

  <section class="sez"><h2><span class="n">${info.siae_sala ? 6 : 7}</span>Regole della sala e dichiarazione</h2>
    <div class="regole">
      <h3>Sicurezza</h3><ul><li>Non sono ammessi fiamme libere, candele, petardi, fuochi d'artificio, fumogeni, bombolette di gas e materiali infiammabili.</li><li>Uscite di emergenza e percorsi d'esodo sempre liberi; le uscite di emergenza si usano solo in caso di pericolo; l'ascensore è riservato alle persone con disabilità.</li><li>Il numero di persone non può superare la capienza indicata (massimo 472). Non sono ammessi oggetti atti a offendere.</li></ul>
      <h3>Impianti</h3><ul><li>Impianti, regia, quadri elettrici, termostati e riscaldamento si usano solo con il personale della sala.</li><li>Le attrezzature esterne si collegano solo dove indica il responsabile della sala: niente prese multiple né cavi lungo pareti e vie d'esodo. Niente lavorazioni che producono scintille, polveri o fumi.</li></ul>
      <h3>In sala</h3><ul><li>Vietato fumare, anche sigarette elettroniche. Cibo e bevande non sono ammessi in sala.</li><li>Non sono ammessi animali, tranne i cani guida e di assistenza. Non sono ammessi in sala passeggini e carrozzine per bambini; sono ammesse le carrozzine per persone con disabilità.</li></ul>
      <h3>Palco e riconsegna</h3><ul><li>Si portano solo i materiali dichiarati; scenografie e tessuti ignifughi (classe 1).</li><li>A fine evento palco libero e sala riconsegnata come trovata, entro l'orario di sgombero. La sala non custodisce materiali dell'organizzatore.</li></ul>
      <h3>Dichiarazione</h3><ol><li>L'organizzatore solleva la Parrocchia di San Biagio e il gestore della Sala San Tommaso Moro da ogni danno a persone o cose dovuto a un uso improprio della sala e delle attrezzature o al mancato rispetto delle norme di sicurezza per i locali di pubblico spettacolo.</li><li>Si fa carico dei danni ad arredi e attrezzature causati da organizzatori, artisti o pubblico dell'evento.</li><li>Solleva la Parrocchia e il gestore da ogni responsabilità per furti o danni a materiali e attrezzature dell'organizzatore lasciati nella sala, e per l'annullamento dell'evento per cause non dipendenti dalla sala.</li><li>${info.siae_sala ? "Provvede alle altre autorizzazioni per l'evento; la SIAE la fa la sala (evento co-organizzato)." : "Provvede a proprie spese al permesso SIAE e ai diritti d'autore, se previsti, e alle altre autorizzazioni per l'evento, e consegna alla sala copia del permesso SIAE."}</li></ol>
    </div>
    <label class="accetta"><input type="checkbox" name="ok_regole"${d.ok_regole ? " checked" : ""}> <span class="obbl">Abbiamo letto le regole della sala e ci impegniamo a farle rispettare</span></label>
    <label class="accetta"><input type="checkbox" name="ok_dichiarazione"${d.ok_dichiarazione ? " checked" : ""}> <span class="obbl">Accetto la dichiarazione dell'organizzatore</span></label>
    <label class="accetta"><input type="checkbox" name="ok_privacy"${d.ok_privacy ? " checked" : ""}> <span class="obbl">Ho letto che i dati di questa scheda sono usati dalla Parrocchia di San Biagio solo per gestire la richiesta, l'evento e i pagamenti</span></label>
    <div class="griglia" style="margin-top:12px">${campo("firma", "Nome e cognome di chi compila (vale come firma)", d.firma, "autocomplete=\"name\"", true, "full")}</div>
  </section>

  <div id="errori"></div>
  <div class="invia"><button class="btn primary" type="submit" id="btn-invia">Invia la scheda alla sala</button><span class="hint">Dopo l'invio potete ancora correggerla, finché la sala non la approva.</span></div>
  </form>`;
}

// --- lettura del modulo ---
function leggi() {
  const f = $("#scheda"), d = {};
  for (const el of f.elements) {
    if (!el.name || el.name.startsWith("o_")) continue;
    if (el.type === "radio") { if (el.checked) d[el.name] = el.value; }
    else if (el.type === "checkbox") {
      if (el.closest('.scelte[data-campo]')) { (d[el.name] = d[el.name] || []); if (el.checked) d[el.name].push(el.value); }
      else d[el.name] = el.checked;
    } else if (el.type === "number") { if (el.value !== "") d[el.name] = Number(el.value); }
    else if (el.value.trim()) d[el.name] = el.value.trim();
  }
  d.siae_file = allegati.slice();
  // spettacoli, concerti, danza e proiezioni: platea (con il palco), più la galleria se serve
  if (SPETTACOLI.includes(d.tipo)) d.fascia = d.galleria_anche ? "tutta" : "platea";
  else delete d.galleria_anche;
  d.orari = [...document.querySelectorAll(".riga-orari")].map((r) => {
    const v = (n) => r.querySelector(`[name="o_${n}"]`).value;
    return { data: v("data"), all_da: v("all_da"), all_a: v("all_a"), porte: v("porte"), inizio: v("inizio"), fine: v("fine"), sgombero: v("sgombero") };
  }).filter((o) => o.data || o.inizio);
  return d;
}
function aggiornaCondizioni() {
  const d = leggi();
  document.querySelectorAll("[data-se]").forEach((el) => { const [k, v] = el.dataset.se.split("="); el.hidden = d[k] !== v; });
  document.querySelectorAll("[data-se-in]").forEach((el) => { const [k, v] = el.dataset.seIn.split("="); el.hidden = !v.split(",").includes(d[k]); });
}
function salvaBozza() { try { localStorage.setItem(BOZZA, JSON.stringify(leggi())); } catch (e) {} }
function controlla(d) {
  const mancano = [];
  const segna = (sel, testo) => { mancano.push(testo); const el = document.querySelector(sel); if (el) el.classList.add("errore-campo"); };
  document.querySelectorAll(".errore-campo").forEach((e) => e.classList.remove("errore-campo"));
  if (!d.ente) segna('[name="ente"]', "ente o persona che organizza");
  if (!d.referente) segna('[name="referente"]', "referente");
  if (!d.cellulare) segna('[name="cellulare"]', "cellulare");
  if (!d.titolo) segna('[name="titolo"]', "titolo dell'evento");
  if (!d.tipo) segna('[data-campo="tipo"]', "tipo di evento");
  if (d.tipo && !SPETTACOLI.includes(d.tipo) && !d.fascia) segna('[data-campo="fascia"]', "spazio (galleria o platea)");
  if (!d.orari.length || !d.orari[0].data || !d.orari[0].inizio) segna('.riga-orari', "data e ora di inizio");
  if (!d.siae && !siaeSala) segna('[data-campo="siae"]', "risposta sulla SIAE");
  else if (d.siae === "si" && !siaeSala && !(d.siae_file || []).length && !d.siae_dopo) segna('#f-siae-file', "permesso SIAE (allegatelo o spuntate che lo manderete)");
  if (!d.ok_regole || !d.ok_dichiarazione || !d.ok_privacy) segna('.accetta', "accettazione di regole, dichiarazione e privacy");
  if (!d.firma || d.firma.length < 3) segna('[name="firma"]', "nome e cognome di chi compila");
  return mancano;
}

// --- allegati (permesso SIAE): caricati nella cartella della scheda, visibili solo alla sala ---
let allegati = [], siaeSala = false;
const SPETTACOLI = ["teatro", "concerto", "danza", "cinema"];
async function caricaAllegato(file) {
  const out = $("#siae-caricati");
  if (file.size > 10 * 1024 * 1024) { toast("Il file supera i 10 MB: provate con una foto o un PDF più leggero"); return; }
  const est = (file.name.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
  const percorso = `${token}/siae-${Date.now()}${est}`;
  out.textContent = "Caricamento in corso…";
  const { error } = await sb.storage.from("schede").upload(percorso, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) { out.innerHTML = `<span style="color:var(--due-fg)">Caricamento non riuscito: ${esc(error.message)}. Potete mandarlo per email a salatommasomoro@gmail.com</span>`; return; }
  allegati.push({ percorso, nome: file.name, caricato: new Date().toISOString() });
  out.innerHTML = allegati.map((f) => `✓ ${esc(f.nome)} allegato`).join("<br>");
  salvaBozza();
  document.querySelector("#f-siae-file").classList.remove("errore-campo");
}

// --- avvio ---
async function avvia() {
  if (!token) { mostra(`<div class="esito"><h2>Link non completo</h2><p>Per compilare la scheda usate il link che vi ha mandato la sala. Per informazioni: salatommasomoro@gmail.com</p></div>`); return; }
  const { data: info, error } = await sb.rpc("scheda_apri", { p_token: token });
  if (error || !info) { mostra(`<div class="esito"><h2>Scheda non trovata</h2><p>Il link potrebbe essere scaduto o incompleto. Chiedete alla sala di mandarvene uno nuovo: salatommasomoro@gmail.com</p></div>`); return; }
  if (info.chiusa) { mostra(`<div class="esito"><h2>Scheda già approvata</h2><p>La sala ha già approvato la scheda${info.titolo ? ` per <b>${esc(info.titolo)}</b>` : ""}. Per modifiche contattate la sala: salatommasomoro@gmail.com</p></div>`); return; }
  let d = info.dati || {};
  try { const b = JSON.parse(localStorage.getItem(BOZZA) || "null"); if (b && (!info.compilata_il || Object.keys(d).length === 0)) d = { ...d, ...b }; } catch (e) {}
  allegati = Array.isArray(d.siae_file) ? d.siae_file.slice() : [];
  siaeSala = !!info.siae_sala;
  mostra(modulo(d, info));
  if ($("#f-siae-file")) $("#f-siae-file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) caricaAllegato(f); e.target.value = ""; });
  const f = $("#scheda");
  aggiornaCondizioni();
  f.addEventListener("input", (e) => { e.target.closest(".errore-campo")?.classList.remove("errore-campo"); aggiornaCondizioni(); salvaBozza(); });
  f.addEventListener("change", () => { aggiornaCondizioni(); salvaBozza(); });
  $("#aggiungi-giorno").onclick = () => { const n = document.querySelectorAll(".riga-orari").length; $("#orari").insertAdjacentHTML("beforeend", rigaOrari({}, n)); salvaBozza(); };
  $("#orari").addEventListener("click", (e) => { const b = e.target.closest("[data-togli]"); if (b) { b.closest(".riga-orari").remove(); salvaBozza(); } });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const dati = leggi(), mancano = controlla(dati);
    if (mancano.length) {
      $("#errori").innerHTML = `<div class="warn">Manca ancora: ${mancano.map(esc).join(", ")}.</div>`;
      document.querySelector(".errore-campo")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    $("#errori").innerHTML = "";
    const btn = $("#btn-invia"); btn.disabled = true; btn.textContent = "Invio in corso…";
    const { error: err } = await sb.rpc("scheda_invia", { p_token: token, p_dati: dati, p_firma: dati.firma });
    if (err) { btn.disabled = false; btn.textContent = "Invia la scheda alla sala"; $("#errori").innerHTML = `<div class="warn">Invio non riuscito: ${esc(err.message)}. Riprovate tra poco.</div>`; return; }
    try { localStorage.removeItem(BOZZA); } catch (e2) {}
    window.scrollTo(0, 0);
    mostra(`<div class="esito"><h2>Grazie, scheda inviata!</h2><p>La sala ha ricevuto la scheda per <b>${esc(dati.titolo)}</b>. Vi contatteremo se servono chiarimenti; se volete correggere qualcosa, riaprite lo stesso link.</p>
      <p class="no-print"><button class="btn" type="button" onclick="window.print()">Stampa o salva una copia</button></p></div>` + `<div class="regole" style="margin-top:10px"><b>Riepilogo</b><br>${esc(dati.ente)} · ${esc(dati.referente)} · ${esc(dati.cellulare)}<br>${dati.orari.map((o) => `${esc(fmtData(o.data))}, inizio ${esc(o.inizio)}${o.fine ? ` – fine ${esc(o.fine)}` : ""}`).join("<br>")}<br>Firmato da ${esc(dati.firma)} il ${new Date().toLocaleDateString("it-IT")}</div>`);
  });
}
avvia();
