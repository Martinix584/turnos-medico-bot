# turnos-medico-baileys

Bot que agenda turnos por el **WhatsApp Business del consultorio**, conectado como dispositivo vinculado (como WhatsApp Web) con [Baileys](https://github.com/WhiskeySockets/Baileys). El celular sigue funcionando igual: la secretaria ve todos los chats y puede contestar.

- **Dos sedes** con horarios en `SEDES` (rangos como `"09:00-13:00"` u horas sueltas como `"08:30"` para horarios irregulares) y duración en `TURNO_MIN`, en `.env`. A qué sede va cada motivo: `SEDE_CLINICA` y `SEDE_ESTUDIOS` (el bot no arranca si no coinciden con `SEDES`). El evento lleva la sede en el título y en "ubicación".
- **Agenda = Google Calendar.** El doc ve los turnos en la app de Calendar. Para bloquear horarios (vacaciones, congreso), crea cualquier evento: todo evento cuenta como ocupado, también los de día completo.
- **Menú numerado = motor principal, sin IA** (`lib/arbol.js`): 1) Control clínico, 2) Control de estudios, 3) Derivación, 4) Empadronamiento por diabetes, 5) Recetas PAMI, 6) Ver o cancelar mi turno. Las opciones 1, 2 y 4 recorren día → horario → nombre y DNI → confirmar, y la **sede la define la opción** (el paciente no la elige). 3 y 5 solo informan. Responde al instante y no cuesta nada. "0" vuelve al menú en cualquier paso.
- **El bot confirma solo.** Los horarios salen del calendario (`lib/slots.js`) y `reservar` lo vuelve a chequear justo antes de guardar. Máximo un turno futuro por teléfono; solo se cancela lo que reservó ese mismo teléfono. El evento lleva nombre, DNI, motivo y teléfono.
- **Si el menú no entiende, entra la IA sin avisar:** texto libre en el menú, o la segunda respuesta inválida dentro de un paso. El paciente no ve ningún cambio; la IA conduce ese chat hasta que deriva a la secretaria, el paciente escribe "0" o "menú", o pasan 30 min sin mensajes (`IA_MIN`). La IA recibe lo último que mostró el menú y lo ya elegido (motivo, turno), así sigue la charla. Si la IA deriva, el bot se calla en ese chat; un "gracias" u "ok" solo no se responde (no pausa el chat). Urgencias: 107. Si la IA o Google Calendar fallan, al paciente no se le contesta nada: el chat queda en pausa y aparece un aviso arriba en el panel de recordatorios (`http://127.0.0.1:3000`, se refresca solo y la pestaña muestra cuántos hay) con un link para abrir el chat y un botón "Listo". Los avisos se guardan en `avisos.json` y se borran a los 7 días.
- **Recordatorios con 3 clics** (`lib/panel.js`): la secretaria abre el acceso directo "Recordatorios" (una página en la PC, `http://127.0.0.1:3000`, solo accesible desde esa PC), ve los turnos del próximo día de consultorio, toca **Enviar recordatorios** y **Aceptar**. El bot manda a cada paciente "Te recordamos que el martes 27/10 a las 10:30 tenés turno con la Dra. … ¿Nos confirmás tu asistencia? 1) Sí, voy 2) No puedo ir", de a uno, con 20 a 45 s entre mensajes. Si responde 1, el turno queda con ✅ en el título del Calendar; si responde 2 (y lo confirma), se cancela y el horario se libera (el evento se borra: no queda rastro de que se canceló). La respuesta vale hasta la hora del turno, aunque se mande el viernes para el martes. La página muestra quién confirmó. Un turno no recibe dos veces el recordatorio. Turnos cargados a mano: el bot toma el teléfono que esté escrito en el título o la descripción (ej. "Tel 261 555-1234"); sin teléfono aparece "⚠️ sin teléfono". El texto está en `lib/arbol.js` (`recordatorio`). Si responde algo que no es 1 ni 2 dos veces, pasa a la secretaria (no a la IA). **Automático:** con `RECORDAR_HORA=16` en `.env`, el día anterior desde las 16 (hasta las 21) el bot lo manda solo a los turnos que sacó el paciente por el bot, salteando los chats que la secretaria tiene en pausa; los cargados a mano siguen con el botón.
- **Chats en el panel** (`lib/bandeja.js`, pestaña "Chats"): se ven las conversaciones del número (pacientes, bot, celular de la secretaria y panel) y se puede responder desde ahí: sale por el WhatsApp del consultorio y el bot se pausa en ese chat (botón "Reactivar bot" para devolvérselo). Se guardan desde que se instaló esto, en `bandeja.db` (SQLite de Node), y se borran a los `BANDEJA_DIAS` (90 por defecto). Audios, fotos y documentos aparecen como etiqueta ("🎤 audio"): se ven en el celular. Son datos de salud: el panel solo se abre desde la PC o por Tailscale.
- **IA de respaldo** (`lib/ia.js`): con cualquier API compatible con OpenAI (Google AI Studio, OpenCode, DeepSeek, Ollama local; `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`). Aplica las mismas reglas que el menú: el modelo solo clasifica el motivo; **la sede y el cupo los decide el código** (`lib/reglas.js`), el paciente no elige sede:
  - Control clínico → `SEDE_CLINICA`, máx. **60% de los turnos del mes calendario** de esa sede. Si se llena, ofrece los del mes siguiente (nunca usa el resto). "No sé si necesito análisis" comparte ese cupo, para que la IA no lo saltee clasificando un control como "no sabe" (sí podría clasificarlo como empadronamiento, que no tiene cupo; tampoco cuentan los turnos cargados a mano).
  - Control de estudios → `SEDE_ESTUDIOS`. Empadronamiento → `SEDE_CLINICA`, sin cupo: próximo día libre.
  - Derivación y recetas PAMI: solo informa (correo `MAIL_RECETAS`, máx. 2 derivaciones por mes, recetas en 7 días, $10.000 por WhatsApp), no agenda. Sobreturno y todo lo demás se deriva a la secretaria.
  - Pide nombre/s, apellido/s y DNI. El motivo queda en el evento (`extendedProperties.private.motivo`) y es lo que se cuenta para el cupo; los turnos viejos sin motivo no cuentan.
  - El cupo se calcula sobre los turnos teóricos del mes (no resta bloqueos de la doctora).
- **Convive con la secretaria.** Si alguien escribe desde el celular en un chat, el bot se calla ahí `PAUSA_HORAS` (12 h por defecto). Audios, fotos, grupos y mensajes atrasados (más de 10 min, por ejemplo al prender la PC) no los toca.
- **No molesta al celular:** no aparece "en línea" (eso cortaría las notificaciones del teléfono) y no marca nada como leído.
- **Datos:** el estado de cada chat (`chats.json`) se borra a las 24 h. El evento lleva nombre, DNI, motivo y teléfono (no datos de salud). Todavía no consulta PAMI (idea futura: usar `~/Proyectos/botmedico` para deducir el motivo; los diagnósticos no deberían ir al modelo).
- Candados: `BOT_ACTIVO` (0 = solo muestra lo que haría) y `BOT_SOLO_TELEFONOS`.

Variante oficial (WhatsApp Cloud API + Supabase), sin usar: `~/Proyectos/turnos-medico`.

## Riesgos

- **No es oficial.** WhatsApp puede bloquear el número del consultorio. Para bajar el riesgo: el bot responde con demora tipo humana y poco volumen.
- **Los recordatorios son lo más riesgoso:** mandar el primer mensaje a un número que nunca le escribió al consultorio es lo que más dispara bloqueos (los turnos cargados a mano son justamente eso). Empezar con pocos por día, o solo con pacientes que ya chatearon, y mirar cómo va. Si un paciente marca el mensaje como spam, suma en contra.
- **IA de respaldo:** solo recibe los mensajes que el menú no entendió (pueden incluir síntomas) y el paciente no sabe que interviene. El doc tiene que estar de acuerdo y avisarlo a los pacientes. Se pide DNI por WhatsApp.
- **Plan de IA:** se usa el plan **pago** de Google (no usa los datos para mejorar sus productos; revisar los términos vigentes). No cambiar a un plan gratis (Google AI Studio gratuito u otros): puede usar lo que se le manda, con revisión humana.
- **Mensajes automáticos de WhatsApp Business** (bienvenida, ausencia) salen "desde el número" y el bot puede tomarlos como que escribió la secretaria y pausarse. Si pasa en la prueba, hay que desactivarlos (Herramientas para la empresa → Mensaje de bienvenida / ausencia).
- Si el celular pasa ~14 días sin internet, WhatsApp desvincula los dispositivos y hay que volver a escanear el QR.
- Máximo 4 dispositivos vinculados por número (WhatsApp Web, la PC, botmedico si corre en el mismo número, etc.).

## Instalar en la PC del consultorio (Windows)

1. Instalar **Node.js 22 o más nuevo** (nodejs.org, versión LTS).
2. Completar el `.env` **en esta máquina** (Linux): `cp .env.example .env`, y para la clave de Google seguir [GOOGLE.md](GOOGLE.md). Dejar `BOT_ACTIVO=0` y `BOT_SOLO_TELEFONOS=<tu celular>`.
3. Copiar esta carpeta **con el `.env`** (sin `node_modules` ni `auth`) a la PC, por ejemplo a `C:\turnos`.
4. En esa carpeta, abrir una terminal y correr `npm install`.
5. `npm start`. Aparece un QR: en el celular del consultorio, WhatsApp Business → Dispositivos vinculados → Vincular un dispositivo → escanear. La sesión queda en `auth\` (es el acceso al WhatsApp del consultorio: no copiarla ni compartirla).
6. Escribirle al consultorio desde tu celular y mirar en la terminal lo que el bot habría contestado. Cuando esté bien: `BOT_ACTIVO=1`, reiniciar, probar de verdad. Al final, sacar `BOT_SOLO_TELEFONOS`.
7. **Que no se apague:** Configuración → Sistema → Energía → Suspender: **Nunca**.
8. **Que arranque solo y se levante si se cae:** `iniciar-bot.ps1` (en el repo) corre `npm start` en bucle, guarda la salida en `bot.log` y reinicia a los 10 s si se cae. Acceso directo en la carpeta de inicio (`Win+R` → `shell:startup`) con destino `powershell -NoExit -ExecutionPolicy Bypass -File C:\turnos\iniciar-bot.ps1`. Ojo: corre recién cuando alguien inicia sesión en Windows. El QR ya no hace falta: usa la sesión guardada.
9. **Panel desde el celular (opcional, por Tailscale):** en la PC, `tailscale serve --bg --http=80 3000` y en `.env` `PANEL_HOSTS=<pc>.<tuRed>.ts.net,<pc>`. Se abre en `http://<pc>.<tuRed>.ts.net` solo desde dispositivos de tu red de Tailscale; a otras personas se les comparte la PC desde la consola de Tailscale (Machines → Share) y entran con su propia cuenta. Ojo: compartida la PC, ven también sus otros puertos abiertos.
10. **Acceso directo para la secretaria:** en el escritorio, clic derecho → Nuevo → Acceso directo → `http://127.0.0.1:3000` → nombre "Recordatorios".

## Primera prueba real: qué mirar

- Después de que el bot responda, ¿al celular de la secretaria le siguen llegando notificaciones? Si no, avisame (se sacan los avisos de "escribiendo…").
- ¿El mensaje de bienvenida/ausencia de WhatsApp Business pausa al bot? (en la terminal aparece "secretaria escribió en …").
- La pausa solo cuenta lo que la secretaria escribió con el bot conectado: el primer día el bot puede meterse en charlas que ella ya venía teniendo.

`npm test` corre los tests (sin red).
