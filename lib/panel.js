// Panel local de recordatorios para la secretaria (solo 127.0.0.1): muestra los turnos del próximo
// día de consultorio y un botón. Abrir → "Enviar recordatorios" → Aceptar.

import http from "node:http";
import * as agenda from "./agenda.js";
import { cfg } from "./config.js";
import { habilitado } from "./tel.js";
import { fechaAR, inicios, hora } from "./slots.js";

// Próximo día con horario en alguna sede (viernes → martes).
export function proximoDia(ahora = Date.now()) {
  for (let d = 1; d <= 7; d++) {
    const f = fechaAR(ahora + d * 86400e3);
    if (cfg.sedes.some((s) => inicios(f, s.horarios, cfg.turnoMin).length)) return f;
  }
  return fechaAR(ahora + 86400e3);
}

export const pendientes = (turnos) => turnos.filter((t) => t.tel && !t.recordado && habilitado(t.tel));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const estadoDe = (t) => (t.confirmado ? "✅ confirmó" : t.recordado ? "enviado, sin respuesta" : t.tel ? "" : "⚠️ sin teléfono");

export function pagina({ fecha, turnos, aviso }) {
  const n = pendientes(turnos).length;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Recordatorios</title>
<style>body{font:18px system-ui;max-width:720px;margin:2em auto;padding:0 1em}td{padding:.4em .8em;border-bottom:1px solid #ddd}
button{font-size:1.3em;padding:.6em 1.4em;margin-top:1em;cursor:pointer}.aviso{background:#fff6c8;padding:.6em 1em}input{font-size:1em}</style>
${aviso ? `<p class="aviso">${esc(aviso)}</p>` : ""}
<form><h2>Turnos del <input type="date" name="fecha" value="${fecha}" onchange="this.form.submit()"></h2></form>
${turnos.length ? `<table>${turnos.map((t) => `<tr><td>${hora(t.inicio)}</td><td>${esc(t.nombre)}</td><td>${esc(t.sede)}</td><td>${estadoDe(t)}</td></tr>`).join("")}</table>` : "<p>No hay turnos ese día.</p>"}
${n ? `<form method="post" action="/enviar" onsubmit="return confirm('¿Mandar ${n} recordatorios por WhatsApp?')"><input type="hidden" name="fecha" value="${fecha}"><button>Enviar recordatorios (${n})</button></form>` : ""}`;
}

// enviar(fecha) arranca el envío y devuelve el aviso para mostrar.
export function servir({ puerto, enviar }) {
  let aviso = "";
  const fechaOk = (f) => (/^\d{4}-\d\d-\d\d$/.test(f || "") ? f : null);
  http.createServer(async (req, res) => {
    // Solo desde esta PC: otro Host (DNS rebinding) u otro Origin (una web abierta en el navegador) no entra.
    if (![`127.0.0.1:${puerto}`, `localhost:${puerto}`].includes(req.headers.host)) return res.writeHead(403).end();
    try {
      const u = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "POST" && u.pathname === "/enviar") {
        if (req.headers.origin !== `http://${req.headers.host}`) return res.writeHead(403).end();
        let body = "";
        for await (const c of req) body += c;
        const fecha = fechaOk(new URLSearchParams(body).get("fecha"));
        if (!fecha) return res.writeHead(400).end();
        aviso = await enviar(fecha);
        return res.writeHead(303, { Location: `/?fecha=${fecha}` }).end();
      }
      const fecha = fechaOk(u.searchParams.get("fecha")) || proximoDia();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(pagina({ fecha, turnos: await agenda.turnosDelDia(fecha), aviso }));
      aviso = "";
    } catch (e) {
      console.error("panel:", e.message);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Error: " + e.message);
    }
  }).on("error", (e) => console.error("panel:", e.message)) // puerto ocupado: sin panel, pero el bot sigue
    .listen(puerto, "127.0.0.1", () => console.log(`Recordatorios: http://127.0.0.1:${puerto}`));
}
