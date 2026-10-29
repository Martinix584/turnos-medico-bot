// Historial corto y pausas por chat, en chats.json (texto de pacientes: dato personal,
// se borra a las 24 h). Escritura atómica: un corte de luz no lo deja a medias.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ARCHIVO = process.env.CHATS_JSON || fileURLToPath(new URL("../chats.json", import.meta.url)); // CHATS_JSON: para tests
const DIA = 24 * 3600e3;
// Vence a las 24 h, o más tarde si el paso lo pide (flujo.hasta: un recordatorio espera hasta el turno).
const vivo = (c, ahora = Date.now()) => ahora - c.at < DIA || c.flujo?.hasta > ahora;

let chats = {};
try { chats = JSON.parse(fs.readFileSync(ARCHIVO, "utf8")); } catch {}

function guardar() {
  const ahora = Date.now();
  for (const [k, c] of Object.entries(chats)) if (!vivo(c, ahora) && !(c.pausaHasta > ahora)) delete chats[k];
  fs.writeFileSync(ARCHIVO + ".tmp", JSON.stringify(chats));
  fs.renameSync(ARCHIVO + ".tmp", ARCHIVO);
}

export const historial = (k) => (chats[k] && Date.now() - chats[k].at < DIA ? chats[k].msgs : []);
export const pausado = (k) => chats[k]?.pausaHasta > Date.now();
export const pausaHasta = (k) => (pausado(k) ? chats[k].pausaHasta : 0);

export function anotar(k, msgs) {
  chats[k] = { ...chats[k], msgs: msgs.slice(-20), at: Date.now() };
  guardar();
}

// En qué paso del árbol está cada chat (y lo elegido hasta ahí). Vence a las 24 h.
export const flujo = (k) => (chats[k] && vivo(chats[k]) ? chats[k].flujo ?? null : null);
export function fijarFlujo(k, f) {
  chats[k] = { msgs: [], ...chats[k], flujo: f, at: Date.now() };
  guardar();
}

export function pausar(k, horas) {
  chats[k] = { msgs: [], ...chats[k], flujo: null, at: Date.now(), pausaHasta: Date.now() + horas * 3600e3 }; // intervino una persona: el árbol arranca de cero
  guardar();
}

// Desde el panel: el bot vuelve a atender ese chat.
export function despausar(k) {
  if (!chats[k]?.pausaHasta) return;
  chats[k].pausaHasta = 0;
  guardar();
}
