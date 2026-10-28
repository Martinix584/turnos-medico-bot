// Google Calendar = la agenda. El doc ve los turnos en su app de Calendar y bloquea
// días creando cualquier evento (todo evento cuenta como ocupado, incluso de día completo).
// Auth: cuenta de servicio (google.js). El calendario se comparte con su email con
// permiso "Hacer cambios en eventos".

import { cfg, activo } from "./config.js";
import { token } from "./google.js";
import { libres, rangoBusqueda, msDeId, intervalo, conCupo, mesDe, fechaAR } from "./slots.js";
import { normalizarTel } from "./tel.js";
import { RUTAS, CUPO_CLINICO, MOTIVOS_CUPO } from "./reglas.js";

async function gcal(metodo, ruta, { query, body } = {}) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}${ruta}${query ? "?" + new URLSearchParams(query) : ""}`;
  const r = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${await token()}`, ...(body && { "Content-Type": "application/json" }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(20_000), // un fetch colgado frenaría la cola de todos
  });
  if (!r.ok) throw new Error(`Calendar ${r.status} en ${metodo} ${ruta}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

// Todo evento del rango cuenta como ocupado, también los de día completo marcados "Disponible".
async function ocupados(desde, hasta) {
  const r = await gcal("GET", "/events", {
    query: { timeMin: new Date(desde).toISOString(), timeMax: new Date(hasta).toISOString(), singleEvents: "true", maxResults: "2500" },
  });
  return (r.items || []).map(intervalo);
}

export async function turnosLibres(ahora = Date.now()) {
  const [desde, hasta] = rangoBusqueda(ahora, cfg.dias);
  return libres({ ahora, dias: cfg.dias, sedes: cfg.sedes, min: cfg.turnoMin, ocupados: await ocupados(desde, hasta) });
}

// Reservas con alguno de esos motivos, por mes ("YYYY-MM"), desde el 1 del mes de `ahora` hasta `hasta`.
async function usadosPorMes(motivos, ahora, hasta) {
  const desde = Date.parse(`${fechaAR(ahora).slice(0, 8)}01T00:00:00-03:00`);
  const usados = {};
  for (const motivo of motivos) { // privateExtendedProperty repetido es AND: una consulta por motivo
    const r = await gcal("GET", "/events", {
      query: { privateExtendedProperty: `motivo=${motivo}`, timeMin: new Date(desde).toISOString(), timeMax: new Date(hasta).toISOString(), singleEvents: "true", maxResults: "2500" },
    });
    for (const e of r.items || []) if (e.start?.dateTime) usados[mesDe(Date.parse(e.start.dateTime))] = (usados[mesDe(Date.parse(e.start.dateTime))] || 0) + 1;
  }
  return usados;
}

// Turnos libres de un motivo: la sede sale de la regla, no del paciente ni del modelo.
// Control clínico (y "no sabe"): tope mensual compartido en la sede clínica; si el mes se llenó, aparecen los del mes siguiente.
export async function turnosLibresPara(motivo, ahora = Date.now()) {
  const ruta = RUTAS[motivo];
  const sede = cfg.sedes.find((s) => s.nombre === ruta?.sede);
  if (!sede) throw new Error(`Motivo o sede inválidos: ${motivo}`);
  const dias = ruta.cupo ? Math.max(cfg.dias, 62) : cfg.dias; // 62 días: alcanza para el mes que viene
  const [desde, hasta] = rangoBusqueda(ahora, dias);
  const lista = libres({ ahora, dias, sedes: [sede], min: cfg.turnoMin, ocupados: await ocupados(desde, hasta) });
  if (!ruta.cupo) return lista;
  return conCupo(lista, { sede, usados: await usadosPorMes(MOTIVOS_CUPO, ahora, hasta), pct: CUPO_CLINICO, min: cfg.turnoMin });
}

// Turnos futuros de un teléfono (marcados con extendedProperties.private.tel).
export async function turnosDe(tel) {
  const r = await gcal("GET", "/events", {
    query: { privateExtendedProperty: `tel=${tel}`, timeMin: new Date().toISOString(), singleEvents: "true", orderBy: "startTime" },
  });
  return (r.items || []).map((e) => ({ id: e.id, inicio: Date.parse(e.start.dateTime), sede: e.location }));
}

// Reserva re-chequeando disponibilidad justo antes de insertar.
// extra: líneas para la descripción del evento (DNI, motivo).
// motivo (opcional, clave de RUTAS): se guarda en el evento y se valida con su cupo.
export async function reservar(tel, idTurno, sede, nombre, extra = [], motivo) {
  const t = msDeId(idTurno);
  const disponibles = motivo ? await turnosLibresPara(motivo) : await turnosLibres();
  if (!disponibles.some((x) => x.t === t && x.sede === sede)) return { error: "Ese turno ya no está libre. Volvé a consultar los turnos libres." };
  const previos = await turnosDe(tel);
  if (previos.length) return { error: "Este teléfono ya tiene un turno. Para cambiarlo hay que cancelar el anterior primero.", turnos: previos };
  if (!activo()) { console.log(`[BOT_ACTIVO!=1] reservar ${idTurno} ${sede} ${nombre} ${tel}`); return { ok: true, prueba: true }; }
  await gcal("POST", "/events", {
    body: {
      summary: `Turno: ${nombre} (${sede})`,
      location: sede,
      description: [...extra, `Pedido por WhatsApp desde +${tel}`].join("\n"),
      start: { dateTime: new Date(t).toISOString() },
      end: { dateTime: new Date(t + cfg.turnoMin * 60e3).toISOString() },
      extendedProperties: { private: { tel, ...(motivo && { motivo }) } },
    },
  });
  return { ok: true };
}

// Teléfono del turno: el que guardó el bot, o el primero que aparezca en el título o la
// descripción (turnos cargados a mano, ej. "Tel 261 555-1234"). Formato del chat: 549 + 10 dígitos.
export function telDe(e) {
  if (e.extendedProperties?.private?.tel) return e.extendedProperties.private.tel;
  for (const m of `${e.summary || ""}\n${e.description || ""}`.match(/\+?\d[\d\s-]{8,}\d/g) || []) {
    const n = m.replace(/\D/g, "").length >= 10 && normalizarTel(m); // 10+ dígitos: un DNI no es teléfono
    if (n) return "549" + n;
  }
  return null;
}

// El evento, solo si es futuro y es de ese teléfono.
async function eventoDe(tel, id) {
  const n = normalizarTel(tel);
  const e = await gcal("GET", `/events/${encodeURIComponent(id)}`).catch(() => null);
  return n && e && e.status !== "cancelled" && Date.parse(e.start?.dateTime) > Date.now() && normalizarTel(telDe(e) || "") === n ? e : null;
}

// Turnos de un día ("YYYY-MM-DD"), para el panel de recordatorios. Los de día completo son bloqueos.
export async function turnosDelDia(fecha) {
  const desde = Date.parse(`${fecha}T00:00:00-03:00`);
  const r = await gcal("GET", "/events", {
    query: { timeMin: new Date(desde).toISOString(), timeMax: new Date(desde + 86400e3).toISOString(), singleEvents: "true", orderBy: "startTime" },
  });
  return (r.items || []).filter((e) => e.start?.dateTime).map((e) => ({
    id: e.id,
    inicio: Date.parse(e.start.dateTime),
    sede: e.location || "",
    nombre: (e.summary || "").replace(/^✅\s*/, "").replace(/^Turno:\s*/, "").replace(/\s*\([^)]*\)$/, ""),
    tel: telDe(e),
    recordado: !!e.extendedProperties?.private?.recordado,
    confirmado: !!e.extendedProperties?.private?.confirmado,
    evento: e,
  }));
}

// Marca el evento (recordado / confirmado). Confirmado además suma ✅ al título: el doc lo ve en Calendar.
export async function marcar(e, props) {
  if (!activo()) return console.log(`[BOT_ACTIVO!=1] marcar ${e.id}`, props);
  const body = { extendedProperties: { private: { ...e.extendedProperties?.private, ...props } } };
  if (props.confirmado && !e.summary?.startsWith("✅")) body.summary = `✅ ${e.summary || "Turno"}`;
  await gcal("PATCH", `/events/${encodeURIComponent(e.id)}`, { body });
}

export async function confirmar(tel, eventoId) {
  const e = await eventoDe(tel, eventoId);
  if (!e) return { error: "No encontré ese turno a nombre de este teléfono." };
  await marcar(e, { confirmado: "1" });
  return { ok: true };
}

// Solo cancela eventos de ese mismo teléfono.
export async function cancelar(tel, eventoId) {
  if (!(await eventoDe(tel, eventoId))) return { error: "No encontré ese turno a nombre de este teléfono." };
  if (!activo()) { console.log(`[BOT_ACTIVO!=1] cancelar ${eventoId} ${tel}`); return { ok: true, prueba: true }; }
  await gcal("DELETE", `/events/${encodeURIComponent(eventoId)}`);
  return { ok: true };
}
