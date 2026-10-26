// Árbol de decisión (sin IA): menú numerado → motivo → sede → día → horario → nombre y DNI →
// confirmar. Los horarios salen siempre del calendario y reservar los vuelve a validar.
// Una respuesta que no es opción se pide una vez más; la segunda pasa el chat a la secretaria.
// "0" vuelve al menú en cualquier paso.

import * as agenda from "./agenda.js";
import * as estado from "./estado.js";
import { cfg } from "./config.js";
import { etiqueta, hora, fechaAR, idTurno, msDeId } from "./slots.js";

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

const menu = () =>
  `Hola 👋 Soy el asistente de turnos de ${cfg.consultorio}.\n\nRespondé con el número de la opción:\n` +
  lista(["Sacar turno", "Ver o cancelar mi turno", "Otra consulta (te responde la secretaria)"]) +
  "\n\nSi es una urgencia, llamá al 107.";

const textoSedes = () =>
  "¿En qué sede?\n" + lista(cfg.sedes.map((s) => `${s.nombre} (${Object.keys(s.horarios).map((d) => NOMBRES_DIA[d]).join(" y ")})`)) + VOLVER;

async function diasLibres(sede) {
  const porDia = new Map();
  for (const x of await agenda.turnosLibres()) if (x.sede === sede) porDia.set(fechaAR(x.t), [...(porDia.get(fechaAR(x.t)) || []), x.t]);
  return [...porDia.entries()].slice(0, 9);
}

// Recordatorio que manda el panel (el día anterior). Deja el chat esperando "1" (voy) o "2" (cancelo).
export function recordatorio(clave, t) {
  const c = `${cuando(t.inicio)}${t.sede ? ` en ${t.sede}` : ""}`;
  estado.pausar(clave, 0); // lo pidió la secretaria: el bot atiende la respuesta aunque ella haya escrito antes
  estado.fijarFlujo(clave, { paso: "recordatorio", id: t.id, cuando: c, hasta: t.inicio });
  return `Hola 👋 Te recordamos que el ${c} tenés turno con ${cfg.consultorio}.\n¿Nos confirmás tu asistencia?\n` + lista(["Sí, voy", "No puedo ir (cancelar el turno)"]);
}

// Devuelve { texto, derivar }. texto vacío = no responder.
export async function atender({ tel, clave, texto }) {
  const f = estado.flujo(clave) || { paso: "inicio" };
  const n = opcion(texto);
  const ir = (paso, datos, msj) => { estado.fijarFlujo(clave, { ...f, ...datos, paso, reintento: false }); return { texto: msj }; };
  const derivar = (msj = DERIVAR) => { estado.fijarFlujo(clave, null); return { texto: msj, derivar: true }; };
  const otraVez = (msj) => (f.reintento ? derivar() : (estado.fijarFlujo(clave, { ...f, reintento: true }), { texto: `Respondé solo con el número de la opción 🙂\n\n${msj}` }));
  const terminar = (msj) => ir("listo", { hasta: Date.now() + LISTO_HORAS * 3600e3 }, msj);

  if (n === 0 && f.paso !== "inicio" && f.paso !== "listo") return ir("menu", {}, menu());

  switch (f.paso) {
    case "inicio":
      return ir("menu", {}, menu());

    case "listo":
      if (n === null) return Date.now() < f.hasta ? { texto: "" } : ir("menu", {}, menu());
      if (Date.now() >= f.hasta && !(n >= 1 && n <= 3)) return ir("menu", {}, menu());
    // un número después de terminar = elegir del menú
    // falls through
    case "menu": {
      if (n === 1) {
        const [ya] = await agenda.turnosDe(tel);
        if (ya) return terminar(`Ya tenés un turno el ${cuando(ya.inicio)}${ya.sede ? ` en ${ya.sede}` : ""}. Para cambiarlo, primero cancelalo con la opción 2.`);
        return ir("motivo", {}, "¿Cuál es el motivo de la consulta?\n" + lista(cfg.motivos) + VOLVER);
      }
      if (n === 2) {
        const turnos = await agenda.turnosDe(tel);
        if (!turnos.length) return terminar("No encontré turnos sacados desde este número. Si querés sacar uno, respondé 1.");
        return ir("cancelar", { turnos: turnos.map((t) => ({ id: t.id, cuando: `${cuando(t.inicio)}${t.sede ? ` (${t.sede})` : ""}` })) },
          "Tus turnos:\n" + lista(turnos.map((t) => `${cuando(t.inicio)}${t.sede ? ` (${t.sede})` : ""}`)) +
          "\n\nRespondé con el número del turno que querés cancelar, o 0 para volver.");
      }
      if (n === 3) return derivar("Contame tu consulta y la secretaria te responde por acá 🙂");
      return f.paso === "listo" ? ir("menu", {}, menu()) : otraVez(menu());
    }

    case "motivo":
      if (n >= 1 && n <= cfg.motivos.length) return ir("sede", { motivo: cfg.motivos[n - 1] }, textoSedes());
      return otraVez("¿Cuál es el motivo de la consulta?\n" + lista(cfg.motivos) + VOLVER);

    case "sede": {
      const s = cfg.sedes[n - 1];
      if (!s) return otraVez(textoSedes());
      const dias = await diasLibres(s.nombre);
      if (!dias.length) return ir("sede", {}, `No quedan turnos libres en ${s.nombre} en los próximos días. Elegí otra sede.\n\n${textoSedes()}`);
      return ir("dia", { sede: s.nombre, dias: dias.map(([fecha]) => fecha) },
        `Días con turnos en ${s.nombre}:\n` + lista(dias.map(([, ts]) => dia(ts[0]))) + VOLVER);
    }

    case "dia": {
      const fecha = f.dias?.[n - 1];
      if (!fecha) return otraVez(`Días con turnos en ${f.sede}:\n` + lista(f.dias.map((d) => dia(Date.parse(`${d}T12:00:00-03:00`)))) + VOLVER);
      const ts = (await diasLibres(f.sede)).find(([d]) => d === fecha)?.[1];
      if (!ts) return ir("sede", {}, `Ese día se llenó recién. Elegí la sede de nuevo para ver lo que queda.\n\n${textoSedes()}`);
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
        if (f.reintento) return derivar();
        estado.fijarFlujo(clave, { ...f, reintento: true });
        return { texto: "No llegué a leer bien los datos. Escribí nombre, apellido y DNI en un solo mensaje.\nEjemplo: Ana Pérez 25123456" };
      }
      return ir("confirmar", d,
        `Revisá los datos:\n📅 ${cuando(msDeId(f.turno))}\n📍 ${f.sede}\n🩺 ${f.motivo}\n👤 ${d.nombre} · DNI ${d.dni}\n\n` + lista(["Confirmar", "No, empezar de nuevo"]));
    }

    case "confirmar": {
      if (n === 2) return terminar("Listo, no reservé nada. Si querés empezar de nuevo, respondé 1.");
      if (n !== 1) return otraVez(lista(["Confirmar", "No, empezar de nuevo"]));
      const r = await agenda.reservar(tel, f.turno, f.sede, f.nombre, [`DNI ${f.dni}`, `Motivo: ${f.motivo}`]);
      if (r.ok) return terminar(`✅ Listo, tu turno quedó reservado:\n📅 ${cuando(msDeId(f.turno))}\n📍 ${f.sede}\n\nSi no podés venir, escribinos y elegí la opción 2 para cancelarlo.`);
      if (r.turnos) return terminar(`${r.error}`);
      return ir("sede", {}, `Ese horario se ocupó recién 😕 Elegí la sede de nuevo para ver lo que queda.\n\n${textoSedes()}`);
    }

    case "recordatorio": {
      if (n === 1 || (n === null && /^\s*(s[ií]|confirm|voy)/i.test(texto))) {
        const r = await agenda.confirmar(tel, f.id);
        return r.ok ? terminar(`¡Gracias! Te esperamos el ${f.cuando} 🙂`) : derivar();
      }
      if (n === 2 || (n === null && /^\s*no\b/i.test(texto)))
        return ir("confirmarCancelar", { cancelar: { id: f.id, cuando: f.cuando } }, `¿Cancelo el turno del ${f.cuando}?\n` + lista(["Sí, cancelarlo", "No"]));
      return otraVez(`¿Venís al turno del ${f.cuando}?\n` + lista(["Sí, voy", "No puedo ir (cancelar el turno)"]));
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
