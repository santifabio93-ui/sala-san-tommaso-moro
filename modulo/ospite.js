import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
import { TIPI_EVENTO_SALA, SEZIONI_EVENTO_SALA, campoEventoSala } from '../evento-sala-campi.js?v=2026-11-01.86';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const root=document.getElementById('ospite-body'), cfg=window.SALA_CONFIG || {};
const token=new URLSearchParams(location.search).get('t');
async function avvia(){
 if(!token || !cfg.supabaseUrl || !cfg.supabaseAnonKey)throw new Error('Link non disponibile. Chiedi un nuovo invito al referente della Sala.');
 const sb=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data:r,error}=await sb.rpc('ospite_evento_apri',{p_token:token});
 if(error)throw new Error('Non riesco a leggere l’invito. Riprova tra poco o contatta la Sala.');
 if(!r)throw new Error('Link non più disponibile. Chiedi un nuovo invito al referente della Sala.');
 root.innerHTML=`<section><h2>${esc(r.titolo)}</h2><p>${esc(r.data)} · ${esc(r.inizio)}–${esc(r.fine)} · ${esc(TIPI_EVENTO_SALA[r.tipo])}</p><p>Il referente ti chiede soltanto le parti riportate qui sotto. Le richieste saranno verificate dalla Sala prima della conferma.</p>${r.stato==='confermato'?'<p>Le precedenti esigenze sono state confermate. Se invii delle modifiche, la Sala dovrà verificarle nuovamente.</p>':r.stato==='da_verificare'?'<p>Risposta già inviata, in attesa di verifica. Puoi aggiornarla.</p>':''}</section><form id="ospite-form"><section><h2>Chi compila</h2><div class="fields"><div class="field h"><label for="ospite-nome">Nome e cognome</label><input id="ospite-nome" required minlength="3" maxlength="120" autocomplete="name" value="${esc(r.nome_compilatore)}"></div><div class="field h"><label for="ospite-contatto">Telefono o email</label><input id="ospite-contatto" required minlength="6" maxlength="200" value="${esc(r.contatto_compilatore)}"></div></div></section>${r.sezioni.map(s=>`<section><h2>${SEZIONI_EVENTO_SALA[s].titolo}</h2><p class="hint">${s==='audio'?'Descrivi almeno come sarà usato l’audio.':s==='video'?'Indica almeno contenuto e formato o supporto.':s==='palco'?'Indica almeno persone e disposizione sul palco.':s==='luci'?'Descrivi almeno le esigenze delle luci.':'Indica almeno arrivo, referente tecnico o operativo e cellulare.'}</p><div class="fields">${SEZIONI_EVENTO_SALA[s].campi.map(c=>campoEventoSala(c,r.dati[c[0]],esc,'ospite-')).join('')}</div></section>`).join('')}<section><div class="field"><label for="ospite-documento">Link alla scheda tecnica (facoltativo)</label><input id="ospite-documento" type="url" value="${esc(r.dati.documento_tecnico_url || '')}" placeholder="https://…"></div><p class="hint">Se usi una cartella condivisa, verifica che la Sala possa aprirla.</p></section><p id="ospite-error" class="es-errore" role="alert"></p><button class="btn primary" id="ospite-invia" type="submit">Invia alla Sala</button></form>`;
 root.querySelector('form').onsubmit=async e=>{
  e.preventDefault(); const btn=root.querySelector('#ospite-invia'), err=root.querySelector('#ospite-error'); btn.disabled=true;err.textContent='';
  const dati=Object.fromEntries([...root.querySelectorAll('[data-campo-tecnico]')].filter(el=>el.value.trim()!=='').map(el=>[el.dataset.campoTecnico,el.value.trim()]));
  dati.documento_tecnico_url=root.querySelector('#ospite-documento').value.trim();
  try{
   const {error}=await sb.rpc('ospite_evento_invia',{p_token:token,p_dati:dati,p_nome:root.querySelector('#ospite-nome').value.trim(),p_contatto:root.querySelector('#ospite-contatto').value.trim(),p_revisione:r.revisione});
   if(error)throw error;
   root.innerHTML='<section><h2>Informazioni inviate</h2><p>Grazie! Le esigenze sono ora da verificare dalla Sala. Il referente ti contatterà per la conferma.</p><p>Puoi riaprire questo stesso link per aggiornare la tua risposta.</p></section>';
  }catch(error){err.textContent=error.message;btn.disabled=false;}
 };
}
avvia().catch(error=>{root.innerHTML=`<p role="alert">${esc(error.message)}</p>`;});
