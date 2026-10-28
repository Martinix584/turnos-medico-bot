// Motor principal: menú numerado (sin IA). Cada opción de turno ya trae su sede y su cupo
// (reglas.js): el paciente no elige sede. Los horarios salen siempre del calendario y reservar
// los vuelve a validar. "0" vuelve al menú en cualquier paso.
// Cuando el menú no entiende (texto libre, o la segunda respuesta inválida en un paso) entra la
// IA (ia.js) SIN avisarle al paciente: conduce ese chat hasta que termina o deriva a la secretaria.

import * as agenda from "./agenda.js";
import * as estado from "./estado.js";
import * as ia from "./ia.js";
import { cfg } from "./config.js";
import { etiqueta, hora, idTurno, msDeId, fechaAR } from "./slots.js";
import { RUTAS } from "./reglas.js";

export const DERIVAR = "Le paso tu mensaje a la secretaria, te responde por acá 🙂";
const LISTO_HORAS = 6; // después de terminar, un "gracias" no vuelve a disparar el menú
const NOMBRES_DIA = { dom: "domingo", lun: "lunes", mar: "martes", mie: "miércoles", jue: "jueves", vie: "viernes", sab: "sábado" };

const dia = (ms) => etiqueta(ms).split(",")[0].replace("-", "/"); // "martes 3/11"
const cuando = (ms) => `${dia(ms)} a las ${hora(ms)}`;
const lista = (items) => items.map((x, i) => `${i + 1}) ${x}`).join("\n");
const VOLVER = "\n\n0) Volver al menú";

// "1", "1)", "opción 1", " 2 " -> número. Texto largo o con varios números -> null.
export function opcion(texto) {
  const t = texto.trim();
  if (t.length > 15) return null;
  const n = t.match(/\d+/g);
  return n?.length === 1 ? Number(n[0]) : null;
}

// "Ana María Pérez 25.123.456" -> { nombre, dni }. Exige un solo número de 7-8 dígitos y nombre + apellido.
export function nombreYDni(texto) {
  const sinPuntos = texto.replace(/(\d)[.\s](?=\d)/g, "$1");
  const dnis = sinPuntos.match(/\b\d{7,8}\b/g);
  if (dnis?.length !== 1) return null;
  const nombre = sinPuntos.replace(dnis[0], " ")
    .replace(/\b(dni|d\.n\.i|nombre|apellido|mi|es|soy)\b/gi, " ")
    .replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  return nombre.split(" ").length >= 2 && nombre.length <= 80 ? { nombre, dni: dnis[0] } : null;
}

// Opciones del menú que sacan turno -> motivo (la sede la define reglas.js).
const MENU_MOTIVO = { 1: "clinico", 2: "estudios", 4: "empadronamiento" };

const menu = () =>
  `Hola 👋 Soy el asistente de turnos de ${cfg.consultorio}.\n\nRespondé con el número de la opción:\n` +
  lista(["Control clínico", "Control de estudios", "Derivación", "Empadronamiento por diabetes", "Recetas PAMI", "Ver o cancelar mi turno"]) +
  "\n\nSi es otra consulta, escribila con tus palabras 🙂\nSi es una urgencia, llamá al 107.";

const TEXTO_DERIVACION = () =>
  `Las derivaciones no se dan con turno: se piden por correo a ${cfg.mailRecetas}, con la credencial de PAMI. ` +
  "Si tenés estudios previos, podés sumar el informe (ej: solicito derivación a gastroenterología para mostrar la colonoscopía). " +
  "Se pueden hacer 2 derivaciones por mes.";
const TEXTO_RECETAS = () =>
  `Recetas PAMI, sin costo: dejá el formulario en el buzón del consultorio o mandá un correo a ${cfg.mailRecetas}. Demoran 7 días.\n` +
  "Por WhatsApp cuestan $10.000 por un mes: si la querés por esa vía, escribilo acá y te responde la secretaria.";

async function diasLibres(motivo) {
  const porDia = new Map();
  for (const x of await agenda.turnosLibresPara(motivo)) porDia.set(fechaAR(x.t), [...(porDia.get(fechaAR(x.t)) || []), x.t]);
  return [...porDia.entries()].slice(0, 9);
}

// Recordatorio que manda el panel (el día anterior). Deja el chat esperando "1" (voy) o "2" (cancelo).
export function recordatorio(clave, t) {
  const c = `${cuando(t.inicio)}${t.sede ? ` en ${t.sede}` : ""}`;
  estado.pausar(clave, 0); // lo pidió la secretaria: el bot atiende la respuesta aunque ella haya escrito antes
  estado.fijarFlujo(clave, { paso: "recordatorio", id: t.id, cuando: c, hasta: t.inicio });
  return `Hola 👋 Te recordamos que el ${c} tenés turno con ${cfg.consultorio}.\n¿Nos confirmás tu asistencia?\n` + lista(["Sí, voy", "No puedo ir (cancelar el turno)"]);
}

const IA_MIN = 30; // la IA conduce el chat hasta que termina, deriva, o pasan 30 min sin mensajes

// Devuelve { texto, derivar }. texto vacío = no responder.
export async function atender({ tel, clave, texto }) {
  let f = estado.flujo(clave) || { paso: "inicio" };
  const n = opcion(texto);
  const ir = (paso, datos, msj) => { estado.fijarFlujo(clave, { ...f, ...datos, paso, reintento: false }); return { texto: msj }; };
  const derivar = (msj = DERIVAR) => { estado.fijarFlujo(clave, null); return { texto: msj, derivar: true }; };
  // Lo que el menú no entiende lo toma la IA, sin avisarle al paciente. `previo`: lo último que
  // mostró el menú y lo elegido hasta ahí, para que la IA siga la charla en vez de empezar de cero.
  const aIA = async (previo) => {
    estado.fijarFlujo(clave, { paso: "ia", ts: Date.now() });
    const r = await ia.atender({ tel, clave, texto, previo });
    if (r.derivar) estado.fijarFlujo(clave, null);
    return r;
  };
  const contexto = (msj) => [
    RUTAS[f.motivo] && `Motivo elegido: ${RUTAS[f.motivo].nombre} (motivo ${f.motivo}).`,
    f.turno && `Turno elegido: ${cuando(msDeId(f.turno))} (id ${f.turno}).`,
    msj,
  ].filter(Boolean).join("\n");
  const otraVez = (msj) => (f.reintento ? aIA(contexto(msj)) : (estado.fijarFlujo(clave, { ...f, reintento: true }), { texto: `Respondé solo con el número de la opción 🙂\n\n${msj}` }));
  const terminar = (msj) => ir("listo", { hasta: Date.now() + LISTO_HORAS * 3600e3 }, msj);

  if (f.paso === "ia") {
    if (Date.now() - f.ts > IA_MIN * 60e3) f = { paso: "inicio" }; // pasó un rato: empieza de nuevo
    else if (n === 0 || /^\s*men[uú]\s*$/i.test(texto)) return ir("menu", {}, menu());
    else { estado.fijarFlujo(clave, { paso: "ia", ts: Date.now() }); const r = await ia.atender({ tel, clave, texto }); if (r.derivar) estado.fijarFlujo(clave, null); return r; }
  }

  if (n === 0 && f.paso !== "inicio" && f.paso !== "listo") return ir("menu", {}, menu());
  // Chat a mitad de camino con una versión anterior (sin motivo guardado): vuelve al menú.
  if (["dia", "hora", "datos", "confirmar"].includes(f.paso) && !RUTAS[f.motivo]) return ir("menu", {}, menu());

  switch (f.paso) {
    case "inicio":
      return ir("menu", {}, menu());

    case "listo":
      if (n === null) return Date.now() < f.hasta ? { texto: "" } : ir("menu", {}, menu());
      if (Date.now() >= f.hasta && !(n >= 1 && n <= 6)) return ir("menu", {}, menu());
    // un número después de terminar = elegir del menú
    // falls through
    case "menu": {
      if (MENU_MOTIVO[n]) {
        const [ya] = await agenda.turnosDe(tel);
        if (ya) return terminar(`Ya tenés un turno el ${cuando(ya.inicio)}${ya.sede ? ` en ${ya.sede}` : ""}. Para cambiarlo, primero cancelalo con la opción 6.`);
        const motivo = MENU_MOTIVO[n];
        const dias = await diasLibres(motivo);
        if (!dias.length) return derivar("Por ahora no veo turnos libres para eso. Le paso tu consulta a la secretaria 🙂");
        const sede = RUTAS[motivo].sede;
        return ir("dia", { motivo, sede, dias: dias.map(([fecha]) => fecha) },
          `Días con turnos en ${sede}:\n` + lista(dias.map(([, ts]) => dia(ts[0]))) + VOLVER);
      }
      if (n === 3) return ir("menu", {}, TEXTO_DERIVACION());
      if (n === 5) return ir("menu", {}, TEXTO_RECETAS());
      if (n === 6) {
        const turnos = await agenda.turnosDe(tel);
        if (!turnos.length) return terminar("No encontré turnos sacados desde este número. Si querés sacar uno, elegí una opción del menú.");
        return ir("cancelar", { turnos: turnos.map((t) => ({ id: t.id, cuando: `${cuando(t.inicio)}${t.sede ? ` (${t.sede})` : ""}` })) },
          "Tus turnos:\n" + lista(turnos.map((t) => `${cuando(t.inicio)}${t.sede ? ` (${t.sede})` : ""}`)) +
          "\n\nRespondé con el número del turno que querés cancelar, o 0 para volver.");
      }
      if (f.paso === "listo") return ir("menu", {}, menu());
      return n === null ? aIA() : otraVez(menu()); // texto libre: IA; número fuera del menú: se pide de nuevo
    }

    case "dia": {
      const fecha = f.dias?.[n - 1];
      if (!fecha) return otraVez(`Días con turnos en ${f.sede}:\n` + lista(f.dias.map((d) => dia(Date.parse(`${d}T12:00:00-03:00`)))) + VOLVER);
      const ts = (await diasLibres(f.motivo)).find(([d]) => d === fecha)?.[1];
      if (!ts) return ir("menu", {}, `Ese día se llenó recién 😕 Elegí de nuevo para ver lo que queda.\n\n${menu()}`);
      return ir("hora", { turnos: ts.map(idTurno) }, `Horarios del ${dia(ts[0])} en ${f.sede}:\n` + lista(ts.map(hora)) + VOLVER);
    }

    case "hora": {
      const id = f.turnos?.[n - 1];
      if (!id) return otraVez(`Horarios del ${dia(msDeId(f.turnos[0]))}:\n` + lista(f.turnos.map((x) => hora(msDeId(x)))) + VOLVER);
      return ir("datos", { turno: id }, "Escribí tu nombre y apellido y tu número de DNI.\nEjemplo: Ana Pérez 25123456");
    }

    case "datos": {
      const d = nombreYDni(texto);
      if (!d) {
        if (f.reintento) return aIA(contexto("Escribí tu nombre y apellido y tu número de DNI."));
        estado.fijarFlujo(clave, { ...f, reintento: true });
        return { texto: "No llegué a leer bien los datos. Escribí nombre, apellido y DNI en un solo mensaje.\nEjemplo: Ana Pérez 25123456" };
      }
      return ir("confirmar", d,
        `Revisá los datos:\n📅 ${cuando(msDeId(f.turno))}\n📍 ${f.sede}\n🩺 ${RUTAS[f.motivo].nombre}\n👤 ${d.nombre} · DNI ${d.dni}\n\n` + lista(["Confirmar", "No, empezar de nuevo"]));
    }

    case "confirmar": {
      if (n === 2) return terminar("Listo, no reservé nada. Si querés empezar de nuevo, elegí una opción del menú.");
      if (n !== 1) return otraVez(lista(["Confirmar", "No, empezar de nuevo"]));
      const r = await agenda.reservar(tel, f.turno, f.sede, f.nombre, [`DNI ${f.dni}`, `Motivo: ${RUTAS[f.motivo].nombre}`], f.motivo);
      if (r.ok) return terminar(`✅ Listo, tu turno quedó reservado:\n📅 ${cuando(msDeId(f.turno))}\n📍 ${f.sede}\n\nSi no podés venir, escribinos y elegí la opción 6 para cancelarlo.`);
      if (r.turnos) return terminar(`${r.error}`);
      return ir("menu", {}, `Ese horario se ocupó recién 😕 Elegí de nuevo para ver lo que queda.\n\n${menu()}`);
    }

    case "recordatorio": {
      if (n === 1 || (n === null && /^\s*(s[ií]|confirm|voy)/i.test(texto))) {
        const r = await agenda.confirmar(tel, f.id);
        return r.ok ? terminar(`¡Gracias! Te esperamos el ${f.cuando} 🙂`) : derivar();
      }
      if (n === 2 || (n === null && /^\s*no\b/i.test(texto)))
        return ir("confirmarCancelar", { cancelar: { id: f.id, cuando: f.cuando } }, `¿Cancelo el turno del ${f.cuando}?\n` + lista(["Sí, cancelarlo", "No"]));
      if (f.reintento) return derivar(); // el recordatorio lo mandó la secretaria: si no responde bien, que lo vea ella
      estado.fijarFlujo(clave, { ...f, reintento: true });
      return { texto: `Respondé solo con el número de la opción 🙂\n\n¿Venís al turno del ${f.cuando}?\n` + lista(["Sí, voy", "No puedo ir (cancelar el turno)"]) };
    }

    case "cancelar": {
      const t = f.turnos?.[n - 1];
      if (!t) return otraVez("Tus turnos:\n" + lista(f.turnos.map((x) => x.cuando)) + "\n\nRespondé con el número del turno, o 0 para volver.");
      return ir("confirmarCancelar", { cancelar: t }, `¿Cancelo el turno del ${t.cuando}?\n` + lista(["Sí, cancelarlo", "No"]));
    }

    case "confirmarCancelar": {
      if (n === 2) return terminar("Perfecto, el turno sigue en pie.");
      if (n !== 1) return otraVez(lista(["Sí, cancelarlo", "No"]));
      const r = await agenda.cancelar(tel, f.cancelar.id);
      return terminar(r.ok ? `Listo, cancelé el turno del ${f.cancelar.cuando}.` : r.error);
    }

    default:
      return ir("menu", {}, menu());
  }
}
