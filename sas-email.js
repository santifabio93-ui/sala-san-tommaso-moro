// © 2026 Fabio Santi, per la Sala San Tommaso Moro. Tutti i diritti riservati (vedi LICENSE).
// Lettura delle email del SAS (ACEC Triveneta): conferme di programmazione e risposte alle richieste di film.
// Funzioni pure, senza dipendenze, così si possono provare anche fuori dal browser.

const GG = "(?:lun|mar|mer|gio|ven|sab|dom)";
const pad = (n) => String(n).padStart(2, "0");
const numero = (s) => Number(String(s || "").replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")) || 0;
export const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// testo leggibile: niente asterischi del grassetto, tabelle, citazioni e righe vuote doppie
export function pulisci(testo) {
  return String(testo || "").replace(/\r/g, "").replace(/\*/g, "").replace(/\|/g, " ").replace(/\[\]\(#\)/g, "").replace(/[ \t ]+/g, " ");
}
// solo il messaggio nuovo, senza la parte citata della risposta
export function senzaCitazione(testo) {
  const t = String(testo || "").replace(/\r/g, "");
  const m = t.match(/\n\s*(?:>|Il giorno .{5,120}ha scritto|Il (?:lun|mar|mer|gio|ven|sab|dom)[^\n]{3,120}ha scritto|On .{5,120}wrote|-{5,}\s*(?:Messaggio|Forwarded|Original))/i);
  return m ? t.slice(0, m.index) : t;
}
// "gg/mm" senza anno: l'anno che rende la data più vicina alla data dell'email (al massimo un mese prima)
function dataDa(g, m, rif) {
  const d0 = new Date(rif), y = d0.getFullYear();
  let d = new Date(y, m - 1, g);
  if (d < new Date(y, d0.getMonth() - 1, d0.getDate())) d = new Date(y + 1, m - 1, g);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// "Sentence case" per i titoli scritti in maiuscolo; il titolo originale tra parentesi va a parte
export function titoloLeggibile(t) {
  t = String(t || "").trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
  const orig = (t.match(/\(([^)]+)\)\s*$/) || [])[1] || "";
  let tit = orig ? t.slice(0, t.lastIndexOf("(")).trim() : t;
  const bello = (s) => (s === s.toUpperCase() && /[A-Z]/.test(s) ? s.charAt(0) + s.slice(1).toLowerCase().replace(/([-–:.!?]\s+|\(|«|")([a-zàèéìòù])/g, (x, a, b) => a + b.toUpperCase()) : s);
  return { titolo: bello(tit), originale: bello(orig) };
}
// condizioni da un testo: «min. € 150.00 + 40.00%», «mg 200 al 30%», «€ 400», «45%»
export function condizioni(testo) {
  const t = pulisci(testo);
  const min = t.match(/(?:min\.?|minimo(?: garantito)?|mg)\s*(?:€\s*)?([\d.,]+)/i);
  const perc = t.match(/(?:\+|al|a)\s*([\d.,]+)\s*%/i) || t.match(/([\d.,]+)\s*%/);
  const fisso = !min && !perc ? t.match(/€\s*([\d.,]+)/) : null;
  const sup = t.match(/\b(dvd|blu-?ray|link|mp4|dcp|kdm)\b/i);
  const agenzia = (t.match(/\b(MPLC|Athena(?: Cinematografica)?|PGA|Cinemacs|Cineteca di Bologna)\b/i) || [])[1] || "";
  const no = /(embargo|non si pu[oò]|scadut[ie]|non (?:è )?disponibil|non concess|non autorizz|non ha autorizzazion)/i.test(t);
  return {
    minimo: min ? numero(min[1]) : null,
    percentuale: perc ? numero(perc[1]) : null,
    fisso: fisso ? numero(fisso[1]) : null,
    supporto: sup ? ({ mp4: "Link", kdm: "DCP" }[sup[1].toLowerCase()] || (/blu/i.test(sup[1]) ? "Blu-ray" : sup[1].toUpperCase() === "DVD" ? "DVD" : sup[1].charAt(0).toUpperCase() + sup[1].slice(1).toLowerCase())) : "",
    agenzia, nonDisponibile: no && !min && !perc,
  };
}

// email automatiche «Conferme programmazione» / «Proposta programmazione»: una riga per data
export function confermeProgrammazione(testo, dataEmail) {
  const t = pulisci(senzaCitazione(testo)).replace(/\n+/g, " ").replace(/\s+/g, " ");
  const re = new RegExp(`\\b${GG}\\s+(\\d{1,2})\\/(\\d{1,2})\\s+(.+?)\\s+Agenzia:\\s*(.*?)\\s+Distributore:\\s*(.*?)\\s+Supporto:\\s*(.*?)\\s*Prezzo:\\s*(.*?)(?=\\s+${GG}\\s+\\d{1,2}\\/\\d{1,2}\\s|\\s+Cordiali [Ss]aluti|$)`, "gi");
  const out = [];
  for (const m of t.matchAll(re)) {
    const prezzo = m[7].trim(), c = condizioni(prezzo);
    const note = prezzo.replace(/^\s*(?:min\.?\s*)?€?\s*[\d.,]+(?:\s*\+\s*[\d.,]+\s*%)?\s*/i, "").replace(/^-\s*/, "").trim();
    const { titolo, originale } = titoloLeggibile(m[3]);
    out.push({
      data: dataDa(+m[1], +m[2], dataEmail), titolo, originale,
      agenzia: m[4].trim(), distributore: m[5].trim(), supporto: m[6].replace(/\s*-\s*/g, " / ").replace(/BluRay/i, "Blu-ray").trim(),
      minimo: /min/i.test(prezzo) && c.minimo ? c.minimo : null, percentuale: c.percentuale || null, fisso: /min/i.test(prezzo) || c.percentuale ? null : c.minimo ?? c.fisso,
      note,
    });
  }
  return out;
}

// risposta scritta a mano (Christian, Arianna): le righe che parlano di quel film
export function rispostaPerFilm(testo, titolo) {
  const righe = pulisci(senzaCitazione(testo)).split("\n").map((r) => r.trim()).filter(Boolean);
  const k = norm(titolo), corto = k.slice(0, Math.min(14, k.length));
  const i = righe.findIndex((r) => { const n = norm(r); return n.includes(k) || (corto.length >= 6 && n.includes(corto)); });
  if (i < 0) return null;
  // la riga del titolo e, se lì non ci sono condizioni, la successiva
  let riga = righe[i], c = condizioni(riga);
  if (c.minimo == null && c.percentuale == null && c.fisso == null && !c.nonDisponibile && righe[i + 1]) { riga += " " + righe[i + 1]; c = condizioni(riga); }
  if (c.minimo == null && c.percentuale == null && c.fisso == null && !c.nonDisponibile && !c.supporto) return null;
  return { riga: riga.slice(0, 300), ...c };
}

// cose da fare per un film confermato, dalle note e dal supporto: chiave, testo e quando
export function scadenzeFilm(f) {
  const n = `${f.note || ""} ${f.risposta || ""}`, sup = `${f.supporto || ""}`, out = [];
  const meno = (iso, g) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() - g); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  if (/pagamento anticipat|bonifico anticipat|anticipat[oa] del minimo/i.test(n) || (/mplc/i.test(f.agenzia || "") && f.minimo))
    out.push({ k: "pagamento", testo: `Bonifico anticipato${f.minimo ? ` del minimo (${f.minimo} €)` : ""}`, entro: meno(f.prima, 10) });
  if (/link|mp4/i.test(sup)) out.push({ k: "link", testo: "Controllare che sia arrivato il link per scaricare il film", entro: meno(f.prima, 7) });
  else if (/dvd|blu/i.test(sup)) out.push({ k: "supporto", testo: /ritir/i.test(n) ? "Ritirare il DVD/Blu-ray in agenzia (chiamare 10 giorni prima)" : "Ricevere il DVD/Blu-ray", entro: meno(f.prima, /ritir/i.test(n) ? 10 : 7) });
  if (/restitu/i.test(n)) out.push({ k: "restituire", testo: "Restituire il DVD/Blu-ray", entro: meno(f.ultima, -3) });
  if (/eliminar|cancellar/i.test(n)) out.push({ k: "elimina", testo: "Cancellare il file dopo la proiezione", entro: meno(f.ultima, -1) });
  return out;
}
