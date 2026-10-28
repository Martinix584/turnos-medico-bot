// node test.js — sin red.
import assert from "node:assert";
import { libres as libresSedes, idTurno, msDeId, rangoBusqueda, intervalo, hora, validarSedes, turnosDelMes, conCupo } from "./lib/slots.js";
import { clasificar, VIEJO_SEG } from "./lib/clasificar.js";
import { normalizarTel } from "./lib/tel.js";
import { jwt } from "./lib/google.js";
import { generateKeyPairSync, createVerify } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
process.env.CHATS_JSON = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "turnos-")), "chats.json"); // no tocar el chats.json real

// Una sede con esos horarios; devuelve solo los inicios.
const libres = ({ horarios, ...o }) => libresSedes({ ...o, sedes: [{ nombre: "S", horarios }] }).map((x) => x.t);

// Slots: martes 27/10/2026, 9 a 10 en turnos de 20 min, con 9:20-9:40 ocupado.
// "Ahora" = lunes 26/10 23:00 hora argentina (02:00Z del lunes): prueba el cambio de día en UTC.
const ahora = Date.parse("2026-10-26T23:00:00-03:00");
const l = libres({ ahora, dias: 2, horarios: { mar: ["09:00-10:00"] }, min: 20, ocupados: [[Date.parse("2026-10-27T12:20:00Z"), Date.parse("2026-10-27T12:40:00Z")]] });
assert.deepStrictEqual(l.map(idTurno), ["2026-10-27T09:00", "2026-10-27T09:40"]);
assert.strictEqual(new Date(l[0]).toISOString(), "2026-10-27T12:00:00.000Z");
// Un turno que empieza antes de "ahora" no se ofrece
assert.deepStrictEqual(libres({ ahora: Date.parse("2026-10-27T09:10:00-03:00"), dias: 1, horarios: { mar: ["09:00-10:00"] }, min: 20, ocupados: [] }).map(idTurno), ["2026-10-27T09:20", "2026-10-27T09:40"]);
// Rango que no entra entero no genera turno; día sin horario no genera nada
assert.deepStrictEqual(libres({ ahora, dias: 3, horarios: { mie: ["09:00-09:50"] }, min: 20, ocupados: [] }).map(idTurno), ["2026-10-28T09:00", "2026-10-28T09:20"]);
assert.ok(Number.isNaN(msDeId("mañana a las 9")));
assert.strictEqual(msDeId("2026-10-27T09:40"), l[1]);
assert.strictEqual(new Date(rangoBusqueda(ahora, 2)[1]).toISOString(), "2026-10-28T03:00:00.000Z");

// Eventos de Calendar: con hora y de día completo (vacaciones) bloquean igual
assert.deepStrictEqual(intervalo({ start: { dateTime: "2026-10-27T09:20:00-03:00" }, end: { dateTime: "2026-10-27T09:40:00-03:00" } }),
  [Date.parse("2026-10-27T12:20:00Z"), Date.parse("2026-10-27T12:40:00Z")]);
const vacaciones = intervalo({ start: { date: "2026-10-27" }, end: { date: "2026-10-28" } });
assert.deepStrictEqual(libres({ ahora, dias: 2, horarios: { mar: ["09:00-10:00"] }, min: 20, ocupados: [vacaciones] }), []);
assert.strictEqual(hora(l[0]), "09:00");

assert.strictEqual(normalizarTel("5492611234567"), "2611234567");

// Las dos sedes reales, 45 min: martes Sede Centro 8 a 16 = 10 turnos (8:00 a 14:45), miércoles Sede Norte 9 a 14 = 6 (9:00 a 12:45)
const OLD_SEDES = validarSedes([
  { nombre: "Sede Centro", horarios: { mar: ["08:00-16:00"], jue: ["08:00-16:00"] } },
  { nombre: "Sede Norte", horarios: { mie: ["09:00-14:00"], vie: ["09:00-14:00"] } },
]);
const lunes = Date.parse("2026-10-26T07:00:00-03:00");
const semana = libresSedes({ ahora: lunes, dias: 7, sedes: OLD_SEDES, min: 45, ocupados: [] });
const delDia = (f) => semana.filter((x) => idTurno(x.t).startsWith(f));
assert.strictEqual(delDia("2026-10-26").length, 0); // lunes: nada
assert.deepStrictEqual([delDia("2026-10-27").length, hora(delDia("2026-10-27")[0].t), hora(delDia("2026-10-27").at(-1).t)], [10, "08:00", "14:45"]);
assert.ok(delDia("2026-10-27").every((x) => x.sede === "Sede Centro"));
assert.deepStrictEqual([delDia("2026-10-28").length, hora(delDia("2026-10-28")[0].t), hora(delDia("2026-10-28").at(-1).t)], [6, "09:00", "12:45"]);
assert.ok(delDia("2026-10-28").every((x) => x.sede === "Sede Norte"));
assert.strictEqual(semana.length, 32); // mar+jue 10 c/u, mié+vie 6 c/u
assert.throws(() => validarSedes([{ nombre: "A", horarios: { mar: ["08:00-12:00"] } }, { nombre: "B", horarios: { mar: ["11:00-14:00"] } }]), /se pisan el mar/);
assert.doesNotThrow(() => validarSedes([{ nombre: "A", horarios: { mar: ["08:00-12:00"] } }, { nombre: "B", horarios: { mar: ["12:00-14:00"] } }]));
assert.throws(() => validarSedes([{ nombre: "A", horarios: { mar: ["08:30"] } }, { nombre: "B", horarios: { mar: ["08:30"] } }]), /se pisan el mar/); // misma hora suelta

// Sedes reales: horas sueltas (turnos de 30 min, no todos seguidos)
const CENTRO_H = ["08:30", "09:30", "10:00", "10:30", "11:00", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30"];
const SEDES = validarSedes([
  { nombre: "Sede Centro", horarios: { mar: CENTRO_H, jue: CENTRO_H } },
  { nombre: "Sede Norte", horarios: { mie: ["08:30", "09:30", "10:00", "10:30", "11:30", "12:00"] } },
]);
{
  const sem = libresSedes({ ahora: lunes, dias: 7, sedes: SEDES, min: 30, ocupados: [] });
  const dia = (f) => sem.filter((x) => idTurno(x.t).startsWith(f)).map((x) => hora(x.t));
  assert.deepStrictEqual(dia("2026-10-27"), CENTRO_H); // martes: Centro
  assert.deepStrictEqual(dia("2026-10-28"), ["08:30", "09:30", "10:00", "10:30", "11:30", "12:00"]); // miércoles: Sede Norte
  assert.strictEqual(dia("2026-10-29").length, 11); // jueves: Centro
  assert.strictEqual(dia("2026-10-30").length, 0); // viernes Sede Norte es particular: no se agenda
  // 10:00 y 10:30 a 30 min no se pisan: ocupar 10:00 no tapa 10:30
  const ocupado10 = [[Date.parse("2026-10-27T10:00:00-03:00"), Date.parse("2026-10-27T10:30:00-03:00")]];
  const sin10 = libresSedes({ ahora: lunes, dias: 2, sedes: SEDES, min: 30, ocupados: ocupado10 }).map((x) => hora(x.t));
  assert.ok(!sin10.includes("10:00") && sin10.includes("10:30"));
}
// Cupo mensual de control clínico, por mes calendario: octubre 2026 = 4 martes (6,13,20,27) + 5 jueves (1,8,15,22,29)
assert.strictEqual(turnosDelMes(SEDES[0], "2026-10", 30), 9 * 11); // 4 martes + 5 jueves (1,8,15,22,29)
assert.strictEqual(turnosDelMes(SEDES[0], "2026-11", 30), 8 * 11); // 4 martes + 4 jueves
{
  const l = [
    { t: Date.parse("2026-10-29T09:30:00-03:00"), sede: "Sede Centro" },
    { t: Date.parse("2026-11-03T09:30:00-03:00"), sede: "Sede Centro" },
    { t: Date.parse("2026-10-28T09:30:00-03:00"), sede: "Sede Norte" },
  ];
  const f = (usados) => conCupo(l, { sede: SEDES[0], usados, pct: 0.6, min: 30 }).map((x) => idTurno(x.t));
  assert.strictEqual(Math.floor(99 * 0.6), 59);
  assert.strictEqual(f({ "2026-10": 58 }).length, 3); // queda 1 de octubre
  assert.deepStrictEqual(f({ "2026-10": 59 }), ["2026-11-03T09:30", "2026-10-28T09:30"]); // octubre lleno: pasa a noviembre; Sede Norte no cuenta
  assert.deepStrictEqual(f({ "2026-10": 59, "2026-11": 52 }), ["2026-10-28T09:30"]); // 60% de 88 = 52
}
// JWT de Google: clave con "\n" literales (como queda a veces en un secret), firma verificable
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pemEscapado = privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n");
const token = await jwt({ client_email: "bot@x.iam.gserviceaccount.com", private_key: pemEscapado }, "scope", 1000);
const [h, c, f] = token.split(".");
assert.deepStrictEqual(JSON.parse(Buffer.from(c, "base64url")), { iss: "bot@x.iam.gserviceaccount.com", scope: "scope", aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 4600 });
assert.ok(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(f, "base64url")));

// Clasificador: qué toca el bot
const ahoraSeg = 2_000_000_000;
const msg = (over = {}, message = { conversation: "hola, quiero un turno" }) => ({ key: { remoteJid: "5492611234567@s.whatsapp.net", fromMe: false, id: "A1", ...over }, messageTimestamp: ahoraSeg - 5, message });
assert.deepStrictEqual(clasificar(msg(), ahoraSeg), { tipo: "paciente", jid: "5492611234567@s.whatsapp.net", texto: "hola, quiero un turno" });
assert.deepStrictEqual(clasificar(msg({ remoteJid: "123@lid" }, { extendedTextMessage: { text: " turno " } }), ahoraSeg), { tipo: "paciente", jid: "123@lid", texto: "turno" });
assert.deepStrictEqual(clasificar(msg({ fromMe: true }), ahoraSeg), { tipo: "propio", jid: "5492611234567@s.whatsapp.net" });
assert.deepStrictEqual(clasificar(msg({ fromMe: true }, { audioMessage: {} }), ahoraSeg), { tipo: "propio", jid: "5492611234567@s.whatsapp.net" }); // audio de la secretaria también pausa
for (const [desc, m] of [
  ["grupo", msg({ remoteJid: "1203@g.us" })],
  ["estados", msg({ remoteJid: "status@broadcast" })],
  ["canal", msg({ remoteJid: "1@newsletter" })],
  ["audio del paciente", msg({}, { audioMessage: {} })],
  ["reacción", msg({}, { reactionMessage: { text: "👍" } })],
  ["borrado/edición", msg({}, { protocolMessage: { type: 0 } })],
  ["vacío", msg({}, { conversation: "   " })],
  ["sin contenido", msg({}, null)],
]) assert.strictEqual(clasificar(m, ahoraSeg), null, desc);
assert.strictEqual(clasificar({ ...msg(), messageTimestamp: ahoraSeg - VIEJO_SEG - 1 }, ahoraSeg), null, "viejo");
// mensaje efímero: normalizeMessageContent lo desenvuelve
assert.strictEqual(clasificar(msg({}, { ephemeralMessage: { message: { conversation: "turno" } } }), ahoraSeg).texto, "turno");

// Conversación completa con la IA y Google simulados (formato OpenAI chat/completions)
{
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  Object.assign(process.env, {
    CONSULTORIO: "el consultorio de prueba", TURNO_MIN: "30", CALENDAR_ID: "cal@group.calendar.google.com", BOT_ACTIVO: "1",
    SEDES: JSON.stringify(SEDES), SEDE_CLINICA: "Sede Centro", SEDE_ESTUDIOS: "Sede Norte", MAIL_RECETAS: "recetas@ejemplo.com, doctora@ejemplo.com", LLM_BASE_URL: "https://llm.test/v1/", LLM_API_KEY: "k", LLM_MODEL: "m",
    GOOGLE_SA_JSON: JSON.stringify({ client_email: "bot@x.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }),
  });
  const { responder } = await import("./lib/ia.js");
  const pedidos = [], eventos = [];
  const llm = [
    { tool_calls: [{ id: "c1", type: "function", function: { name: "turnos_libres", arguments: '{"motivo":"estudios"}' } }] },
    { tool_calls: [{ id: "c2", type: "function", function: { name: "reservar", arguments: '{"turno": roto' } }] },
    { tool_calls: [{ id: "c3", type: "function", function: { name: "reservar", arguments: "" } }] }, // se completa abajo con el primer turno libre
    { content: "Listo Ana, te espero en Sede Norte." },
  ];
  globalThis.fetch = async (url, init = {}) => {
    const json = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
    url = String(url);
    if (url.startsWith("https://oauth2.googleapis.com/")) return json({ access_token: "g" });
    if (url.includes("/calendar/v3/")) {
      if (init.method === "POST") { eventos.push(JSON.parse(init.body)); return json({ id: "ev1" }); }
      return json({ items: [] });
    }
    assert.strictEqual(url, "https://llm.test/v1/chat/completions");
    const b = JSON.parse(init.body);
    pedidos.push(b);
    const sig = llm.shift();
    if (sig.tool_calls?.[0].id === "c3") {
      const libres = JSON.parse(b.messages.find((m) => m.tool_call_id === "c1").content);
      sig.tool_calls[0].function.arguments = JSON.stringify({ turno: libres[0].id, motivo: "estudios", nombre: "Ana Pérez", dni: "30.123.456" });
    }
    return json({ choices: [{ message: { role: "assistant", content: null, ...sig } }] });
  };
  const r = await responder("5492611234567", [{ role: "user", content: "turno en sede norte, soy Ana Pérez" }]);
  assert.deepStrictEqual(r, { texto: "Listo Ana, te espero en Sede Norte.", derivar: undefined });
  assert.strictEqual(pedidos.length, 4);
  assert.deepStrictEqual(pedidos[0].tools.map((t) => t.function.name), ["turnos_libres", "mis_turnos", "reservar", "cancelar", "derivar"]);
  const libres = JSON.parse(pedidos[1].messages.at(-1).content);
  assert.ok(libres.length && libres.every((x) => x.sede === "Sede Norte")); // el paciente no elige: estudios => Sede Norte
  assert.match(pedidos[2].messages.at(-1).content, /JSON inválidos/); // el JSON roto vuelve como error, no rompe
  assert.strictEqual(eventos.length, 1);
  assert.strictEqual(eventos[0].location, "Sede Norte");
  assert.match(eventos[0].summary, /^Turno: Ana Pérez \(Sede Norte\)$/);
  assert.match(eventos[0].description, /DNI 30123456\nMotivo: Control de estudios/);
  assert.deepStrictEqual(eventos[0].extendedProperties.private, { tel: "5492611234567", motivo: "estudios" });

  // derivar con mensaje (urgencia) y en silencio (gracias)
  llm.push({ tool_calls: [{ id: "d1", type: "function", function: { name: "derivar", arguments: '{"silencio":false,"mensaje":"Si es urgente llamá al 107."}' } }] });
  assert.deepStrictEqual(await responder("549261", [{ role: "user", content: "me duele el pecho" }]), { texto: "Si es urgente llamá al 107.", derivar: { silencio: false } });
  llm.push({ tool_calls: [{ id: "d2", type: "function", function: { name: "derivar", arguments: '{"silencio":true}' } }] });
  assert.deepStrictEqual(await responder("549261", [{ role: "user", content: "gracias!" }]), { texto: "", derivar: { silencio: true } });
}

// Menú (motor principal): recorrido completo con un calendario simulado en memoria y la IA simulada
{
  const { atender, opcion, nombreYDni } = await import("./lib/arbol.js");
  Object.assign(process.env, { SEDES: JSON.stringify(SEDES), TURNO_MIN: "30" });
  process.env.CONSULTORIO = "la Dra. Prueba";

  assert.deepStrictEqual(["1", " 2 ", "opción 3", "3)", "hola", "1 o 2", "quiero el turno 1 por favor"].map(opcion), [1, 2, 3, 3, null, null, null]);
  assert.deepStrictEqual(nombreYDni("Ana Pérez 25.123.456"), { nombre: "Ana Pérez", dni: "25123456" });
  assert.deepStrictEqual(nombreYDni("DNI 25 123 456, Juan Carlos Gómez"), { nombre: "Juan Carlos Gómez", dni: "25123456" });
  assert.strictEqual(nombreYDni("25123456"), null);
  assert.strictEqual(nombreYDni("Ana 25123456"), null);
  assert.strictEqual(nombreYDni("Ana Pérez"), null);

  let eventos = [];
  const pedidosIA = [], respuestasIA = []; // respuestasIA: mensajes que la IA simulada devuelve, en orden
  globalThis.fetch = async (url, init = {}) => {
    const json = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
    const u = new URL(String(url));
    if (u.host === "oauth2.googleapis.com") return json({ access_token: "g" });
    if (u.host === "llm.test") { pedidosIA.push(JSON.parse(init.body)); return json({ choices: [{ message: { role: "assistant", content: null, ...(respuestasIA.shift() || { content: "Claro, te ayudo con eso." }) } }] }); }
    if (init.method === "POST") { const e = { ...JSON.parse(init.body), id: "ev" + eventos.length }; eventos.push(e); return json(e); }
    const porId = eventos.find((e) => u.pathname.endsWith("/events/" + e.id));
    if (init.method === "PATCH") { Object.assign(porId, JSON.parse(init.body)); return json(porId); }
    if (init.method === "GET" && /\/events\/[^/]+$/.test(u.pathname)) return porId ? json(porId) : new Response("{}", { status: 404 });
    if (init.method === "DELETE") { eventos = eventos.filter((e) => !u.pathname.endsWith(e.id)); return new Response(null, { status: 204 }); }
    const [k, v] = (u.searchParams.get("privateExtendedProperty") || "").split("=");
    return json({ items: eventos.filter((e) => !k || e.extendedProperties.private[k] === v) });
  };

  const tel = "5492611234567";
  const dice = async (texto, t = tel) => (await atender({ tel: t, clave: t, texto })).texto;
  assert.match(await dice("hola, quería un turno"), /asistente de turnos de la Dra\. Prueba[\s\S]*1\) Control clínico[\s\S]*4\) Empadronamiento[\s\S]*6\) Ver o cancelar[\s\S]*107/);
  assert.match(await dice("1"), /Días con turnos en Sede Centro:\n1\) (martes|jueves) /); // control clínico => Centro, sin preguntar sede
  assert.match(await dice("1"), /Horarios del .* en Sede Centro:\n1\) 08:30\n2\) 09:30\n3\) 10:00\n4\) 10:30/);
  assert.match(await dice("3"), /nombre y apellido y tu número de DNI/);
  assert.match(await dice("Ana"), /No llegué a leer bien/); // un reintento
  assert.match(await dice("Ana Pérez 25.123.456"), /a las 10:00[\s\S]*Sede Centro[\s\S]*Control clínico[\s\S]*Ana Pérez · DNI 25123456[\s\S]*1\) Confirmar/);
  assert.match(await dice("1"), /✅ Listo, tu turno quedó reservado/);
  assert.strictEqual(eventos.length, 1);
  assert.deepStrictEqual([eventos[0].location, eventos[0].summary], ["Sede Centro", "Turno: Ana Pérez (Sede Centro)"]);
  assert.match(eventos[0].description, /^DNI 25123456\nMotivo: Control clínico\nPedido por WhatsApp desde \+5492611234567$/);
  assert.deepStrictEqual(eventos[0].extendedProperties.private, { tel, motivo: "clinico" });
  assert.match(eventos[0].start.dateTime, /T13:00:00\.000Z$/); // 10:00 hora argentina
  assert.strictEqual(pedidosIA.length, 0); // todo lo anterior lo resolvió el menú, sin IA

  assert.strictEqual(await dice("gracias!!"), ""); // después de terminar, silencio
  assert.match(await dice("1"), /Ya tenés un turno el .* a las 10:00 en Sede Centro/);
  assert.match(await dice("6"), /Tus turnos:\n1\) .* a las 10:00 \(Sede Centro\)/);
  assert.match(await dice("1"), /¿Cancelo el turno/);
  assert.match(await dice("1"), /Listo, cancelé el turno/);
  assert.strictEqual(eventos.length, 0);

  // Control de estudios => Sede Norte (solo miércoles); empadronamiento => Centro
  const est = "5492610000001";
  await dice("hola", est);
  assert.match(await dice("2", est), /Días con turnos en Sede Norte:\n1\) miércoles /);
  const emp = "5492610000002";
  await dice("hola", emp);
  assert.match(await dice("4", emp), /Días con turnos en Sede Centro:/);

  // Derivación y recetas: solo informan, no agendan, y el chat sigue en el menú
  const info = "5492610000003";
  await dice("hola", info);
  assert.match(await dice("3", info), /no se dan con turno[\s\S]*recetas@ejemplo\.com o doctora@ejemplo\.com[\s\S]*2 derivaciones por mes/);
  assert.match(await dice("5", info), /formulario en el buzón[\s\S]*7 días[\s\S]*\$10\.000/);
  assert.strictEqual(eventos.length, 0);

  // Lo que el menú no entiende lo toma la IA, sin avisar (no hay texto tipo "te paso con...")
  const otro = "5492619999999";
  await dice("buenas", otro);
  await dice("1", otro);
  assert.match(await dice("0", otro), /1\) Control clínico/); // "0" vuelve al menú
  assert.strictEqual(await dice("quiero un turno para mi mamá", otro), "Claro, te ayudo con eso."); // texto libre en el menú => IA
  assert.strictEqual(pedidosIA.length, 1);
  assert.strictEqual(await dice("ok dale", otro), "Claro, te ayudo con eso."); // la IA sigue conduciendo ese chat
  assert.strictEqual(pedidosIA.length, 2);
  assert.match(await dice("menú", otro), /1\) Control clínico/); // el paciente puede volver al menú
  // dentro de un paso: 1.ª respuesta inválida se pide de nuevo, la 2.ª la toma la IA
  const tercero = "5492618888888";
  await dice("hola", tercero);
  await dice("1", tercero);
  assert.match(await dice("no sé", tercero), /Respondé solo con el número/);
  assert.strictEqual(await dice("no entiendo", tercero), "Claro, te ayudo con eso.");
  // si la IA deriva, el chat pasa a la secretaria
  respuestasIA.push({ tool_calls: [{ id: "d1", type: "function", function: { name: "derivar", arguments: '{"silencio":false,"mensaje":"Ya le paso tu mensaje a alguien del consultorio."}' } }] });
  const r = await atender({ tel: tercero, clave: tercero, texto: "me duele el pecho" });
  assert.deepStrictEqual(r, { texto: "Ya le paso tu mensaje a alguien del consultorio.", derivar: true });

  // La IA recibe lo que mostró el menú y lo elegido (no arranca de cero)
  const cuarto = "5492617777777";
  await dice("hola", cuarto);
  await dice("1", cuarto);
  await dice("el jueves", cuarto);
  pedidosIA.length = 0;
  await dice("el jueves te dije", cuarto);
  const msgsIA = pedidosIA[0].messages;
  assert.match(msgsIA.at(-2).content, /^Motivo elegido: Control clínico \(motivo clinico\)\.\nDías con turnos en Sede Centro:/);
  assert.deepStrictEqual(msgsIA.at(-1), { role: "user", content: "el jueves te dije" });
  // un "gracias" a la IA no se responde y NO pasa el chat a la secretaria
  respuestasIA.push({ tool_calls: [{ id: "s1", type: "function", function: { name: "derivar", arguments: '{"silencio":true}' } }] });
  assert.deepStrictEqual(await atender({ tel: cuarto, clave: cuarto, texto: "gracias" }), { texto: "", derivar: false });
  assert.strictEqual(await dice("ok dale", cuarto), "Claro, te ayudo con eso."); // la IA sigue atendiendo ese chat

  // Chat que quedó a mitad de camino con la versión anterior (sin motivo): vuelve al menú, no rompe
  const estado = await import("./lib/estado.js");
  estado.fijarFlujo("5492616666666", { paso: "dia", sede: "Sede Centro", dias: ["2026-10-27"] });
  assert.match(await dice("1", "5492616666666"), /1\) Control clínico/);

  // Cupo: "no sabe" cuenta para el mismo 60% que control clínico
  const ag = await import("./lib/agenda.js");
  const consultados = [];
  const fetchAntes = globalThis.fetch;
  globalThis.fetch = async (url, init) => { const p = new URL(String(url)).searchParams.get("privateExtendedProperty"); if (p) consultados.push(p); return fetchAntes(url, init); };
  await ag.turnosLibresPara("clinico");
  await ag.turnosLibresPara("no_sabe");
  globalThis.fetch = fetchAntes;
  assert.deepStrictEqual(consultados, ["motivo=clinico", "motivo=no_sabe", "motivo=clinico", "motivo=no_sabe"]);
}

// Recordatorios: turno cargado a mano (teléfono en la descripción) y turno del bot
{
  const agenda = await import("./lib/agenda.js");
  const { atender, recordatorio } = await import("./lib/arbol.js");
  const { pagina, proximoDia, pendientes } = await import("./lib/panel.js");
  const { telDe } = agenda;
  assert.strictEqual(telDe({ description: "DNI 30111222\nTel 261 555-1234" }), "5492615551234");
  assert.strictEqual(telDe({ summary: "Juan 30111222" }), null); // un DNI no es teléfono
  assert.strictEqual(proximoDia(Date.parse("2026-10-30T12:00:00-03:00")), "2026-11-03"); // viernes → martes

  const manana = new Date(Date.now() + 86400e3).toISOString();
  const fin = new Date(Date.now() + 86400e3 + 45 * 60e3).toISOString();
  const evs = [
    { id: "m1", summary: "Juan <b>Gómez</b>", description: "Tel 261 555-1234", location: "Sede Centro", start: { dateTime: manana }, end: { dateTime: fin } },
    { id: "b1", summary: "Turno: Ana Pérez (Sede Norte)", location: "Sede Norte", start: { dateTime: manana }, end: { dateTime: fin }, extendedProperties: { private: { tel: "5492611234567" } } },
    { id: "x1", summary: "Sin datos", start: { dateTime: manana }, end: { dateTime: fin } },
    { id: "v1", summary: "Vacaciones", start: { date: "2026-12-01" }, end: { date: "2026-12-02" } },
  ];
  globalThis.fetch = async (url, init = {}) => {
    const json = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
    const u = new URL(String(url));
    if (u.host === "oauth2.googleapis.com") return json({ access_token: "g" });
    const e = evs.find((x) => u.pathname.endsWith("/events/" + x.id));
    if (init.method === "PATCH") { Object.assign(e, JSON.parse(init.body)); return json(e); }
    if (init.method === "DELETE") { evs.splice(evs.indexOf(e), 1); return new Response(null, { status: 204 }); }
    if (/\/events\/[^/]+$/.test(u.pathname)) return e ? json(e) : new Response("{}", { status: 404 });
    return json({ items: evs });
  };
  const turnos = await agenda.turnosDelDia("2026-10-27");
  assert.deepStrictEqual(turnos.map((t) => [t.nombre, t.tel]), [["Juan <b>Gómez</b>", "5492615551234"], ["Ana Pérez", "5492611234567"], ["Sin datos", null]]);
  assert.strictEqual(pendientes(turnos).length, 2);
  const html = pagina({ fecha: "2026-10-27", turnos, aviso: "" });
  assert.match(html, /Juan &#60;b&#62;Gómez/); assert.match(html, /sin teléfono/); assert.match(html, /Enviar recordatorios \(2\)/);

  const [juan, ana] = turnos;
  assert.match(recordatorio(juan.tel, juan), /Te recordamos que el .* tenés turno con la Dra\. Prueba[\s\S]*1\) Sí, voy\n2\) No puedo ir/);
  assert.match((await atender({ tel: juan.tel, clave: juan.tel, texto: "Si, ahí estaré" })).texto, /Gracias! Te esperamos/);
  assert.match(evs[0].summary, /^✅ Juan/); assert.strictEqual(evs[0].extendedProperties.private.confirmado, "1");

  // Recordatorio del viernes para el martes: el lunes (3 días después) la respuesta todavía vale
  {
    const estado = await import("./lib/estado.js");
    const real = Date.now;
    estado.fijarFlujo("viejo", { paso: "recordatorio", hasta: real() + 5 * 86400e3 });
    estado.fijarFlujo("comun", { paso: "menu" });
    Date.now = () => real() + 3 * 86400e3;
    try {
      assert.strictEqual(estado.flujo("viejo")?.paso, "recordatorio");
      assert.strictEqual(estado.flujo("comun"), null);
    } finally { Date.now = real; }
  }
  recordatorio(ana.tel, ana);
  assert.match((await atender({ tel: ana.tel, clave: ana.tel, texto: "2" })).texto, /¿Cancelo el turno/);
  assert.match((await atender({ tel: ana.tel, clave: ana.tel, texto: "1" })).texto, /cancelé/);
  assert.ok(!evs.some((x) => x.id === "b1"));
  // Otro teléfono no puede confirmar ni cancelar un turno ajeno
  assert.deepStrictEqual(await agenda.cancelar("5492619999999", "m1"), { error: "No encontré ese turno a nombre de este teléfono." });
}

console.log("ok");
