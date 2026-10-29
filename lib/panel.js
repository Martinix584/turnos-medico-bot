// Panel local de recordatorios para la secretaria (solo 127.0.0.1): muestra los turnos del próximo
// día de consultorio y un botón. Abrir → "Enviar recordatorios" → Aceptar.
// Arriba, los avisos: chats que el bot no pudo responder (se refresca solo cada minuto).

import http from "node:http";
import * as agenda from "./agenda.js";
import { cfg } from "./config.js";
import { env } from "./env.js";
import { habilitado } from "./tel.js";
import { fechaAR, inicios, hora, etiqueta } from "./slots.js";
import * as avisos from "./avisos.js";
import * as bandeja from "./bandeja.js";
import * as estado from "./estado.js";

// Próximo día con horario en alguna sede (viernes → martes).
export function proximoDia(ahora = Date.now()) {
  for (let d = 1; d <= 7; d++) {
    const f = fechaAR(ahora + d * 86400e3);
    if (cfg.sedes.some((s) => inicios(f, s.horarios, cfg.turnoMin).length)) return f;
  }
  return fechaAR(ahora + 86400e3);
}

export const pendientes = (turnos) => turnos.filter((t) => t.tel && !t.recordado && habilitado(t.tel));
// Envío automático: solo turnos sacados por el bot (mandarle primero a un número que nunca escribió
// es lo que más arriesga un bloqueo) y nunca a un chat que la secretaria tiene en pausa.
export const pendientesAuto = (turnos, pausado) => pendientes(turnos).filter((t) => t.porBot && !pausado(t.tel));

// Recordatorio automático del día anterior: desde `hora` (hora argentina) hasta las 21, para mañana.
// Fuera de esa ventana, null (si la PC arranca a la noche, no se manda a deshoras).
export function fechaParaRecordar(ahora, hora) {
  const h = new Date(ahora - 3 * 3600e3).getUTCHours();
  return hora >= 0 && h >= hora && h < 21 ? fechaAR(ahora + 86400e3) : null;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Estado de cada turno: [texto, clase de color].
const estadoDe = (t) => (t.confirmado ? ["✅ Confirmó", "ok"] : t.recordado ? ["Enviado, sin respuesta", "espera"] : t.tel ? ["Sin recordar", "gris"] : ["⚠️ sin teléfono", "mal"]);
const diaMas = (fecha, d) => fechaAR(Date.parse(`${fecha}T12:00:00-03:00`) + d * 86400e3);
const nombreDia = (fecha) => etiqueta(Date.parse(`${fecha}T12:00:00-03:00`)).split(",")[0].replace("-", "/");

const tablaAvisos = (lista, fecha) => !lista.length ? "" : `<section class="card alerta"><h2>⚠️ El bot no pudo responder (${lista.length})</h2>
<p class="sub">Esos chats quedaron en pausa: respondeles desde Chats o desde el celular.</p>${lista.map((a) =>
  `<div class="fila"><div><a class="tel" href="/chat?tel=${esc(a.tel)}">+${esc(a.tel)}</a><span class="sub" title="${esc(a.detalle)}">${esc(a.que)} · ${esc(etiqueta(a.at).replace("-", "/"))}</span></div>` +
  `<form method="post" action="/listo"><input type="hidden" name="id" value="${esc(a.id)}"><input type="hidden" name="fecha" value="${fecha}"><button class="chico">Listo</button></form></div>`).join("")}</section>`;

const CSS = `:root{color-scheme:light dark;--fondo:#f3f6f8;--card:#fff;--texto:#1d2b36;--sub:#6b7b88;--linea:#e6ecf0;--marca:#0f766e;--marca2:#14b8a6}
@media (prefers-color-scheme:dark){:root{--fondo:#0f1719;--card:#182326;--texto:#e6eef0;--sub:#8fa3ab;--linea:#25353a}}
*{box-sizing:border-box}body{margin:0;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--fondo);color:var(--texto)}
header{background:linear-gradient(135deg,var(--marca),var(--marca2));color:#fff;padding:1.2em 1em 3.2em}
header h1{margin:0;font-size:1.35em}header p{margin:.2em 0 0;opacity:.85;font-size:.95em}
main{max-width:720px;margin:-2.4em auto 2em;padding:0 .8em 7.5em}
.card{background:var(--card);border-radius:16px;padding:1em 1.1em;margin-bottom:1em;box-shadow:0 2px 10px rgba(0,0,0,.06)}
h2{margin:.1em 0 .4em;font-size:1.1em}.sub{color:var(--sub);font-size:.88em;display:block}
.flash{background:#fff4c2;color:#5c4a00;border-radius:12px;padding:.7em 1em;margin-bottom:1em}
.alerta{border-left:5px solid #e5484d}.alerta h2{color:#c4302b}
.fila{display:flex;align-items:center;justify-content:space-between;gap:.8em;padding:.7em 0;border-top:1px solid var(--linea)}
.dia{display:flex;align-items:center;justify-content:space-between;gap:.5em}
.dia a{display:grid;place-items:center;width:2.4em;height:2.4em;border-radius:50%;background:var(--fondo);color:var(--texto);text-decoration:none;font-size:1.2em}
.dia h2{margin:0;text-transform:capitalize;text-align:center}.dia input{border:0;background:none;color:var(--sub);font:inherit;font-size:.85em;text-align:center}
.resumen{display:flex;gap:.5em;flex-wrap:wrap;margin:.8em 0 .2em}.chip{background:var(--fondo);border-radius:99px;padding:.25em .8em;font-size:.85em}
.turno{display:grid;grid-template-columns:4.2em 1fr;gap:.2em .8em;padding:.75em 0;border-top:1px solid var(--linea)}
.hora{font-weight:700;font-size:1.15em;color:var(--marca2)}.nombre{font-weight:600}
.pill{display:inline-block;border-radius:99px;padding:.1em .7em;font-size:.8em;margin-top:.25em}
.ok{background:#dcfce7;color:#166534}.espera{background:#fef3c7;color:#92400e}.gris{background:var(--fondo);color:var(--sub)}.mal{background:#fee2e2;color:#991b1b}
.vacio{color:var(--sub);text-align:center;padding:1.5em 0}
button{font:inherit;cursor:pointer;border:0;border-radius:12px}button.chico{background:var(--fondo);color:var(--texto);padding:.45em 1em;font-weight:600;white-space:nowrap}
.enviar{position:fixed;left:0;right:0;bottom:0;padding:.8em;background:linear-gradient(transparent,var(--fondo) 35%)}
.enviar button{display:block;width:100%;max-width:700px;margin:0 auto;background:var(--marca);color:#fff;padding:1em;font-size:1.05em;font-weight:700;box-shadow:0 6px 18px rgba(15,118,110,.35)}`;

export function pagina({ fecha, turnos, aviso, alertas = [] }) {
  const n = pendientes(turnos).length;
  const confirmados = turnos.filter((t) => t.confirmado).length;
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60">
<title>${alertas.length ? `(${alertas.length}) ` : ""}Recordatorios</title><style>${CSS}${CSS_CHAT}</style>
<header><h1>Turnos y recordatorios</h1><p>${esc(cfg.consultorio)}</p>${nav("turnos")}</header><main>
${aviso ? `<p class="flash">${esc(aviso)}</p>` : ""}
${tablaAvisos(alertas, fecha)}
<section class="card"><form class="dia"><a href="?fecha=${diaMas(fecha, -1)}" aria-label="Día anterior">‹</a>
<div><h2>${esc(nombreDia(fecha))}</h2><input type="date" name="fecha" value="${fecha}" onchange="this.form.submit()" aria-label="Elegir día"></div>
<a href="?fecha=${diaMas(fecha, 1)}" aria-label="Día siguiente">›</a></form>
${turnos.length ? `<div class="resumen"><span class="chip">${turnos.length} turno${turnos.length > 1 ? "s" : ""}</span><span class="chip">✅ ${confirmados} confirmado${confirmados === 1 ? "" : "s"}</span>${n ? `<span class="chip">📨 ${n} por recordar</span>` : ""}</div>` +
  turnos.map((t) => { const [txt, cls] = estadoDe(t); return `<div class="turno"><div class="hora">${hora(t.inicio)}</div><div><div class="nombre">${esc(t.nombre)}</div><span class="sub">${esc(t.sede)}</span><span class="pill ${cls}">${txt}</span></div></div>`; }).join("")
  : `<p class="vacio">No hay turnos ese día.</p>`}</section>
${n ? `<form class="enviar" method="post" action="/enviar" onsubmit="return confirm('¿Mandar ${n} recordatorios por WhatsApp?')"><input type="hidden" name="fecha" value="${fecha}"><button>Enviar recordatorios (${n})</button></form>` : ""}
</main></html>`;
}

// --- Chats: ver y responder WhatsApp desde el panel ---
const CSS_CHAT = `nav{display:flex;gap:.4em;margin-top:.8em}nav a{color:#fff;text-decoration:none;padding:.3em .9em;border-radius:99px;background:rgba(255,255,255,.15);font-size:.92em}
nav a.activo{background:#fff;color:var(--marca);font-weight:700}a.tel{font-weight:700;color:inherit}
.chat{display:flex;gap:.8em;align-items:center;padding:.75em 0;border-top:1px solid var(--linea);color:inherit;text-decoration:none}
.chat .cuerpo{flex:1;min-width:0}.chat .ult{color:var(--sub);font-size:.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat time{color:var(--sub);font-size:.8em;white-space:nowrap}.punto{width:.7em;height:.7em;border-radius:50%;background:var(--marca2);flex:none}
.msgs{display:flex;flex-direction:column;gap:.35em;max-height:60vh;overflow-y:auto;padding:.3em 0}
.msg{max-width:85%;padding:.45em .75em;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--fondo)}
.msg.mio{align-self:flex-end;background:#d9f7ee;color:#10302a}.msg small{display:block;color:var(--sub);font-size:.72em;margin-top:.15em}
@media (prefers-color-scheme:dark){.msg.mio{background:#134e48;color:#e6eef0}}
.responder{display:flex;gap:.5em;margin-top:.8em}.responder textarea{flex:1;font:inherit;padding:.6em;border-radius:12px;border:1px solid var(--linea);background:var(--card);color:var(--texto);resize:vertical}
.responder button{background:var(--marca);color:#fff;padding:0 1.2em;font-weight:700}`;

const nav = (activo) => `<nav><a href="/"${activo === "turnos" ? ' class="activo"' : ""}>Turnos</a><a href="/chats"${activo === "chats" ? ' class="activo"' : ""}>Chats</a></nav>`;
const marco = ({ titulo, sub, tab, cuerpo, refresco }) => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresco ? `<meta http-equiv="refresh" content="${refresco}">` : ""}
<title>${esc(titulo)}</title><style>${CSS}${CSS_CHAT}</style>
<header><h1>${esc(titulo)}</h1><p>${esc(sub)}</p>${nav(tab)}</header><main>${cuerpo}</main></html>`;
const cuandoMsg = (at) => esc(etiqueta(at).replace("-", "/"));
const QUIEN = { bot: "🤖 bot", celular: "📱 celular", panel: "💻 panel" };

export function paginaChats({ lista, aviso = "" }) {
  const esperando = lista.filter((c) => c.esperando).length;
  return marco({ titulo: `${esperando ? `(${esperando}) ` : ""}Chats`, sub: cfg.consultorio, tab: "chats", refresco: 20, cuerpo:
    `${aviso ? `<p class="flash">${esc(aviso)}</p>` : ""}<section class="card"><h2>Chats${esperando ? ` · ${esperando} esperando respuesta` : ""}</h2>` +
    (lista.length ? lista.map((c) => `<a class="chat" href="/chat?tel=${esc(c.tel)}">${c.esperando ? '<span class="punto" title="Esperando respuesta"></span>' : ""}
<div class="cuerpo"><b>${esc(c.nombre || "+" + c.tel)}</b>${c.nombre ? ` <span class="sub" style="display:inline">+${esc(c.tel)}</span>` : ""}<div class="ult">${c.de === "paciente" ? "" : "Vos: "}${esc(c.texto)}</div></div>
<time>${cuandoMsg(c.at)}</time></a>`).join("") : `<p class="vacio">Todavía no hay chats guardados.</p>`) + "</section>" });
}

export const burbujas = (msgs) => msgs.map((m) => `<div class="msg${m.de === "paciente" ? "" : " mio"}">${esc(m.texto)}<small>${m.de === "paciente" ? "" : esc(QUIEN[m.de] + (m.quien ? ` · ${m.quien}` : "")) + " · "}${cuandoMsg(m.at)}</small></div>`).join("") || `<p class="vacio">Sin mensajes.</p>`;

export function paginaChat({ tel, msgs, pausaHasta = 0, aviso = "" }) {
  const nombre = [...msgs].reverse().find((m) => m.nombre)?.nombre;
  const bot = pausaHasta
    ? `<p class="sub">⏸️ Bot en pausa hasta ${cuandoMsg(pausaHasta)}</p><form method="post" action="/bot"><input type="hidden" name="tel" value="${esc(tel)}"><input type="hidden" name="accion" value="reactivar"><button class="chico">Reactivar bot</button></form>`
    : `<p class="sub">🤖 El bot está atendiendo este chat</p><form method="post" action="/bot"><input type="hidden" name="tel" value="${esc(tel)}"><input type="hidden" name="accion" value="pausar"><button class="chico">Pausar bot</button></form>`;
  return marco({ titulo: nombre || `+${tel}`, sub: `+${tel}`, tab: "chats", cuerpo:
    `${aviso ? `<p class="flash">${esc(aviso)}</p>` : ""}<section class="card"><div class="fila" style="border:0;padding-top:0">${bot}</div>
<div class="msgs" id="msgs">${burbujas(msgs)}</div>
<form class="responder" method="post" action="/responder" onsubmit="this.querySelector('button').disabled=true"><input type="hidden" name="tel" value="${esc(tel)}">
<textarea name="texto" rows="2" required placeholder="Escribí una respuesta…" aria-label="Respuesta"></textarea><button>Enviar</button></form>
<p class="sub">Sale desde el WhatsApp del consultorio y el bot se pausa en este chat.</p></section>
<script>const m=document.getElementById("msgs");m.scrollTop=m.scrollHeight;
let ult="";setInterval(async()=>{try{const r=await fetch("/chat/msgs?tel=${esc(tel)}");if(!r.ok)return;const h=await r.text();if(h!==ult){ult=h;const abajo=m.scrollHeight-m.scrollTop-m.clientHeight<60;m.innerHTML=h;if(abajo)m.scrollTop=m.scrollHeight;}}catch{}},5000);</script>` });
}

// enviar(fecha) arranca el envío y devuelve el aviso para mostrar.
// responder(tel, texto) manda un WhatsApp desde el número del consultorio (lo da index.js).
export function servir({ puerto, enviar, responder }) {
  let aviso = "";
  const fechaOk = (f) => (/^\d{4}-\d\d-\d\d$/.test(f || "") ? f : null);
  const telOk = (t) => (/^\d{8,15}$/.test(t || "") ? t : null);
  return http.createServer(async (req, res) => {
    // Solo desde esta PC o por Tailscale (PANEL_HOSTS, ej. el nombre .ts.net de la PC con `tailscale serve`):
    // otro Host (DNS rebinding) u otro Origin (una web abierta en el navegador) no entra.
    const hosts = [`127.0.0.1:${puerto}`, `localhost:${puerto}`, ...(env("PANEL_HOSTS") || "").split(",").map((h) => h.trim()).filter(Boolean)];
    if (!hosts.includes(req.headers.host)) return res.writeHead(403).end();
    try {
      const u = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "POST") {
        if (req.headers.origin !== `http://${req.headers.host}`) return res.writeHead(403).end();
        let body = "";
        for await (const c of req) body += c;
        const datos = new URLSearchParams(body);
        if (u.pathname === "/listo") { avisos.listo(datos.get("id")); return res.writeHead(303, { Location: `/?fecha=${fechaOk(datos.get("fecha")) || ""}` }).end(); }
        const tel = telOk(datos.get("tel"));
        if (u.pathname === "/responder") {
          const texto = (datos.get("texto") || "").trim();
          if (!tel || !texto) return res.writeHead(400).end();
          try {
            await responder(tel, texto, req.headers["tailscale-user-login"] || null);
            estado.pausar(tel, cfg.pausaHoras); // respondió una persona: el bot se calla, como cuando escribe desde el celular
            avisos.listoDe(tel);
          } catch (e) { console.error("panel responder:", e.message); aviso = `No se pudo mandar: ${e.message}`; }
          return res.writeHead(303, { Location: `/chat?tel=${tel}` }).end();
        }
        if (u.pathname === "/bot") {
          if (!tel) return res.writeHead(400).end();
          if (datos.get("accion") === "reactivar") estado.despausar(tel); else estado.pausar(tel, cfg.pausaHoras);
          return res.writeHead(303, { Location: `/chat?tel=${tel}` }).end();
        }
        if (u.pathname !== "/enviar") return res.writeHead(404).end();
        const fecha = fechaOk(datos.get("fecha"));
        if (!fecha) return res.writeHead(400).end();
        aviso = await enviar(fecha);
        return res.writeHead(303, { Location: `/?fecha=${fecha}` }).end();
      }
      const html = (cuerpo) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(cuerpo); aviso = ""; };
      if (u.pathname === "/chats") return html(paginaChats({ lista: bandeja.chats(), aviso }));
      if (u.pathname === "/chat" || u.pathname === "/chat/msgs") {
        const tel = telOk(u.searchParams.get("tel"));
        if (!tel) return res.writeHead(400).end();
        const msgs = bandeja.mensajes(tel);
        if (u.pathname === "/chat/msgs") return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(burbujas(msgs));
        return html(paginaChat({ tel, msgs, pausaHasta: estado.pausaHasta(tel), aviso }));
      }
      if (u.pathname !== "/") return res.writeHead(404).end();
      const fecha = fechaOk(u.searchParams.get("fecha")) || proximoDia();
      // Si el Calendar falla, la página igual sale (con los avisos y el refresco automático).
      let turnos = [];
      try { turnos = await agenda.turnosDelDia(fecha); } catch (e) { console.error("panel:", e.message); aviso ||= "No pude leer el Calendar. Reintento en 1 minuto."; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(pagina({ fecha, turnos, aviso, alertas: avisos.pendientes() }));
      aviso = "";
    } catch (e) {
      console.error("panel:", e.message);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Error: " + e.message);
    }
  }).on("error", (e) => console.error("panel:", e.message)) // puerto ocupado: sin panel, pero el bot sigue
    .listen(puerto, "127.0.0.1", () => console.log(`Recordatorios: http://127.0.0.1:${puerto}`));
}
