// Bot de turnos sobre el WhatsApp Business del consultorio, como dispositivo vinculado (Baileys).
// El celular sigue funcionando: la secretaria ve todo y puede contestar. Si ella escribe en
// un chat, el bot se calla ahí PAUSA_HORAS.
//
// Cuidados para no molestar al celular: no se marca "en línea" (cortaría las notificaciones
// del teléfono) y nunca se marcan mensajes como leídos.

import { fileURLToPath } from "node:url";
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, generateMessageIDV2, isPnUser, jidNormalizedUser } from "baileys";
import qrcode from "qrcode-terminal";
import pino from "pino";

const aqui = (p) => fileURLToPath(new URL(p, import.meta.url));
try { process.loadEnvFile(aqui("./.env")); } catch {} // funciona aunque el autoarranque corra desde otra carpeta

const { clasificar } = await import("./lib/clasificar.js");
// Motor: el menú (arbol.js) atiende casi todo; la IA (ia.js) entra sola, sin avisar, cuando el menú no entiende.
const motor = await import("./lib/arbol.js");
const estado = await import("./lib/estado.js");
const { habilitado } = await import("./lib/tel.js");
const { cfg, activo } = await import("./lib/config.js");
const agenda = await import("./lib/agenda.js");
const { recordatorio } = await import("./lib/arbol.js");
const panel = await import("./lib/panel.js");
const avisos = await import("./lib/avisos.js");
const bandeja = await import("./lib/bandeja.js");

// Config completa al arrancar: si falta algo, mejor no conectar que pausar todos los chats en silencio.
try {
  for (const k of ["sedes", "turnoMin", "calendarId", "consultorio", "sedeClinica", "sedeEstudios", "mailRecetas", "llm"]) if (cfg[k] === undefined || Number.isNaN(cfg[k])) throw new Error(`${k} inválido`);
  // Una sede mal escrita (o con acentos rotos) haría fallar cada reserva en silencio: mejor no arrancar.
  for (const s of [cfg.sedeClinica, cfg.sedeEstudios]) if (!cfg.sedes.some((x) => x.nombre === s)) throw new Error(`la sede "${s}" no está en SEDES`);
  if (!process.env.GOOGLE_SA_JSON) throw new Error("Falta la variable GOOGLE_SA_JSON en .env");
  JSON.parse(process.env.GOOGLE_SA_JSON);
} catch (e) {
  console.error("Configuración incompleta:", e.message);
  process.exit(1);
}

const enviados = new Map(); // id -> contenido de lo que mandó el bot (getMessage + no confundirlo con la secretaria)
let cola = Promise.resolve(); // de a un mensaje por vez: sin doble respuesta ni doble reserva
let generacion = 0;
let sockActual = null;
let mandando = false;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Teléfono real del chat (los chats nuevos suelen venir como @lid, que no es un teléfono).
async function telefono(sock, key) {
  const pn = [key.remoteJidAlt, key.remoteJid].find((j) => isPnUser(j)) ??
    (await sock.signalRepository.lidMapping.getPNForLID(key.remoteJid).catch(() => null));
  return pn ? jidNormalizedUser(pn).split("@")[0] : null;
}

async function enviar(sock, jid, texto) {
  if (!activo()) return console.log(`[BOT_ACTIVO!=1] → ${jid}: ${texto}`);
  await sock.sendPresenceUpdate("composing", jid).catch(() => {});
  await espera(1500 + Math.random() * 2500); // ritmo humano
  const id = generateMessageIDV2(sock.user?.id);
  const contenido = { conversation: texto };
  enviados.set(id, contenido);
  await sock.sendMessage(jid, { text: texto }, { messageId: id });
  await sock.sendPresenceUpdate("paused", jid).catch(() => {});
}

async function manejar(sock, m) {
  const c = clasificar(m);
  if (!c) return;
  const tel = await telefono(sock, m.key);
  const clave = tel ?? c.jid;

  if (c.tipo === "propio") {
    if (enviados.has(m.key.id)) return; // lo mandó el bot
    if (!estado.pausado(clave)) console.log(`secretaria escribió en ${clave}: bot en pausa ${cfg.pausaHoras} h`);
    return estado.pausar(clave, cfg.pausaHoras);
  }

  if (!tel || !habilitado(tel) || estado.pausado(clave)) return; // sin teléfono no se reserva nada
  let r;
  try {
    r = await motor.atender({ tel, clave, texto: c.texto });
  } catch (e) {
    console.error("error respondiendo:", e.message);
    estado.pausar(clave, cfg.pausaHoras); // que lo vea una persona; al paciente no se le dice nada
    // Aviso a la secretaria en el panel (http://127.0.0.1:3000).
    const que = e.message.startsWith("LLM") ? "falló la IA" : e.message.startsWith("Calendar") ? "falló Google Calendar" : "error del bot";
    return avisos.avisar(tel, que, e.message.slice(0, 200));
  }
  if (r.texto) await enviar(sock, c.jid, r.texto);
  if (r.derivar) estado.pausar(clave, cfg.pausaHoras);
}

async function capturar(sock, m) {
  const r = bandeja.leer(m);
  if (!r) return;
  const tel = await telefono(sock, m.key);
  if (!tel) return;
  bandeja.guardar({ ...r, tel, de: !r.fromMe ? "paciente" : enviados.has(r.id) ? "bot" : "celular" });
}

// Respuesta escrita en el panel: sale aunque BOT_ACTIVO=0 (la escribió una persona). La pausa la pone el panel.
async function responder(tel, texto, quien) {
  if (!sockActual?.user) throw new Error("WhatsApp no está conectado");
  const id = generateMessageIDV2(sockActual.user.id);
  enviados.set(id, { conversation: texto });
  await sockActual.sendMessage(`${tel}@s.whatsapp.net`, { text: texto }, { messageId: id });
  bandeja.guardar({ id, tel, at: Date.now(), de: "panel", texto, quien });
}

// Recordatorios: de a uno, con 20-45 s entre mensajes (poco volumen, ritmo humano).
// auto: el envío automático del día anterior (solo turnos del bot y sin tocar chats en pausa).
async function recordar(fecha, auto = false) {
  if (!sockActual?.user) return "WhatsApp no está conectado. Esperá un minuto y probá de nuevo.";
  if (mandando) return "Ya se están mandando recordatorios.";
  mandando = true; // antes del await: un doble clic no arranca dos envíos
  let turnos;
  try {
    const delDia = await agenda.turnosDelDia(fecha);
    turnos = auto ? panel.pendientesAuto(delDia, estado.pausado) : panel.pendientes(delDia);
  } catch (e) { mandando = false; throw e; }
  (async () => {
    for (const t of turnos) {
      if (auto && estado.pausado(t.tel)) continue; // la secretaria lo tomó mientras tanto
      try {
        await enviar(sockActual, `${t.tel}@s.whatsapp.net`, recordatorio(t.tel, t));
        await agenda.marcar(t.evento, { recordado: "1" });
      } catch (e) { console.error(`recordatorio a ${t.tel}:`, e.message); }
      await espera(20e3 + Math.random() * 25e3);
    }
  })().finally(() => { mandando = false; });
  return `Mandando ${turnos.length} recordatorios de a uno (tarda unos ${Math.ceil(turnos.length * 0.6)} min). Podés cerrar esta ventana.`;
}

async function conectar() {
  const gen = ++generacion;
  const { state, saveCreds } = await useMultiFileAuthState(aqui("./auth/")); // la sesión de WhatsApp del consultorio: no compartir
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "warn" }), // más detalle loguearía contenido de mensajes
    markOnlineOnConnect: false,
    syncFullHistory: false,
    getMessage: async (key) => enviados.get(key.id),
  });

  sockActual = sock;
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (gen !== generacion) return;
    if (qr) { console.log("Escaneá con el WhatsApp Business del consultorio (Dispositivos vinculados → Vincular):"); qrcode.generate(qr, { small: true }); }
    if (connection === "open") console.log(`WhatsApp conectado · BOT_ACTIVO=${process.env.BOT_ACTIVO || "0"} · solo ${process.env.BOT_SOLO_TELEFONOS || "todos"}`);
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error("WhatsApp cerró la sesión (se desvinculó el dispositivo). Borrá la carpeta auth/ y volvé a escanear el QR.");
        process.exit(1);
      }
      console.log(`conexión cerrada (${code ?? "?"}), reconectando…`);
      setTimeout(conectar, code === DisconnectReason.restartRequired ? 0 : 5000);
    }
  });
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (gen !== generacion) return;
    // Bandeja del panel: todo, también lo que manda este mismo socket (llega como "append").
    for (const m of messages) capturar(sock, m).catch((e) => console.error("bandeja:", e.message));
    if (type !== "notify") return;
    for (const m of messages) cola = cola.then(() => manejar(sock, m)).catch((e) => console.error("error:", e.message));
  });
}

panel.servir({ puerto: Number(process.env.PANEL_PUERTO) || 3000, enviar: recordar, responder });

// RECORDAR_HORA (ej. 16): cada 10 min, si es hora, manda los recordatorios de mañana. Una vez por
// fecha en este proceso; si se reinicia, los ya enviados quedan marcados "recordado" y no se repiten.
let recordadoAuto = "";
if (process.env.RECORDAR_HORA) setInterval(async () => {
  const fecha = panel.fechaParaRecordar(Date.now(), Number(process.env.RECORDAR_HORA));
  if (!fecha || fecha === recordadoAuto || !sockActual?.user || mandando) return;
  try { recordadoAuto = fecha; console.log(`recordatorios automáticos para ${fecha}:`, await recordar(fecha, true)); }
  catch (e) { recordadoAuto = ""; console.error("recordatorios automáticos:", e.message); }
}, 10 * 60e3);
conectar().catch((e) => { console.error("no se pudo conectar:", e); process.exit(1); });
