export const TIPI_EVENTO_SALA = { conferenza: 'Conferenza o incontro', teatro: 'Spettacolo teatrale', concerto: 'Concerto', danza: 'Danza o saggio', proiezione: 'Proiezione' };
export const SEZIONI_PER_TIPO = {
  conferenza: ['audio', 'video', 'logistica'], teatro: ['palco', 'audio', 'luci', 'video', 'logistica'],
  concerto: ['palco', 'audio', 'luci', 'video', 'logistica'], danza: ['palco', 'audio', 'luci', 'video', 'logistica'],
  proiezione: ['video', 'audio', 'logistica'],
};
export const SEZIONI_EVENTO_SALA = {
 audio: { titolo: 'Audio e microfoni', campi: [
  ['audio_uso','Come sarà usato l’audio?','textarea'],['mic_filo_n','Microfoni a filo richiesti','number'],['radiomic_n','Radiomicrofoni richiesti','number'],['mic_tavolo_n','Microfoni da tavolo richiesti','number'],['impianto_proprio','Impianto o strumenti audio portati dall’ospite','textarea'],['audio_note','Altre esigenze audio','textarea']] },
 video: { titolo: 'Slide, video e proiezione', campi: [
  ['contenuti_video','Che cosa sarà proiettato?','textarea'],['supporto_video','Formato o supporto (slide, file, DVD, link…)','text'],['connessione_video','Dispositivo e collegamento necessari','text'],['sottotitoli','Lingua, sottotitoli ed esigenze di accessibilità','text'],['video_note','Altre esigenze di proiezione e prova','textarea']] },
 palco: { titolo: 'Palco, allestimento e scenografie', campi: [
  ['persone_palco','Persone sul palco','number'],['disposizione_palco','Disposizione sul palco e ingombri','textarea'],['scenografie','Scenografie e materiali portati','textarea'],['palco_note','Altre esigenze di palco','textarea']] },
 luci: { titolo: 'Luci di scena', campi: [
  ['esigenze_luci','Esigenze e impostazione delle luci','textarea'],['luci_proprie','Apparecchi portati dall’ospite','textarea'],['luci_note','Altre esigenze luci','textarea']] },
 logistica: { titolo: 'Arrivo, montaggio, prove e tecnico', campi: [
  ['arrivo','Arrivo previsto','time'],['montaggio_dalle','Montaggio dalle','time'],['prove_dalle','Prove dalle','time'],['prove_alle','Prove fino alle','time'],['smontaggio_entro','Smontaggio e partenza entro','time'],['referente_tecnico','Referente tecnico o operativo','text'],['cellulare_tecnico','Cellulare del referente tecnico o operativo','tel'],['logistica_note','Accesso, scarico, accoglienza e altre necessità','textarea']] },
};
export function campoEventoSala([key,label,type], value, esc, prefix = 'tecnica-') {
 const id = prefix + key;
 return `<div class="field ${type === 'textarea' ? '' : 'h'}"><label for="${id}">${label}</label>${type === 'textarea' ? `<textarea maxlength="4000" id="${id}" data-campo-tecnico="${key}">${esc(value || '')}</textarea>` : `<input maxlength="4000" id="${id}" data-campo-tecnico="${key}" type="${type}"${type === 'number' ? ' min="0" max="100" step="1"' : ''} value="${esc(value ?? '')}">`}</div>`;
}
