// © 2026 Fabio Santi, per la Sala San Tommaso Moro. Tutti i diritti riservati (vedi LICENSE).
// Funzione Supabase «leggi-locandina»: riceve la foto di una locandina dall'app e restituisce le informazioni
// dell'evento (titolo, date, orari, ingresso, organizzatore, collaborazioni, descrizione…) lette da Claude.
// La chiave di Anthropic sta nei secret di Supabase (ANTHROPIC_API_KEY), mai nel codice o nell'app.
// La possono usare solo admin, coordinatori e segreteria (si controlla il ruolo di chi chiama).
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const risposta = (corpo: unknown, stato = 200) =>
  new Response(JSON.stringify(corpo), { status: stato, headers: { ...CORS, "Content-Type": "application/json" } });

const TIPI = ["Festa privata", "Riunione / assemblea", "Conferenza / incontro", "Cinema / proiezione", "Spettacolo / concerto", "Corso / laboratorio", "Attività parrocchiale", "Altro"];
const testo = { type: "string" };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titolo", "tipo", "date", "ingresso", "organizzatore", "collaborazioni", "chi", "descrizione", "contatti", "note"],
  properties: {
    titolo: testo,
    tipo: { type: "string", enum: TIPI },
    date: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["data", "inizio", "fine"],
        properties: { data: testo, inizio: testo, fine: testo },
      },
    },
    ingresso: testo,
    organizzatore: testo,
    collaborazioni: testo,
    chi: testo,
    descrizione: testo,
    contatti: testo,
    note: testo,
  },
};

const ISTRUZIONI = `Leggi la locandina di un evento della Sala San Tommaso Moro (Piombino Dese) e riporta le informazioni scritte, in italiano.
Regole:
- Riporta solo quello che c'è sulla locandina: se un'informazione non c'è, lascia la stringa vuota (o l'elenco vuoto per le date). Non inventare.
- titolo: il nome dell'evento, con le maiuscole normali (non tutto maiuscolo).
- tipo: la categoria più vicina tra quelle ammesse.
- date: una voce per ogni data, con data nel formato AAAA-MM-GG, inizio e fine nel formato HH:MM (vuoti se non indicati). Se manca l'anno, scegli il primo anno in cui quella data non è già passata rispetto a oggi.
- ingresso: come si entra (es. «Ingresso libero», «Ingresso a offerta libera», «Intero 10 €, ridotto 7 €», «Su prenotazione»).
- organizzatore: chi organizza l'evento (associazione, gruppo, scuola, ente).
- collaborazioni: patrocini, collaborazioni e sponsor, separati da virgola.
- chi: chi si esibisce, presenta, dirige o interviene (regia, relatori, ospiti, compagnia).
- descrizione: due o tre frasi che spiegano l'evento, basate sul testo della locandina.
- contatti: telefoni, email, siti o profili social scritti sulla locandina per informazioni o prenotazioni.
- note: altre informazioni utili (età consigliata, durata, cosa portare, raccolta fondi…).`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return risposta({ error: "Metodo non ammesso" }, 405);
  try {
    // solo chi ha un ruolo che può scrivere nell'agenda
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: ruolo } = await sb.rpc("my_role");
    if (!["admin", "coordinatore", "segreteria"].includes(String(ruolo))) return risposta({ error: "Non autorizzato" }, 403);

    const { immagine, tipo, oggi } = await req.json();
    if (typeof immagine !== "string" || !immagine || immagine.length > 7_000_000 || !/^image\/(jpeg|png|webp)$/.test(String(tipo))) {
      return risposta({ error: "Immagine non valida: usa una foto JPG o PNG" }, 400);
    }
    const giorno = /^\d{4}-\d{2}-\d{2}$/.test(String(oggi)) ? oggi : new Date().toISOString().slice(0, 10);

    const client = new Anthropic(); // legge ANTHROPIC_API_KEY dai secret della funzione
    const r = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: ISTRUZIONI,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: tipo, data: immagine } },
          { type: "text", text: `Oggi è il ${giorno}. Leggi questa locandina.` },
        ],
      }],
    } as never);

    if (r.stop_reason === "refusal") return risposta({ error: "Claude non ha letto questa locandina: compila a mano" }, 422);
    if (r.stop_reason === "max_tokens") return risposta({ error: "Lettura incompleta: riprova" }, 502);
    const blocco = r.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined;
    if (!blocco) return risposta({ error: "Nessuna risposta: riprova" }, 502);
    return risposta(JSON.parse(blocco.text));
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return risposta({ error: "La chiave di Anthropic non è valida: controlla il secret ANTHROPIC_API_KEY in Supabase" }, 500);
    if (e instanceof Anthropic.PermissionDeniedError) return risposta({ error: "La chiave di Anthropic non ha i permessi o il credito: controlla su console.anthropic.com" }, 500);
    if (e instanceof Anthropic.RateLimitError) return risposta({ error: "Troppe richieste: riprova tra un minuto" }, 429);
    if (e instanceof Anthropic.BadRequestError) return risposta({ error: "Immagine non accettata: prova con una foto più nitida in JPG" }, 400);
    if (e instanceof Anthropic.APIError) return risposta({ error: `Il servizio di lettura non risponde (${e.status}): riprova` }, 502);
    return risposta({ error: "Errore: " + String((e as Error)?.message ?? e) }, 500);
  }
});
