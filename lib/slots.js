// Cálculo de turnos libres. Puro (sin red) para poder testearlo.
// Las Functions corren en UTC: todo se arma con offset explícito -03:00
// (Argentina no tiene horario de verano). Nunca setHours ni métodos locales de Date.

const OFF = "-03:00";
const OFF_MS = 3 * 3600e3;
const DIAS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

// "YYYY-MM-DD" de hoy en Argentina.
export const fechaAR = (ms) => new Date(ms - OFF_MS).toISOString().slice(0, 10);
// Id estable del turno: hora argentina "YYYY-MM-DDTHH:MM". Es lo que ve el modelo.
export const idTurno = (ms) => new Date(ms - OFF_MS).toISOString().slice(0, 16);
export const msDeId = (id) => (/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(id) ? Date.parse(`${id}:00${OFF}`) : NaN);

const fmt = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
export const etiqueta = (ms) => fmt.format(ms);

// horarios: { lun: ["09:00-13:00", "16:00-19:00"], ... }. Devuelve inicios en ms.
export function inicios(fecha, horarios, min) {
  const dia = DIAS[new Date(`${fecha}T12:00:00${OFF}`).getUTCDay()];
  return (horarios[dia] || []).flatMap((rango) => {
    const [a, b] = rango.split("-");
    const fin = Date.parse(`${fecha}T${b}:00${OFF}`);
    const out = [];
    for (let t = Date.parse(`${fecha}T${a}:00${OFF}`); t + min * 60e3 <= fin; t += min * 60e3) out.push(t);
    return out;
  });
}

// sedes: [{ nombre, horarios }]. Una sola doctora: un solo calendario de ocupados para todas.
// ocupados: [[inicioMs, finMs], ...] (eventos del calendario: turnos + bloqueos del doc).
// Devuelve [{ t, sede }] en orden.
export function libres({ ahora, dias, sedes, min, ocupados }) {
  const hoy = Date.parse(`${fechaAR(ahora)}T12:00:00${OFF}`);
  const out = [];
  for (let d = 0; d < dias; d++) {
    for (const s of sedes) {
      for (const t of inicios(fechaAR(hoy + d * 86400e3), s.horarios, min)) {
        const f = t + min * 60e3;
        if (t > ahora && !ocupados.some(([a, b]) => t < b && a < f)) out.push({ t, sede: s.nombre });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// La doctora no puede estar en dos sedes a la vez: dos rangos del mismo día no se pisan.
export function validarSedes(sedes) {
  if (!Array.isArray(sedes) || !sedes.length) throw new Error("SEDES vacío");
  for (const dia of DIAS) {
    const rangos = sedes.flatMap((s) => (s.horarios?.[dia] || []).map((r) => [...r.split("-"), s.nombre])).sort();
    for (let i = 1; i < rangos.length; i++) {
      if (rangos[i][0] < rangos[i - 1][1]) throw new Error(`SEDES: ${rangos[i - 1][2]} y ${rangos[i][2]} se pisan el ${dia}`);
    }
  }
  return sedes;
}

// Evento de Calendar -> [inicioMs, finMs]. Los de día completo traen start.date/end.date
// (y por defecto son "Disponible", por eso no se usa freebusy: todo evento bloquea).
export const intervalo = (ev) => [ev.start, ev.end].map((x) => Date.parse(x.dateTime ?? `${x.date}T00:00:00${OFF}`));

const fmtHora = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const hora = (ms) => fmtHora.format(ms);

export const rangoBusqueda = (ahora, dias) => [ahora, Date.parse(`${fechaAR(ahora + dias * 86400e3)}T00:00:00${OFF}`)];
