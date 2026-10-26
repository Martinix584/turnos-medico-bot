// La IA conversa; el código manda en la agenda. El modelo nunca escribe fechas: elige
// ids que devolvió turnos_libres, y reservar los vuelve a validar contra el calendario.
// La identidad del paciente es el teléfono del chat (tel), nunca un argumento del modelo.
//
// Modo opcional (MODO=ia). Por defecto el bot usa el árbol (arbol.js), sin IA.
// Proveedor: cualquier API compatible con OpenAI (chat/completions + tools), por ejemplo
// Google AI Studio o OpenCode. LLM_BASE_URL, LLM_API_KEY, LLM_MODEL en .env.

import * as agenda from "./agenda.js";
import * as estado from "./estado.js";
import { cfg } from "./config.js";
import { etiqueta, idTurno, fechaAR, msDeId } from "./slots.js";

export const DERIVAR = "Ya le paso tu mensaje a alguien del consultorio, te responden por acá 🙂";
const MAX_VUELTAS = 8;

// Sin argumentos: no se manda `parameters` (Gemini rechaza objetos vacíos).
const fn = (name, description, properties, required) => ({
  type: "function",
  function: { name, description, ...(properties && { parameters: { type: "object", properties, ...(required?.length && { required }) } }) },
});

const definiciones = () => {
  const sede = { type: "string", enum: cfg.sedes.map((s) => s.nombre), description: "Sede del consultorio" };
  return [
    fn("turnos_libres", "Lista turnos libres (hasta 12) a partir de una fecha, opcionalmente de una sede. Cada uno trae id y sede para reservar.", {
      desde: { type: "string", description: "Fecha YYYY-MM-DD desde la cual buscar. Omitir para desde hoy." }, sede,
    }),
    fn("mis_turnos", "Turnos futuros ya reservados por este paciente."),
    fn("reservar", "Reserva un turno. Solo con un id y sede devueltos por turnos_libres y después de que el paciente lo eligió.", {
      turno: { type: "string", description: "id del turno, tal cual lo devolvió turnos_libres" }, sede,
      nombre: { type: "string", description: "Nombre y apellido del paciente, como lo escribió" },
    }, ["turno", "sede", "nombre"]),
    fn("cancelar", "Cancela un turno de este paciente. Solo con un turno_id de mis_turnos y si el paciente lo pidió.", {
      turno_id: { type: "string" },
    }, ["turno_id"]),
    fn("derivar", "Pasa la conversación al personal del consultorio y el bot deja de responder en este chat. " +
      "Usala para todo lo que no sea gestionar turnos. silencio=true si el mensaje no necesita respuesta (gracias, ok, saludos de cierre).", {
      silencio: { type: "boolean" },
      mensaje: { type: "string", description: "Qué decirle al paciente antes de pasarlo (ej: que alguien del consultorio le responde por acá; si es urgencia, que llame al 107)" },
    }, ["silencio"]),
  ];
};

// Sin modo estricto: cada herramienta valida sus argumentos y devuelve {error} si no sirven.
const herramientas = (tel, salida) => ({
  turnos_libres: async ({ desde, sede }) => {
    const min = desde ? msDeId(`${desde}T00:00`) || 0 : 0;
    const t = (await agenda.turnosLibres()).filter((x) => x.t >= min && (!sede || x.sede === sede)).slice(0, 12);
    return t.length ? t.map((x) => ({ id: idTurno(x.t), sede: x.sede, cuando: etiqueta(x.t) })) : { sin_turnos: true };
  },
  mis_turnos: async () => (await agenda.turnosDe(tel)).map((e) => ({ turno_id: e.id, sede: e.sede, cuando: etiqueta(e.inicio) })),
  reservar: async ({ turno, sede, nombre }) => {
    nombre = typeof nombre === "string" ? nombre.trim() : "";
    if (Number.isNaN(msDeId(turno))) return { error: "id de turno inválido: usá uno de turnos_libres" };
    if (!cfg.sedes.some((s) => s.nombre === sede)) return { error: "sede inválida" };
    if (nombre.length < 2 || nombre.length > 80) return { error: "falta el nombre y apellido del paciente" };
    return agenda.reservar(tel, turno, sede, nombre);
  },
  cancelar: async ({ turno_id }) => (typeof turno_id === "string" ? agenda.cancelar(tel, turno_id) : { error: "falta turno_id" }),
  derivar: async ({ silencio, mensaje }) => {
    salida.derivar = { silencio: silencio === true, mensaje: typeof mensaje === "string" ? mensaje.trim() : "" };
    return "Derivado. No sigas la conversación.";
  },
});

const dias = { dom: "domingo", lun: "lunes", mar: "martes", mie: "miércoles", jue: "jueves", vie: "viernes", sab: "sábado" };
const sistema = () =>
  `Sos el asistente de WhatsApp de ${cfg.consultorio} y solo gestionás turnos: consultar horarios libres, reservar, ver y cancelar. ` +
  `Hoy es ${etiqueta(Date.now()).split(",")[0]} ${fechaAR(Date.now())}. ` +
  "Sedes: " + cfg.sedes.map((s) => `${s.nombre} (${Object.keys(s.horarios).map((d) => dias[d]).join(" y ")})`).join("; ") + ". " +
  "Si el paciente no dijo en qué sede, preguntale o mostrale turnos de ambas aclarando la sede. " +
  "Para reservar necesitás el nombre y apellido del paciente y que elija un turno de los que devolvió turnos_libres; confirmá día, hora y sede antes de reservar. " +
  "Confirmale el turno al paciente solo si reservar devolvió ok; si devolvió error, decíselo y ofrecé otros horarios. " +
  "Para cambiar un turno: cancelá el anterior y reservá el nuevo. Nunca inventes horarios ni direcciones: usá solo lo que devuelven las herramientas. " +
  "Cualquier otra cosa (síntomas, medicación, recetas, estudios, resultados, direcciones, consultas administrativas) no la respondas: usá derivar. " +
  "Si el mensaje describe una urgencia, usá derivar con un mensaje que diga que llamen al 107. " +
  "Español rioplatense, cordial y breve, sin formato markdown.";

async function completar(messages) {
  const { url, key, modelo } = cfg.llm;
  for (let intento = 0; ; intento++) {
    const r = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelo, messages, tools: definiciones() }),
      signal: AbortSignal.timeout(60_000),
    });
    // Los planes gratis tienen límite por minuto y un mensaje son varias llamadas: un reintento.
    if (r.status === 429 && intento === 0) { await new Promise((ok) => setTimeout(ok, 15_000)); continue; }
    if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return (await r.json()).choices[0].message;
  }
}

// historial: [{role, content: string}] terminando en el mensaje del paciente.
// Devuelve { texto, derivar? }. texto vacío = no responder.
export async function responder(tel, historial) {
  const salida = {};
  const run = herramientas(tel, salida);
  const messages = [{ role: "system", content: sistema() }, ...historial];
  let texto = "";
  for (let i = 0; i < MAX_VUELTAS; i++) {
    const m = await completar(messages);
    messages.push(m);
    texto = (m.content || "").trim();
    if (!m.tool_calls?.length) break;
    for (const call of m.tool_calls) {
      let resultado;
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        resultado = run[call.function.name] ? await run[call.function.name](args) : { error: "herramienta desconocida" };
      } catch (e) {
        resultado = { error: e instanceof SyntaxError ? "argumentos JSON inválidos" : e.message };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: typeof resultado === "string" ? resultado : JSON.stringify(resultado) });
    }
    if (salida.derivar) break;
  }
  if (salida.derivar) return { texto: salida.derivar.silencio ? "" : salida.derivar.mensaje || texto || DERIVAR, derivar: { silencio: salida.derivar.silencio } };
  return { texto: texto || DERIVAR, derivar: texto ? undefined : { silencio: false } };
}

// Misma interfaz que arbol.js. El historial corto vive en estado.
export async function atender({ tel, clave, texto }) {
  const historial = [...estado.historial(clave), { role: "user", content: texto.slice(0, 2000) }];
  const r = await responder(tel, historial);
  if (!r.derivar) estado.anotar(clave, [...historial, { role: "assistant", content: r.texto }]);
  return { texto: r.texto, derivar: !!r.derivar };
}
