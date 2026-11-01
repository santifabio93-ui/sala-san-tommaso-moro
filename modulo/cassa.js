import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
const cfg=window.SALA_CONFIG || {},root=document.getElementById('cb-app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const euro=n=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(n || 0);
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const TAGLI=[200,100,50,20,10,5,2,1,.5,.2,.1,.05,.02,.01];
const sb=cfg.supabaseUrl && cfg.supabaseAnonKey?createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}):null;
let sessione=null,stato=null,corrente=null,ultimo=Date.now(),timer=null;
// Il badge e la sessione non vengono memorizzati in URL, cookie o archivi del browser.
async function rpc(nome,dati){
 const {data,error}=await sb.rpc(nome,dati);
 if(error)throw new Error(error.code==='PGRST202'?'La cassa con badge richiede l’aggiornamento 043. Contatta il responsabile della Sala.':error.message);
 if(data?.ok===false)throw new Error(data.errore || 'Operazione non riuscita');
 return data;
}
function letturaAutomatica(input,form){
 let attesa;
 const annulla=()=>clearTimeout(attesa);
 input.addEventListener('input',()=>{
  annulla();const codice=input.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(/^STM[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(codice))attesa=setTimeout(()=>{if(form.isConnected && !form.querySelector('[type=submit]').disabled)form.requestSubmit();},150);
 });
 form.addEventListener('submit',annulla);
 return annulla;
}
function accesso(messaggio=''){
 clearInterval(timer);if(chiusura.open)chiusura.close();sessione=null;stato=null;corrente=null;
 root.innerHTML=`<section class="panel cb-login"><h2>Leggi il badge della Sala</h2><p>Passa il codice a barre o il QR davanti al lettore. Puoi anche scrivere il codice e premere Invio.</p><form id="cb-accesso"><div class="field"><label for="cb-badge">Codice del badge</label><input id="cb-badge" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="100" placeholder="STM…" required></div><button class="btn primary" type="submit">Entra in cassa</button></form><p class="${messaggio.startsWith('Cassa chiusa')?'cb-success':'cb-error'}" id="cb-error" role="alert">${esc(messaggio)}</p><p class="hint">Il responsabile abilita il badge dalla scheda del volontario. Non serve un account sul computer.</p></section>`;
 const input=root.querySelector('#cb-badge');setTimeout(()=>input.focus(),30);
 letturaAutomatica(input,root.querySelector('#cb-accesso'));
 root.querySelector('form').onsubmit=async e=>{
  e.preventDefault();const badge=input.value.trim();input.value='';if(!badge)return;
  const btn=root.querySelector('[type=submit]');btn.disabled=true;
  try{
   const r=await rpc('cassa_badge_accesso',{p_badge:badge});sessione=r.sessione;await carica();
   let ultimoControllo=Date.now();
   timer=setInterval(()=>{
    if(!sessione)return;
    if(Date.now()-ultimo>20*60000){esci('Sessione terminata per inattività. Leggi il badge per continuare.');return;}
    if(Date.now()-ultimoControllo>5*60000){ultimoControllo=Date.now();rpc('cassa_badge_leggi',{p_sessione:sessione,p_data:stato.data}).catch(errore);}
   },15000);
  }catch(error){if(!sessione){root.querySelector('#cb-error').className='cb-error';root.querySelector('#cb-error').textContent=error.message;btn.disabled=false;input.focus();}else accesso(error.message);}
 };
}
async function esci(msg=''){
 const token=sessione;accesso(msg);
 if(token)try{await sb.rpc('cassa_badge_esci',{p_sessione:token});}catch{}
}
async function carica(data=null){
 stato=await rpc('cassa_badge_leggi',{p_sessione:sessione,p_data:data});corrente=null;elenco();
}
function elenco(messaggio=''){
 root.innerHTML=`<div class="toolbar"><div><b>Alla cassa: ${esc(stato.nome)}</b><div>${esc(stato.data)}</div></div><div class="actions"><button class="btn" id="cb-esci">Esci / cambia cassiere</button><button class="btn" id="cb-ricarica">Ricarica</button></div></div>${stato.ieri_consentito?'<div class="field"><label for="cb-giorno">Serata</label><select id="cb-giorno"></select></div>':''}<p class="cb-esito" role="status">${esc(messaggio)}</p><div class="panel"><span class="hint">Fondo proposto dall’ultima chiusura</span><h2>${euro(stato.fondo_proposto)}</h2><button class="btn primary" id="cb-nuova">+ Apri cassa</button></div><div>${stato.casse.map(c=>`<section class="panel"><h3>${esc(c.titolo)}</h3><p>${c.stato==='chiusa'?'Chiusa':'Aperta'}${c.aperta_da_nome?' · aperta da '+esc(c.aperta_da_nome):''}${c.chiusa_da_nome?' · chiusa da '+esc(c.chiusa_da_nome):''}</p><p>Incasso biglietti: ${euro(Number(c.online_euro)+Number(c.contanti_euro)+Number(c.pos_euro))} · fondo finale: ${euro(c.fondo_finale)}</p><button class="btn" data-cb-apri="${c.id}">${c.stato==='chiusa'?'Vedi riepilogo':'Apri / continua'}</button></section>`).join('') || '<p>Ancora nessuna cassa per questa serata.</p>'}</div><p id="cb-error" class="cb-error" role="alert"></p>`;
 root.querySelector('#cb-esci').onclick=()=>esci();
 root.querySelector('#cb-ricarica').onclick=()=>carica(stato.data).catch(errore);
 root.querySelector('#cb-nuova').onclick=()=>modulo(null);
 root.querySelectorAll('[data-cb-apri]').forEach(el=>el.onclick=()=>modulo(stato.casse.find(c=>c.id===el.dataset.cbApri)));
 if(stato.ieri_consentito){
  const giorno=root.querySelector('#cb-giorno'),ieri=new Date(stato.oggi+'T12:00:00Z');ieri.setUTCDate(ieri.getUTCDate()-1);
  giorno.innerHTML=[stato.oggi,ieri.toISOString().slice(0,10)].map(d=>`<option value="${d}"${d===stato.data?' selected':''}>${d}</option>`).join('');
  giorno.onchange=()=>carica(giorno.value).catch(errore);
 }
}
function errore(error){
 if(/Sessione (scaduta|revocata)/i.test(error.message)){esci(error.message);return;}
 const host=root.querySelector('#cb-error');if(host)host.textContent=error.message;
}
function contoHTML(tipo,pezzi={}){
 return `<details><summary>${tipo==='fondo'?'Conta il fondo iniziale':'Conta i contanti a fine serata'}</summary><div class="cb-conta">${TAGLI.map(t=>`<label>${euro(t)}<input type="number" min="0" max="100000" step="1" inputmode="numeric" data-cb-conto="${tipo}" data-taglio="${t}" value="${pezzi[t] || ''}" aria-label="Pezzi da ${t} euro (${tipo})"></label>`).join('')}</div></details>`;
}
function leggiConto(tipo){return Object.fromEntries([...root.querySelectorAll(`[data-cb-conto="${tipo}"]`)].filter(el=>el.value!=='').map(el=>[el.dataset.taglio,Number(el.value)]));}
function modulo(c){
 corrente=c;
 if(c?.stato==='chiusa'){
  root.innerHTML=`<section class="panel"><h2>${esc(c.titolo)} · cassa chiusa</h2><p>Aperta da ${esc(c.aperta_da_nome)} · chiusa da ${esc(c.chiusa_da_nome)}</p><div class="cb-esito">${esc(riepilogo(c))}</div><p>Le eventuali correzioni vengono gestite dal responsabile della Sala.</p><div class="actions"><button class="btn" id="cb-indietro">Torna alle casse</button><button class="btn" id="cb-stampa">Stampa riepilogo</button><button class="btn" id="cb-esci">Esci</button></div></section>`;
  root.querySelector('#cb-indietro').onclick=()=>elenco();root.querySelector('#cb-stampa').onclick=()=>window.print();root.querySelector('#cb-esci').onclick=()=>esci();return;
 }
 const v=c || {fondo_iniziale:stato.fondo_proposto,online_n:0,online_euro:0,contanti_n:0,contanti_euro:0,pos_n:0,pos_euro:0,omaggi_n:0,contati:null,prelievo:0,note:'',conteggio:{}};
 const campo=(k,l,tipo='number')=>`<div class="field h"><label for="cb-${k}">${l}</label><input id="cb-${k}" name="${k}" type="${tipo}" value="${esc(v[k] ?? '')}"${tipo==='number'?' min="0" step="'+(k.endsWith('_n')?'1':'0.01')+'"':''}></div>`;
 const selezione=c?.booking_id?'b:'+c.booking_id:c?.proiezione_id?'p:'+c.proiezione_id:'';
 root.innerHTML=`<section class="panel"><h2>${c?'Continua la cassa':'Apri cassa'} · ${esc(stato.data)}</h2><p>Alla cassa: ${esc(stato.nome)}</p><form id="cb-form"><div class="form"><div class="field"><label for="cb-evento">Evento o proiezione</label><select id="cb-evento"><option value="">Altro evento: scrivi il titolo</option>${stato.eventi.map(e=>`<option value="${e.valore}"${e.valore===selezione?' selected':''}>${esc(e.titolo)} · ${esc(e.ora)}</option>`).join('')}</select></div><div class="field" id="cb-titolo-wrap"><label for="cb-titolo">Titolo</label><input id="cb-titolo" maxlength="200" value="${esc(c?.titolo || '')}"></div>${campo('fondo_iniziale','Fondo iniziale (€)')}${campo('online_n','Biglietti online')}${campo('online_euro','Incasso online (€)')}${campo('contanti_n','Biglietti in contanti')}${campo('contanti_euro','Incasso contanti (€)')}${campo('pos_n','Biglietti POS')}${campo('pos_euro','Incasso POS (€)')}${campo('omaggi_n','Omaggi')}${campo('contati','Contanti contati (€)')}${campo('prelievo','Da prelevare dopo il conteggio (€)')}<div class="field"><label for="cb-note">Note</label><textarea id="cb-note" maxlength="2000">${esc(v.note)}</textarea></div></div>${contoHTML('fondo',v.conteggio?._fondo)}${contoHTML('chiusura',Object.fromEntries(Object.entries(v.conteggio || {}).filter(([k])=>k!=='_fondo')))}<div class="cb-riepilogo" id="cb-totali"></div><p id="cb-error" class="cb-error" role="alert"></p><div class="actions"><button class="btn primary" id="cb-salva" type="submit">Salva cassa</button><button class="btn" id="cb-chiudi" type="button">Chiudi la cassa</button><button class="btn ghost" id="cb-annulla" type="button">Torna alle casse</button></div></form></section>`;
 const evento=root.querySelector('#cb-evento');
 const cambiaEvento=()=>root.querySelector('#cb-titolo-wrap').hidden=!!evento.value;cambiaEvento();evento.onchange=cambiaEvento;
 for(const tipo of ['online','contanti','pos']){
  const n=root.querySelector('#cb-'+tipo+'_n'),importo=root.querySelector('#cb-'+tipo+'_euro');
  let manuale=!!c;
  importo.oninput=()=>{manuale=importo.value!=='';};
  n.oninput=()=>{if(!manuale && stato.prezzo_biglietto!=null)importo.value=round(Number(n.value || 0)*Number(stato.prezzo_biglietto));};
 }
 root.querySelectorAll('[data-cb-conto]').forEach(el=>el.oninput=()=>{
  const tipo=el.dataset.cbConto,conto=leggiConto(tipo),dest=root.querySelector(tipo==='fondo'?'#cb-fondo_iniziale':'#cb-contati');
  if(Object.keys(conto).length)dest.value=round(Object.entries(conto).reduce((s,[t,n])=>s+Number(t)*n,0));
  else if(dest.dataset.conteggio==='1')dest.value=tipo==='fondo'?stato.fondo_proposto:'';
  dest.dataset.conteggio=Object.keys(conto).length?'1':'';dest.readOnly=Object.keys(conto).length>0;
 });
 root.querySelector('#cb-form').oninput=totali;
 root.querySelector('#cb-form').onsubmit=e=>{e.preventDefault();salva(false);};
 root.querySelector('#cb-chiudi').onclick=()=>apriChiusura();
 root.querySelector('#cb-annulla').onclick=()=>elenco();
 totali();
}
function leggi(){
 const numero=k=>Number(root.querySelector('#cb-'+k).value || 0);
 const d={data:stato.data,evento:root.querySelector('#cb-evento').value,titolo:root.querySelector('#cb-titolo').value.trim(),note:root.querySelector('#cb-note').value.trim(),contati:root.querySelector('#cb-contati').value===''?null:numero('contati'),conteggio:{...leggiConto('chiusura')}};
 for(const k of ['fondo_iniziale','online_n','online_euro','contanti_n','contanti_euro','pos_n','pos_euro','omaggi_n','prelievo'])d[k]=numero(k);
 const fondo=leggiConto('fondo');if(Object.keys(fondo).length)d.conteggio._fondo=fondo;
 return d;
}
function totali(){
 const d=leggi(),incasso=round(d.online_euro+d.contanti_euro+d.pos_euro),attesi=round(d.fondo_iniziale+d.contanti_euro),saldo=round((d.contati??attesi)-d.prelievo);
 root.querySelector('#cb-totali').innerHTML=`<div>Incasso biglietti<strong>${euro(incasso)}</strong></div><div>Contanti attesi<strong>${euro(attesi)}</strong></div><div>Quadratura<strong>${d.contati==null?'Da contare':Math.abs(d.contati-attesi)<.005?'Quadra':euro(round(d.contati-attesi))}</strong></div><div>Fondo finale<strong>${euro(saldo)}</strong></div>`;
}
const chiusura=document.body.appendChild(Object.assign(document.createElement('dialog'),{id:'cb-dialog-chiusura'}));
chiusura.oncancel=e=>{if(chiusura.querySelector('button[disabled]'))e.preventDefault();};
chiusura.setAttribute('aria-label','Conferma chiusura della cassa');
function apriChiusura(){
 if(!root.querySelector('#cb-form').reportValidity())return;
 if(root.querySelector('#cb-contati').value===''){root.querySelector('#cb-error').textContent='Per chiudere indica i contanti contati.';return;}
 chiusura.innerHTML='<form class="dlg" id="cb-conferma-chiusura"><h2>Chiudi la cassa</h2><p>Leggi il badge della persona che chiude. Il nome verrà registrato nella chiusura.</p><div class="field"><label for="cb-badge-chiusura">Badge di chi chiude</label><input id="cb-badge-chiusura" maxlength="100" autocomplete="off" required></div><p id="cb-errore-chiusura" class="cb-error" role="alert"></p><div class="actions"><button class="btn primary" type="submit">Conferma chiusura</button><button class="btn" id="cb-rinuncia" type="button">Annulla</button></div></form>';
 chiusura.querySelector('#cb-rinuncia').onclick=()=>chiusura.close();
 chiusura.querySelector('form').onsubmit=e=>{e.preventDefault();const badge=chiusura.querySelector('input').value.trim();chiusura.querySelector('input').value='';salva(true,badge);};
 chiusura.onclose=letturaAutomatica(chiusura.querySelector('input'),chiusura.querySelector('form'));
 chiusura.showModal();chiusura.querySelector('input').focus();
}
async function salva(chiudi,badge=null){
 const form=root.querySelector('#cb-form');if(!form.reportValidity())return;
 const dati=leggi();
 const controls=[...form.querySelectorAll('input,select,textarea,button')];controls.forEach(el=>el.disabled=true);
 const bottoni=[...chiusura.querySelectorAll('button')];bottoni.forEach(el=>el.disabled=true);
 try{
  const r=await rpc('cassa_badge_salva',{p_sessione:sessione,p_id:corrente?.id || null,p_dati:dati,p_chiudi:chiudi,p_revisione:corrente?.aggiornato || null,p_badge_chiusura:badge});
  if(chiudi){chiusura.close();await esci(`Cassa chiusa da ${r.cassa.chiusa_da_nome}. Leggi il badge per una nuova operazione.`);}
  else await carica(dati.data);
 }catch(error){if(chiusura.open)chiusura.querySelector('#cb-errore-chiusura').textContent=error.message;else errore(error);}
 finally{controls.forEach(el=>el.disabled=false);bottoni.forEach(el=>el.disabled=false);}
}
function riepilogo(c){return `${c.titolo}\n${c.data}\nAperta da: ${c.aperta_da_nome}\nChiusa da: ${c.chiusa_da_nome || '—'}\nBiglietti: ${Number(c.online_n)+Number(c.contanti_n)+Number(c.pos_n)+Number(c.omaggi_n)}\nIncasso: ${euro(Number(c.online_euro)+Number(c.contanti_euro)+Number(c.pos_euro))}\nContanti attesi: ${euro(Number(c.fondo_iniziale)+Number(c.contanti_euro))}\nContanti contati: ${c.contati==null?'—':euro(c.contati)}\nPrelievo: ${euro(c.prelievo)}\nFondo finale: ${euro(c.fondo_finale)}${c.note?'\nNote: '+c.note:''}`;}
document.addEventListener('keydown',e=>{if(sessione || !root.querySelector('#cb-badge') || e.ctrlKey || e.metaKey || e.altKey)return;const input=root.querySelector('#cb-badge');if(document.activeElement!==input && e.key.length===1){e.preventDefault();input.focus();input.value+=e.key;}});
for(const evento of ['input','pointerdown','keydown'])document.addEventListener(evento,()=>{ultimo=Date.now();});
if(sb)accesso();else root.textContent='Configurazione della Sala non disponibile: contatta il responsabile.';
