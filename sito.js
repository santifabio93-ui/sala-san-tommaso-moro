// © 2026 Parrocchia di San Biagio Vescovo e Martire – Sala San Tommaso Moro. Tutti i diritti riservati (vedi LICENSE).
// Controllo del sito della sala (WordPress): legge le pagine pubbliche e le confronta con il programma dell'app.
// Funzioni pure, senza dipendenze, così si possono provare anche fuori dal browser.

export const SITO = "https://www.salasantommasomoro.it";
export const SITO_API = SITO + "/wp-json/wp/v2/pages?per_page=100&_fields=id,title,link,modified,content";

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const GIORNI = ["domenica", "luned", "marted", "mercoled", "gioved", "venerd", "sabato"];
const RE_DATA = new RegExp(`(?:(luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)\\s+)?(\\d{1,2})\\s+(${MESI.join("|")})(?:\\s+(\\d{4}))?`, "gi");
const RE_ORA = /\b(?:ore\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)\b|\bore\s+([01]?\d|2[0-3])\b(?![:.]\d)/gi;
const PAROLE_VUOTE = new Set("il lo la i gli le un una uno di a da in con su per tra fra e ed o che del dello della dei degli delle al allo alla ai agli alle dal dalla nel nella sul sulla film the of and".split(" "));

const pad = (n) => String(n).padStart(2, "0");
const isoData = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const entita = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", middot: "·", laquo: "«", raquo: "»", egrave: "è", eacute: "é", agrave: "à", ograve: "ò", igrave: "ì", ugrave: "ù" };

// testo leggibile della pagina, una riga per blocco
export function testoDaHtml(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|h\d|li|div|figure|section|tr|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, e) => entita[e.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
}

// parole significative, senza accenti né punteggiatura
export function parole(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((w) => w && !PAROLE_VUOTE.has(w));
}

// quanta parte del titolo dell'app si ritrova nel testo del sito (0–1);
// le parole lunghe valgono anche con un finale diverso («Monster» / «Monsters»)
const radice = (w) => { if (w.length > 4 && w.endsWith("s")) w = w.slice(0, -1); return w.length >= 6 && /[aeio]$/.test(w) ? w.slice(0, -1) : w; };
export function somiglianza(titolo, testo) {
  const t = [...new Set(parole(titolo).map(radice))];
  if (!t.length) return 0;
  const nel = new Set(parole(testo).map(radice));
  return t.filter((w) => nel.has(w)).length / t.length;
}
const stessoTitolo = (titolo, testo) => { const n = new Set(parole(titolo)).size; return somiglianza(titolo, testo) >= (n <= 2 ? 1 : 0.6); };

// gli appuntamenti scritti nelle pagine: data, orari vicini e il testo attorno (per riconoscere il titolo)
export function appuntamentiDelSito(pagine, oggi) {
  const out = [];
  const anno0 = +oggi.slice(0, 4);
  for (const p of pagine || []) {
    const testo = testoDaHtml(p.content && p.content.rendered);
    const nome = testoDaHtml(p.title && p.title.rendered) || p.link;
    const date = [...testo.matchAll(RE_DATA)];
    date.forEach((m, i) => {
      const g = +m[2], mese = MESI.indexOf(m[3].toLowerCase()) + 1;
      let anno = m[4] ? +m[4] : anno0;
      if (!m[4]) { // senza anno: quello che rende la data più vicina a oggi
        const scarto = (a) => Math.abs(new Date(a, mese - 1, g) - new Date(oggi));
        anno = [anno0 - 1, anno0, anno0 + 1].sort((a, b) => scarto(a) - scarto(b))[0];
      }
      const d = new Date(anno, mese - 1, g);
      if (d.getMonth() !== mese - 1) return; // data impossibile
      // giorno della settimana scritto sul sito, se non corrisponde alla data
      const scritto = m[1] ? GIORNI.findIndex((x) => m[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").startsWith(x)) : -1;
      const giornoSbagliato = scritto >= 0 && scritto !== d.getDay() ? m[0].trim() : "";
      const fine = i + 1 < date.length ? date[i + 1].index : testo.length;
      const inizio = Math.max(i > 0 ? date[i - 1].index + date[i - 1][0].length : 0, m.index - 160);
      const dopo = testo.slice(m.index + m[0].length, fine);
      const ore = [...new Set([...dopo.slice(0, 260).matchAll(RE_ORA)].map((o) => (o[3] ? pad(o[3]) + ":00" : pad(o[1]) + ":" + o[2])))];
      const intorno = testo.slice(inizio, Math.min(fine, m.index + m[0].length + 400));
      const righe = dopo.split("\n").map((r) => r.trim()).filter((r) => r.length > 2 && !/^(ore|orario|ingresso|inizio|biglietti?|la storia|\d)/i.test(r) && !/^[·\s\d:.e]+$/.test(r));
      out.push({ data: isoData(d), ore, giornoSbagliato, pagina: nome, link: p.link, home: /^https?:\/\/[^/]+\/?$/.test(p.link || ""), intorno, titolo: righe[0] || "" });
    });
  }
  return out;
}

// confronto: cosa manca o è sbagliato sul sito rispetto all'app.
// app = [{ chiave, data, ora, titolo, tipo: "cinema" | "evento", annullato }]
export function confronta(sito, app, oggi, { giorni = 45, giorniSito = 120 } = {}) {
  const fino = isoData(new Date(new Date(oggi).getTime() + giorni * 86400000));
  const finoSito = isoData(new Date(new Date(oggi).getTime() + giorniSito * 86400000));
  const problemi = [];
  const fmt = (s) => new Date(s + "T12:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  // 1. appuntamenti dell'app che sul sito mancano o hanno un orario diverso
  const gruppi = {};
  for (const a of app) if (!a.annullato && a.data >= oggi && a.data <= fino) (gruppi[a.data + "|" + a.titolo] = gruppi[a.data + "|" + a.titolo] || []).push(a);
  for (const lista of Object.values(gruppi)) {
    const a = lista[0], ore = [...new Set(lista.map((x) => x.ora).filter(Boolean))].sort();
    const trovati = sito.filter((s) => s.data === a.data && stessoTitolo(a.titolo, s.intorno));
    if (!trovati.length) {
      // con un'altra data: confronto solo con il titolo vero e proprio, non con le intestazioni vicine
      const altrove = sito.find((s) => s.data >= oggi && s.titolo && stessoTitolo(a.titolo, s.titolo));
      // gli eventi del calendario (anche affitti privati) si segnalano solo se sul sito hanno un'altra data
      if (a.tipo !== "cinema" && !altrove) continue;
      problemi.push({ chiave: "manca|" + a.data + "|" + a.titolo, tipo: "manca", data: a.data,
        testo: `Manca «${a.titolo}» di ${fmt(a.data)}${ore.length ? " alle " + ore.join(" e ") : ""}`
          + (altrove ? ` (sul sito c'è con un'altra data: ${fmt(altrove.data)}, pagina ${altrove.pagina})` : "") });
      continue;
    }
    if (a.tipo === "cinema" && ore.length) {
      const sulSito = [...new Set(trovati.flatMap((s) => s.ore))];
      const mancano = ore.filter((o) => !sulSito.includes(o));
      if (mancano.length && sulSito.length) problemi.push({ chiave: "ora|" + a.data + "|" + a.titolo + "|" + ore.join(","), tipo: "orario", data: a.data,
        testo: `Orario da correggere per «${a.titolo}» di ${fmt(a.data)}: in programma ${ore.join(" e ")}, sul sito ${sulSito.join(" e ")} (pagina ${trovati[0].pagina})` });
    }
  }
  // 2. sul sito ci sono appuntamenti futuri che nell'app non risultano (spostati, annullati o mai inseriti)
  const visti = new Set();
  for (const s of sito) {
    if (s.data < oggi || s.data > finoSito) continue;
    const quelGiorno = app.filter((a) => a.data === s.data);
    const annullato = quelGiorno.find((a) => a.annullato && stessoTitolo(a.titolo, s.intorno));
    if (quelGiorno.some((a) => !a.annullato && stessoTitolo(a.titolo, s.intorno))) continue;
    const k = (annullato ? "annullato|" : "nonapp|") + s.data + "|" + (s.titolo || s.pagina);
    if (visti.has(k)) continue;
    visti.add(k);
    if (annullato) problemi.push({ chiave: k, tipo: "annullato", data: s.data, testo: `«${annullato.titolo}» di ${fmt(s.data)} è annullato ma è ancora sul sito (pagina ${s.pagina})` });
    else if (!quelGiorno.some((a) => !a.annullato)) problemi.push({ chiave: k, tipo: "verifica", data: s.data,
      testo: `Sul sito c'è un appuntamento di ${fmt(s.data)}${s.titolo ? ` («${s.titolo}»)` : ""} che nel calendario della sala non risulta: è ancora confermato? (pagina ${s.pagina})` });
  }
  // 3. date scritte con il giorno della settimana sbagliato
  for (const s of sito) if (s.giornoSbagliato && s.data >= oggi && s.data <= finoSito)
    problemi.push({ chiave: "giorno|" + s.data + "|" + s.pagina, tipo: "giorno", data: s.data,
      testo: `Giorno della settimana sbagliato nella pagina ${s.pagina}: c'è scritto «${s.giornoSbagliato}», ma è ${fmt(s.data).split(" ")[0]}` });
  // 4. in Home restano appuntamenti già passati
  const passati = sito.filter((s) => s.home && s.data < oggi);
  if (passati.length) {
    const ultimo = passati.sort((x, y) => y.data.localeCompare(x.data))[0];
    problemi.push({ chiave: "home|" + passati.map((s) => s.data).sort().join(","), tipo: "home", data: ultimo.data,
      testo: `In Home c'è ancora ${passati.length > 1 ? `${passati.length} appuntamenti già passati, l'ultimo di` : "l'appuntamento di"} ${fmt(ultimo.data)}${ultimo.ore.length ? " alle " + ultimo.ore.join(" e ") : ""}${passati.length > 1 ? "" : ", già passato"}` });
  }
  const ordine = { manca: 0, orario: 1, giorno: 2, annullato: 3, home: 4, verifica: 5 };
  return problemi.sort((x, y) => ordine[x.tipo] - ordine[y.tipo] || x.data.localeCompare(y.data));
}
