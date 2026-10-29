// Avisos para la secretaria (chats que el bot no pudo responder): se ven en el panel.
// En avisos.json para que sobrevivan a un reinicio; se borran a los 7 días.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ARCHIVO = process.env.AVISOS_JSON || fileURLToPath(new URL("../avisos.json", import.meta.url)); // AVISOS_JSON: para tests
const VENCE = 7 * 86400e3;

let lista = [];
try { lista = JSON.parse(fs.readFileSync(ARCHIVO, "utf8")); } catch {}

function guardar() {
  lista = lista.filter((a) => Date.now() - a.at < VENCE);
  fs.writeFileSync(ARCHIVO + ".tmp", JSON.stringify(lista));
  fs.renameSync(ARCHIVO + ".tmp", ARCHIVO);
}

export const pendientes = () => lista.filter((a) => !a.listo && Date.now() - a.at < VENCE);

export function avisar(tel, que, detalle = "") {
  lista.push({ id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), tel, que, detalle });
  guardar();
}

export function listo(id) {
  const a = lista.find((x) => x.id === id);
  if (a) { a.listo = true; guardar(); }
}

// Alguien respondió ese chat desde el panel: sus avisos quedan resueltos.
export function listoDe(tel) {
  const suyos = lista.filter((x) => x.tel === tel && !x.listo);
  for (const a of suyos) a.listo = true;
  if (suyos.length) guardar();
}
