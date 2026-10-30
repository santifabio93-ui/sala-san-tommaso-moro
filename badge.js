// © 2026 Fabio Santi, per la Sala San Tommaso Moro. Tutti i diritti riservati (vedi LICENSE).
// Badge dei volontari: QR code e codice a barre (Code 39, lo stesso tipo della tessera sanitaria, così lo legge
// qualsiasi lettore) con il codice casuale del volontario. Funzioni pure che restituiscono SVG.

const QR_LIB = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";

// Code 39: per ogni carattere 9 elementi (barra, spazio, barra…), n = stretto, w = largo
const C39 = {
  0: "nnnwwnwnn", 1: "wnnwnnnnw", 2: "nnwwnnnnw", 3: "wnwwnnnnn", 4: "nnnwwnnnw", 5: "wnnwwnnnn", 6: "nnwwwnnnn", 7: "nnnwnnwnw", 8: "wnnwnnwnn", 9: "nnwwnnwnn",
  A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn", F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
  K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn", P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn", Z: "nwwnwnnnn", "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "*": "nwnnwnwnn",
};
export function codice39Svg(testo, { altezza = 60, modulo = 2 } = {}) {
  const s = "*" + String(testo).toUpperCase() + "*", largo = modulo * 3, zona = modulo * 10;
  let x = zona, barre = "";
  for (const [i, c] of [...s].entries()) {
    const p = C39[c];
    if (!p) throw new Error("Carattere non valido nel codice a barre: " + c);
    [...p].forEach((e, j) => { const w = e === "w" ? largo : modulo; if (j % 2 === 0) barre += `<rect x="${x}" y="0" width="${w}" height="${altezza}"/>`; x += w; });
    if (i < s.length - 1) x += modulo; // spazio stretto tra un carattere e l'altro
  }
  x += zona;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${altezza}" width="${x}" height="${altezza}" shape-rendering="crispEdges" role="img" aria-label="Codice a barre ${testo}"><rect width="${x}" height="${altezza}" fill="#fff"/><g fill="#000">${barre}</g></svg>`;
}

// QR code (libreria qrcode-generator, caricata solo quando serve)
let caricamento = null;
export function caricaQr() {
  if (window.qrcode) return Promise.resolve();
  return (caricamento = caricamento || new Promise((ok, ko) => {
    const s = Object.assign(document.createElement("script"), { src: QR_LIB, onload: ok, onerror: () => { caricamento = null; ko(new Error("QR non disponibile")); } });
    document.head.appendChild(s);
  }));
}
export function qrSvg(testo, { lato = 8 } = {}) {
  const q = window.qrcode(0, "M");
  q.addData(String(testo));
  q.make();
  const n = q.getModuleCount(), m = 4, tot = (n + m * 2) * lato;
  let p = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) p += `M${(c + m) * lato} ${(r + m) * lato}h${lato}v${lato}h-${lato}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tot} ${tot}" width="${tot}" height="${tot}" shape-rendering="crispEdges" role="img" aria-label="QR code ${testo}"><rect width="${tot}" height="${tot}" fill="#fff"/><path d="${p}" fill="#000"/></svg>`;
}

// la tesserina da stampare (85 × 54 mm, come una carta di credito)
export function tesserinaHtml(nome, badge, ritratto) {
  return `<div class="badge-card">
    <div class="bc-testa">${ritratto ? (ritratto.trim().startsWith("<svg") ? `<span class="bc-ritratto">${ritratto}</span>` : `<img src="${ritratto}" alt="">`) : ""}<div><small>Sala San Tommaso Moro</small><b>Volontario</b></div></div>
    <div class="bc-corpo"><div class="bc-qr">${qrSvg(badge, { lato: 4 })}</div><div class="bc-nome">${String(nome).replace(/[&<>"']/g, "")}</div></div>
    <div class="bc-barre">${codice39Svg(badge, { altezza: 34, modulo: 1 })}<span>${badge}</span></div>
  </div>`;
}
export const STILE_TESSERINA = `
  .badge-card { width: 85mm; height: 54mm; box-sizing: border-box; border: .3mm solid #C9A227; border-radius: 3mm; padding: 2.5mm 3.5mm; display: flex; flex-direction: column; justify-content: space-between; font-family: Arial, sans-serif; background: #fff; color: #13262A; overflow: hidden; break-inside: avoid; }
  .bc-testa { display: flex; gap: 2mm; align-items: center; } .bc-testa img, .bc-ritratto svg { width: 9mm; height: 9mm; display: block; }
  .bc-testa small { display: block; font-size: 2.6mm; letter-spacing: .2mm; text-transform: uppercase; color: #6b5a1c; } .bc-testa b { font-size: 3.6mm; }
  .bc-corpo { display: flex; gap: 3mm; align-items: center; } .bc-qr svg { width: 20mm; height: 20mm; display: block; }
  .bc-nome { font-size: 4.6mm; font-weight: 700; line-height: 1.15; }
  .bc-barre { text-align: center; } .bc-barre svg { height: 8mm; width: auto; max-width: 100%; display: block; margin: 0 auto; } .bc-barre span { font-size: 2.4mm; letter-spacing: .6mm; }`;
