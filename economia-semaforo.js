// Stessa regola per amministratore e Parroco, senza nuove letture o scritture contabili.
export function situazioneEconomica(righe, anno, fino = null, errore = false) {
 const selezione = righe.filter(r => Number(r.anno) === Number(anno) && (!fino || r.data <= fino));
 if (errore || !selezione.length || selezione.some(r => r.entrate == null || r.uscite == null || !Number.isFinite(Number(r.entrate)) || !Number.isFinite(Number(r.uscite)))) return { colore:'ignoto',etichetta:'Da verificare',anno,fino };
 const entrate = selezione.reduce((s,r) => s + Math.round(Number(r.entrate)*100),0);
 const uscite = selezione.reduce((s,r) => s + Math.round(Number(r.uscite)*100),0);
 const risultato = entrate-uscite, soglia = Math.max(0,Math.round(uscite*.05));
 const colore = risultato < 0 ? 'rosso' : risultato <= soglia ? 'giallo' : 'verde';
 return {colore,etichetta:({verde:'In positivo',giallo:'Vicino al pareggio',rosso:'In perdita'})[colore],anno,fino,entrate:entrate/100,uscite:uscite/100,risultato:risultato/100,soglia:soglia/100};
}

export function semaforoEconomicoHTML(d, {esc,money}) {
 const valido = d.colore !== 'ignoto';
 const periodo = d.fino ? `, fino al ${d.fino.split('-').reverse().join('/')}` : '';
 return `<section class="panel eco-semaforo eco-${d.colore}" data-semaforo-economico="${d.colore}" aria-label="Situazione economica ${esc(d.anno)}"><div class="eco-luci" aria-hidden="true">${['rosso','giallo','verde'].map(c => `<span class="eco-luce eco-luce-${c}${d.colore === c ? ' accesa' : ''}"></span>`).join('')}</div><div class="eco-contenuto"><h3>Situazione economica ${esc(d.anno)}</h3><p class="eco-esito"><b>${esc(valido ? d.colore[0].toUpperCase()+d.colore.slice(1)+' · '+d.etichetta : d.etichetta)}</b>${valido ? `<strong>${d.risultato>0 ? '+' : ''}${esc(money(d.risultato))}</strong>` : ''}</p>
 ${valido ? `<p>Entrate ${esc(money(d.entrate))} · uscite ${esc(money(d.uscite))}</p><details><summary>Come viene calcolato</summary><p>Prima nota di competenza ${esc(d.anno)}${esc(periodo)}. Comprende anche eventuali movimenti previsti registrati per questo periodo; non indica il denaro disponibile in banca.</p><p>Rosso: risultato sotto zero. Giallo: da zero a ${esc(money(d.soglia))} (5% delle uscite). Verde: oltre ${esc(money(d.soglia))}.</p></details>` : '<p class="hint">Prima nota non disponibile o nessun movimento per questo periodo. Il colore verrà calcolato quando i dati saranno disponibili.</p>'}</div></section>`;
}
