// node test.js — sin red.
import assert from "node:assert";
import { libres as libresSedes, idTurno, msDeId, rangoBusqueda, intervalo, hora, validarSedes } from "./lib/slots.js";
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
const SEDES = validarSedes([
  { nombre: "Sede Centro", horarios: { mar: ["08:00-16:00"], jue: ["08:00-16:00"] } },
  { nombre: "Sede Norte", horarios: { mie: ["09:00-14:00"], vie: ["09:00-14:00"] } },
]);
const lunes = Date.parse("2026-10-26T07:00:00-03:00");
const semana = libresSedes({ ahora: lunes, dias: 7, sedes: SEDES, min: 45, ocupados: [] });
const delDia = (f) => semana.filter((x) => idTurno(x.t).startsWith(f));
assert.strictEqual(delDia("2026-10-26").length, 0); // lunes: nada
assert.deepStrictEqual([delDia("2026-10-27").length, hora(delDia("2026-10-27")[0].t), hora(delDia("2026-10-27").at(-1).t)], [10, "08:00", "14:45"]);
assert.ok(delDia("2026-10-27").every((x) => x.sede === "Sede Centro"));
assert.deepStrictEqual([delDia("2026-10-28").length, hora(delDia("2026-10-28")[0].t), hora(delDia("2026-10-28").at(-1).t)], [6, "09:00", "12:45"]);
assert.ok(delDia("2026-10-28").every((x) => x.sede === "Sede Norte"));
assert.strictEqual(semana.length, 32); // mar+jue 10 c/u, mié+vie 6 c/u
assert.throws(() => validarSedes([{ nombre: "A", horarios: { mar: ["08:00-12:00"] } }, { nombre: "B", horarios: { mar: ["11:00-14:00"] } }]), /se pisan el mar/);
assert.doesNotThrow(() => validarSedes([{ nombre: "A", horarios: { mar: ["08:00-12:00"] } }, { nombre: "B", horarios: { mar: ["12:00-14:00"] } }]));
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
    CONSULTORIO: "el consultorio de prueba", TURNO_MIN: "45", CALENDAR_ID: "cal@group.calendar.google.com", BOT_ACTIVO: "1",
    SEDES: JSON.stringify(SEDES), LLM_BASE_URL: "https://llm.test/v1/", LLM_API_KEY: "k", LLM_MODEL: "m",
    GOOGLE_SA_JSON: JSON.stringify({ client_email: "bot@x.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }),
  });
  const { responder } = await import("./lib/ia.js");
  const pedidos = [], eventos = [];
  const llm = [
    { tool_calls: [{ id: "c1", type: "function", function: { name: "turnos_libres", arguments: '{"sede":"Sede Norte"}' } }] },
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
      sig.tool_calls[0].function.arguments = JSON.stringify({ turno: libres[0].id, sede: libres[0].sede, nombre: "Ana Pérez" });
    }
    return json({ choices: [{ message: { role: "assistant", content: null, ...sig } }] });
  };
  const r = await responder("5492611234567", [{ role: "user", content: "turno en flor de lis, soy Ana Pérez" }]);
  assert.deepStrictEqual(r, { texto: "Listo Ana, te espero en Sede Norte.", derivar: undefined });
  assert.strictEqual(pedidos.length, 4);
  assert.deepStrictEqual(pedidos[0].tools.map((t) => t.function.name), ["turnos_libres", "mis_turnos", "reservar", "cancelar", "derivar"]);
  const libres = JSON.parse(pedidos[1].messages.at(-1).content);
  assert.ok(libres.length && libres.every((x) => x.sede === "Sede Norte"));
  assert.match(pedidos[2].messages.at(-1).content, /JSON inválidos/); // el JSON roto vuelve como error, no rompe
  assert.strictEqual(eventos.length, 1);
  assert.strictEqual(eventos[0].location, "Sede Norte");
  assert.match(eventos[0].summary, /^Turno: Ana Pérez \(Sede Norte\)$/);
  assert.strictEqual(eventos[0].extendedProperties.private.tel, "5492611234567");

  // derivar con mensaje (urgencia) y en silencio (gracias)
  llm.push({ tool_calls: [{ id: "d1", type: "function", function: { name: "derivar", arguments: '{"silencio":false,"mensaje":"Si es urgente llamá al 107."}' } }] });
  assert.deepStrictEqual(await responder("549261", [{ role: "user", content: "me duele el pecho" }]), { texto: "Si es urgente llamá al 107.", derivar: { silencio: false } });
  llm.push({ tool_calls: [{ id: "d2", type: "function", function: { name: "derivar", arguments: '{"silencio":true}' } }] });
  assert.deepStrictEqual(await responder("549261", [{ role: "user", content: "gracias!" }]), { texto: "", derivar: { silencio: true } });
}

// Árbol de decisión: recorrido completo con un calendario simulado en memoria
{
  const { atender, opcion, nombreYDni, DERIVAR } = await import("./lib/arbol.js");
  process.env.MOTIVOS = JSON.stringify(["Control clínico", "Control de estudios", "Derivaciones", "Completar formulario", "Recetas"]);
  process.env.CONSULTORIO = "la Dra. Prueba";

  assert.deepStrictEqual(["1", " 2 ", "opción 3", "3)", "hola", "1 o 2", "quiero el turno 1 por favor"].map(opcion), [1, 2, 3, 3, null, null, null]);
  assert.deepStrictEqual(nombreYDni("Ana Pérez 25.123.456"), { nombre: "Ana Pérez", dni: "25123456" });
  assert.deepStrictEqual(nombreYDni("DNI 25 123 456, Juan Carlos Gómez"), { nombre: "Juan Carlos Gómez", dni: "25123456" });
  assert.strictEqual(nombreYDni("25123456"), null);
  assert.strictEqual(nombreYDni("Ana 25123456"), null);
  assert.strictEqual(nombreYDni("Ana Pérez"), null);

  let eventos = [];
  globalThis.fetch = async (url, init = {}) => {
    const json = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
    const u = new URL(String(url));
    if (u.host === "oauth2.googleapis.com") return json({ access_token: "g" });
    if (init.method === "POST") { const e = { ...JSON.parse(init.body), id: "ev" + eventos.length }; eventos.push(e); return json(e); }
    const porId = eventos.find((e) => u.pathname.endsWith("/events/" + e.id));
    if (init.method === "PATCH") { Object.assign(porId, JSON.parse(init.body)); return json(porId); }
    if (init.method === "GET" && /\/events\/[^/]+$/.test(u.pathname)) return porId ? json(porId) : new Response("{}", { status: 404 });
    if (init.method === "DELETE") { eventos = eventos.filter((e) => !u.pathname.endsWith(e.id)); return new Response(null, { status: 204 }); }
    const tel = u.searchParams.get("privateExtendedProperty")?.split("=")[1];
    return json({ items: eventos.filter((e) => !tel || e.extendedProperties.private.tel === tel) });
  };

  const tel = "5492611234567";
  const dice = async (texto, t = tel) => (await atender({ tel: t, clave: t, texto })).texto;
  assert.match(await dice("hola, quería un turno"), /asistente de turnos de la Dra\. Prueba[\s\S]*1\) Sacar turno[\s\S]*107/);
  assert.match(await dice("1"), /motivo[\s\S]*1\) Control clínico[\s\S]*5\) Recetas/);
  assert.match(await dice("1"), /sede[\s\S]*2\) Sede Norte \(miércoles y viernes\)/);
  const dias = await dice("2");
  assert.match(dias, /Días con turnos en Sede Norte:\n1\) (miércoles|viernes) /);
  const horas = await dice("1");
  assert.match(horas, /Horarios del .* en Sede Norte:\n1\) 09:00\n2\) 09:45\n3\) 10:30/);
  assert.match(await dice("3"), /nombre y apellido y tu número de DNI/);
  assert.match(await dice("Ana"), /No llegué a leer bien/); // un reintento
  const resumen = await dice("Ana Pérez 25.123.456");
  assert.match(resumen, /a las 10:30[\s\S]*Sede Norte[\s\S]*Control clínico[\s\S]*Ana Pérez · DNI 25123456[\s\S]*1\) Confirmar/);
  assert.match(await dice("1"), /✅ Listo, tu turno quedó reservado/);
  assert.strictEqual(eventos.length, 1);
  assert.deepStrictEqual([eventos[0].location, eventos[0].summary], ["Sede Norte", "Turno: Ana Pérez (Sede Norte)"]);
  assert.match(eventos[0].description, /^DNI 25123456\nMotivo: Control clínico\nPedido por WhatsApp desde \+5492611234567$/);
  assert.match(eventos[0].start.dateTime, /T13:30:00\.000Z$/); // 10:30 hora argentina

  assert.strictEqual(await dice("gracias!!"), ""); // después de terminar, silencio
  assert.match(await dice("1"), /Ya tenés un turno el .* a las 10:30 en Sede Norte/);
  assert.match(await dice("2"), /Tus turnos:\n1\) .* a las 10:30 \(Sede Norte\)/);
  assert.match(await dice("1"), /¿Cancelo el turno/);
  assert.match(await dice("1"), /Listo, cancelé el turno/);
  assert.strictEqual(eventos.length, 0);

  // Otro paciente: "0" vuelve al menú; dos respuestas inválidas seguidas pasan a la secretaria
  const otro = "5492619999999";
  await dice("buenas", otro);
  await dice("1", otro);
  assert.match(await dice("0", otro), /1\) Sacar turno/);
  assert.match(await dice("quiero un turno para mi mamá", otro), /Respondé solo con el número/);
  assert.deepStrictEqual(await atender({ tel: otro, clave: otro, texto: "es urgente" }), { texto: DERIVAR, derivar: true });
  // opción 3 = otra consulta
  const tercero = "5492618888888";
  await dice("hola", tercero);
  assert.deepStrictEqual((await atender({ tel: tercero, clave: tercero, texto: "3" })).derivar, true);
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
