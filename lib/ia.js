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
import { RUTAS, MOTIVOS_IA } from "./reglas.js";

export const DERIVAR = "Ya le paso tu mensaje a alguien del consultorio, te responden por acá 🙂";
const MAX_VUELTAS = 8;

// Sin argumentos: no se manda `parameters` (Gemini rechaza objetos vacíos).
const fn = (name, description, properties, required) => ({
  type: "function",
  function: { name, description, ...(properties && { parameters: { type: "object", properties, ...(required?.length && { required }) } }) },
});

const definiciones = () => {
  const motivo = { type: "string", enum: MOTIVOS_IA, description: "clinico = control clínico; estudios = control de estudios; empadronamiento = empadronar por diabetes; no_sabe = el paciente no sabe qué necesita" };
  return [
    fn("turnos_libres", "Lista turnos libres (hasta 12) para un motivo. La sede la define el sistema según el motivo y viene en cada turno. Cada uno trae id para reservar.", {
      motivo, desde: { type: "string", description: "Fecha YYYY-MM-DD desde la cual buscar. Omitir para desde hoy." },
    }, ["motivo"]),
    fn("mis_turnos", "Turnos futuros ya reservados por este paciente."),
    fn("reservar", "Reserva un turno. Solo con un id devuelto por turnos_libres para ese mismo motivo y después de que el paciente lo eligió.", {
      turno: { type: "string", description: "id del turno, tal cual lo devolvió turnos_libres" }, motivo,
      nombre: { type: "string", description: "Nombre/s y apellido/s del paciente, como lo escribió" },
      dni: { type: "string", description: "DNI del paciente, solo números" },
    }, ["turno", "motivo", "nombre", "dni"]),
    fn("cancelar", "Cancela un turno de este paciente. Solo con un turno_id de mis_turnos y si el paciente lo pidió.", {
      turno_id: { type: "string" },
    }, ["turno_id"]),
    fn("derivar", "Pasa la conversación al personal del consultorio y el bot deja de responder en este chat. " +
      "Usala para todo lo que no sea gestionar turnos ni informar las reglas que tenés. silencio=true si el mensaje no necesita respuesta (gracias, ok, saludos de cierre).", {
      silencio: { type: "boolean" },
      mensaje: { type: "string", description: "Qué decirle al paciente antes de pasarlo (ej: que alguien del consultorio le responde por acá; si es urgencia, que llame al 107)" },
    }, ["silencio"]),
  ];
};

// Sin modo estricto: cada herramienta valida sus argumentos y devuelve {error} si no sirven.
const herramientas = (tel, salida) => ({
  turnos_libres: async ({ motivo, desde }) => {
    if (!RUTAS[motivo]) return { error: `motivo inválido: ${MOTIVOS_IA.join(", ")}` };
    const min = desde ? msDeId(`${desde}T00:00`) || 0 : 0;
    const t = (await agenda.turnosLibresPara(motivo)).filter((x) => x.t >= min).slice(0, 12);
    return t.length ? t.map((x) => ({ id: idTurno(x.t), sede: x.sede, cuando: etiqueta(x.t) })) : { sin_turnos: true };
  },
  mis_turnos: async () => (await agenda.turnosDe(tel)).map((e) => ({ turno_id: e.id, sede: e.sede, cuando: etiqueta(e.inicio) })),
  reservar: async ({ turno, motivo, nombre, dni }) => {
    nombre = typeof nombre === "string" ? nombre.trim() : "";
    dni = typeof dni === "string" || typeof dni === "number" ? String(dni).replace(/[\s.]/g, "") : "";
    if (Number.isNaN(msDeId(turno))) return { error: "id de turno inválido: usá uno de turnos_libres" };
    if (!RUTAS[motivo]) return { error: `motivo inválido: ${MOTIVOS_IA.join(", ")}` };
    if (nombre.length < 2 || nombre.length > 80) return { error: "falta el nombre y apellido del paciente" };
    if (!/^\d{7,8}$/.test(dni)) return { error: "falta el DNI del paciente (7 u 8 números)" };
    return agenda.reservar(tel, turno, RUTAS[motivo].sede, nombre, [`DNI ${dni}`, `Motivo: ${RUTAS[motivo].nombre}`], motivo);
  },
  cancelar: async ({ turno_id }) => (typeof turno_id === "string" ? agenda.cancelar(tel, turno_id) : { error: "falta turno_id" }),
  derivar: async ({ silencio, mensaje }) => {
    salida.derivar = { silencio: silencio === true, mensaje: typeof mensaje === "string" ? mensaje.trim() : "" };
    return "Derivado. No sigas la conversación.";
  },
});

const dias = { dom: "domingo", lun: "lunes", mar: "martes", mie: "miércoles", jue: "jueves", vie: "viernes", sab: "sábado" };
const sistema = () =>
  `Sos el asistente de WhatsApp de ${cfg.consultorio}. Gestionás turnos (consultar, reservar, ver y cancelar) e informás las reglas de derivaciones y recetas PAMI. ` +
  `Hoy es ${etiqueta(Date.now()).split(",")[0]} ${fechaAR(Date.now())}. ` +
  "Sedes y días: " + cfg.sedes.map((s) => `${s.nombre} (${Object.keys(s.horarios).map((d) => dias[d]).join(" y ")})`).join("; ") + ". " +
  // Menú: el paciente elige una sola opción. La sede la define el sistema, nunca el paciente.
  "Si el paciente quiere algo y no dijo qué, ofrecele estas opciones y que elija UNA: 1) Control clínico, 2) Control de estudios, 3) Derivación, 4) Empadronamiento por diabetes, 5) Recetas PAMI. " +
  "Turnos: 1 -> motivo clinico; 2 -> estudios; 4 -> empadronamiento; si no sabe qué necesita o si necesita análisis -> no_sabe. " +
  "Nunca le pidas ni le dejes elegir la sede: la define el sistema según el motivo; decile dónde es el turno al confirmar. " +
  "Para reservar necesitás nombre/s y apellido/s y número de DNI del paciente, y que elija un turno de los que devolvió turnos_libres para ese motivo; confirmá día, hora y lugar antes de reservar. " +
  "Confirmale el turno solo si reservar devolvió ok; si devolvió error, decíselo y ofrecé otros horarios. " +
  "Para cambiar un turno: cancelá el anterior y reservá el nuevo. Nunca inventes horarios ni direcciones: usá solo lo que devuelven las herramientas. " +
  // Información fija (no se agenda): el paciente la recibe tal cual.
  `DERIVACIONES (opción 3): no se da turno. Se pide por correo a ${cfg.mailRecetas} con la credencial de PAMI; ` +
  "puede sumar el informe de estudios previos (ej: solicito derivación a gastroenterología para mostrar la colonoscopía). Solo se pueden hacer 2 derivaciones por mes. " +
  `RECETAS PAMI (opción 5): gratis, dejando el formulario en el buzón del consultorio o enviando un correo a ${cfg.mailRecetas}; demoran 7 días. ` +
  "Por WhatsApp cuestan $10.000 por un mes: si el paciente la quiere por esa vía, usá derivar. " +
  "Sobreturno (internados con epicrisis) y cualquier otra cosa (síntomas, medicación, resultados, consultas administrativas) no la respondas: usá derivar. " +
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

// La llama arbol.js. El historial corto vive en estado. previo: lo último que mostró el menú.
// derivar en silencio (gracias, ok) no pasa el chat a la secretaria: solo no se responde.
export async function atender({ tel, clave, texto, previo }) {
  const historial = [...estado.historial(clave), ...(previo ? [{ role: "assistant", content: previo }] : []), { role: "user", content: texto.slice(0, 2000) }];
  const r = await responder(tel, historial);
  if (!r.derivar) estado.anotar(clave, [...historial, { role: "assistant", content: r.texto }]);
  return { texto: r.texto, derivar: !!r.derivar && !r.derivar.silencio };
}
