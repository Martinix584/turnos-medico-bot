// Qué mensajes toca el bot. Puro (sin socket) para poder testearlo.
//   { tipo: "paciente", jid, texto }  texto entrante de un chat 1 a 1
//   { tipo: "propio", jid }           algo que salió del número (secretaria o el bot)
//   null                              todo lo demás: se ignora sin responder

import { normalizeMessageContent, isJidGroup, isJidBroadcast, isJidNewsletter, isJidStatusBroadcast } from "baileys";

export const VIEJO_SEG = 10 * 60; // al volver la PC llega lo atrasado; eso ya lo vio la secretaria

export function clasificar(m, ahoraSeg = Math.floor(Date.now() / 1000)) {
  const jid = m.key?.remoteJid;
  if (!jid || isJidGroup(jid) || isJidBroadcast(jid) || isJidStatusBroadcast(jid) || isJidNewsletter(jid)) return null;
  if (ahoraSeg - Number(m.messageTimestamp || 0) > VIEJO_SEG) return null;
  const c = normalizeMessageContent(m.message);
  if (!c || c.protocolMessage || c.reactionMessage || c.editedMessage) return null;
  if (m.key.fromMe) return { tipo: "propio", jid };
  const texto = (c.conversation ?? c.extendedTextMessage?.text ?? "").trim();
  return texto ? { tipo: "paciente", jid, texto } : null; // audio, fotos, stickers: los ve la secretaria
}
