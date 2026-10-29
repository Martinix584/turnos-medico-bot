// Bandeja de chats para el panel: todos los mensajes 1 a 1 del número (pacientes, bot, celular y
// panel), en bandeja.db (SQLite de Node, sin dependencias). Datos de salud: se borran a los
// BANDEJA_DIAS (90 por defecto) y el archivo no va a git.
// Aparte de chats.json, que es solo el contexto corto (24 h) del menú y la IA.

import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { normalizeMessageContent, isJidGroup, isJidBroadcast, isJidStatusBroadcast, isJidNewsletter } from "baileys";

const db = new DatabaseSync(process.env.BANDEJA_DB || fileURLToPath(new URL("../bandeja.db", import.meta.url))); // BANDEJA_DB: para tests
db.exec(`CREATE TABLE IF NOT EXISTS mensajes (id TEXT PRIMARY KEY, tel TEXT NOT NULL, at INTEGER NOT NULL, de TEXT NOT NULL, texto TEXT NOT NULL, nombre TEXT, quien TEXT);
CREATE INDEX IF NOT EXISTS mensajes_tel_at ON mensajes (tel, at);`);
const dias = () => Number(process.env.BANDEJA_DIAS) || 90;

// Texto para mostrar: lo que no es texto queda como etiqueta ("ver en el celular").
function textoDe(c) {
  const t = c.conversation ?? c.extendedTextMessage?.text;
  if (t != null) return t;
  const con = (etq, extra) => (extra ? `${etq} ${extra}` : etq);
  if (c.imageMessage) return con("📷 foto", c.imageMessage.caption);
  if (c.videoMessage) return con("🎥 video", c.videoMessage.caption);
  if (c.audioMessage) return "🎤 audio";
  if (c.documentMessage) return con("📄 documento", c.documentMessage.fileName);
  if (c.stickerMessage) return "sticker";
  if (c.locationMessage) return "📍 ubicación";
  if (c.contactMessage || c.contactsArrayMessage) return "👤 contacto";
  return null;
}

// Mensaje de Baileys → { id, jid, fromMe, at, texto, nombre }, o null si no va a la bandeja.
// A diferencia de clasificar(): guarda también media y lo atrasado (llega al reconectar).
export function leer(m) {
  const jid = m.key?.remoteJid;
  if (!jid || !m.key.id || isJidGroup(jid) || isJidBroadcast(jid) || isJidStatusBroadcast(jid) || isJidNewsletter(jid)) return null;
  const c = normalizeMessageContent(m.message);
  if (!c || c.protocolMessage || c.reactionMessage || c.editedMessage) return null;
  const texto = textoDe(c);
  if (texto == null) return null;
  return { id: m.key.id, jid, fromMe: !!m.key.fromMe, at: Number(m.messageTimestamp || 0) * 1000 || Date.now(), texto, nombre: m.key.fromMe ? null : m.pushName || null };
}

// de: "paciente" | "bot" | "celular" (la secretaria desde el teléfono) | "panel".
// El eco de lo que mandó el panel llega como "celular" por WhatsApp: el del panel gana, en cualquier orden.
export function guardar({ id, tel, at, de, texto, nombre = null, quien = null }) {
  const sql = de === "panel"
    ? "INSERT INTO mensajes VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET de = excluded.de, quien = excluded.quien"
    : "INSERT OR IGNORE INTO mensajes VALUES (?,?,?,?,?,?,?)";
  db.prepare(sql).run(id, tel, at, de, texto, nombre, quien);
  db.prepare("DELETE FROM mensajes WHERE at < ?").run(Date.now() - dias() * 86400e3);
}

// Un renglón por chat, el más reciente arriba; esperando = el último mensaje es del paciente.
export const chats = (limite = 200) => db.prepare(`SELECT m.tel, m.at, m.texto, m.de,
  (SELECT nombre FROM mensajes n WHERE n.tel = m.tel AND n.nombre IS NOT NULL ORDER BY n.at DESC LIMIT 1) AS nombre
  FROM mensajes m WHERE m.rowid = (SELECT rowid FROM mensajes x WHERE x.tel = m.tel ORDER BY x.at DESC, x.rowid DESC LIMIT 1)
  ORDER BY m.at DESC LIMIT ?`).all(limite).map((r) => ({ ...r, esperando: r.de === "paciente" }));

// Los últimos mensajes de un chat, en orden.
export const mensajes = (tel, limite = 200) =>
  db.prepare("SELECT * FROM (SELECT rowid AS orden, * FROM mensajes WHERE tel = ? ORDER BY at DESC, rowid DESC LIMIT ?) ORDER BY at, orden").all(tel, limite);
