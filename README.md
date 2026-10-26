# turnos-medico-baileys

Bot que agenda turnos por el **WhatsApp Business del consultorio**, conectado como dispositivo vinculado (como WhatsApp Web) con [Baileys](https://github.com/WhiskeySockets/Baileys). El celular sigue funcionando igual: la secretaria ve todos los chats y puede contestar.

- **Dos sedes:** Sede Centro (mar y jue 8 a 16) y Sede Norte (mié y vie 9 a 14), turnos de 45 min (`SEDES` y `TURNO_MIN` en `.env`). El evento lleva la sede en el título y en "ubicación".
- **Agenda = Google Calendar.** El doc ve los turnos en la app de Calendar. Para bloquear horarios (vacaciones, congreso), crea cualquier evento: todo evento cuenta como ocupado, también los de día completo.
- **Menú numerado, sin IA** (`lib/arbol.js`): sacar turno (motivo → sede → día → horario → nombre y DNI → confirmar), ver o cancelar, u "otra consulta" (pasa a la secretaria). Responde al instante, no cuesta nada y ningún mensaje sale a terceros. Los motivos son los mismos de la doctora (`MOTIVOS` en `.env`).
- **El bot confirma solo.** Los horarios salen del calendario (`lib/slots.js`) y `reservar` lo vuelve a chequear justo antes de guardar. Máximo un turno futuro por teléfono; solo se cancela lo que reservó ese mismo teléfono. El evento lleva nombre, DNI, motivo y teléfono.
- **Si no entiende, no insiste:** una respuesta que no es una opción se pide una vez más; la segunda pasa el chat a la secretaria. "0" vuelve al menú. Después de terminar, un "gracias" no dispara el menú de nuevo. Urgencias: 107.
- **Recordatorios con 3 clics** (`lib/panel.js`): la secretaria abre el acceso directo "Recordatorios" (una página en la PC, `http://127.0.0.1:3000`, solo accesible desde esa PC), ve los turnos del próximo día de consultorio, toca **Enviar recordatorios** y **Aceptar**. El bot manda a cada paciente "Te recordamos que el martes 27/10 a las 10:30 tenés turno con la Dra. … ¿Nos confirmás tu asistencia? 1) Sí, voy 2) No puedo ir", de a uno, con 20 a 45 s entre mensajes. Si responde 1, el turno queda con ✅ en el título del Calendar; si responde 2 (y lo confirma), se cancela y el horario se libera (el evento se borra: no queda rastro de que se canceló). La respuesta vale hasta la hora del turno, aunque se mande el viernes para el martes. La página muestra quién confirmó. Un turno no recibe dos veces el recordatorio. Turnos cargados a mano: el bot toma el teléfono que esté escrito en el título o la descripción (ej. "Tel 261 555-1234"); sin teléfono aparece "⚠️ sin teléfono". El texto está en `lib/arbol.js` (`recordatorio`). Solo con el menú (no con `MODO=ia`).
- **IA opcional** (`MODO=ia`, `lib/ia.js`): con cualquier API compatible con OpenAI (Google AI Studio, OpenCode, DeepSeek, Ollama local). No se usa por defecto.
- **Convive con la secretaria.** Si alguien escribe desde el celular en un chat, el bot se calla ahí `PAUSA_HORAS` (12 h por defecto). Audios, fotos, grupos y mensajes atrasados (más de 10 min, por ejemplo al prender la PC) no los toca.
- **No molesta al celular:** no aparece "en línea" (eso cortaría las notificaciones del teléfono) y no marca nada como leído.
- **Datos:** el estado de cada chat (`chats.json`) se borra a las 24 h. El evento lleva nombre, DNI, motivo y teléfono (no datos de salud). No usa PAMI.
- Candados: `BOT_ACTIVO` (0 = solo muestra lo que haría) y `BOT_SOLO_TELEFONOS`.

Variante oficial (WhatsApp Cloud API + Supabase), sin usar: `~/Proyectos/turnos-medico`.

## Riesgos

- **No es oficial.** WhatsApp puede bloquear el número del consultorio. Para bajar el riesgo: el bot responde con demora tipo humana y poco volumen.
- **Los recordatorios son lo más riesgoso:** mandar el primer mensaje a un número que nunca le escribió al consultorio es lo que más dispara bloqueos (los turnos cargados a mano son justamente eso). Empezar con pocos por día, o solo con pacientes que ya chatearon, y mirar cómo va. Si un paciente marca el mensaje como spam, suma en contra.
- **Solo con `MODO=ia`:** todo mensaje 1 a 1 que llegue al consultorio pasa por la IA, incluidos los que hablan de síntomas. El doc tendría que estar de acuerdo y avisarlo a los pacientes.
- **Planes gratis de IA:** el gratuito de Google AI Studio (y algunos modelos gratis de otros proveedores) puede usar lo que se le manda para mejorar sus productos, con revisión humana. Para probar con tu número alcanza; para pacientes reales, usar un plan pago que no use los datos (revisar los términos vigentes).
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
8. **Que arranque solo y se levante si se cae:** crear `C:\turnos\iniciar.bat` con:
   ```
   :a
   node C:\turnos\index.js
   timeout /t 10
   goto a
   ```
   y un acceso directo a ese .bat en la carpeta de inicio (`Win+R` → `shell:startup`). Ojo: eso corre recién cuando alguien inicia sesión en Windows. El QR ya no hace falta: usa la sesión guardada.
9. **Acceso directo para la secretaria:** en el escritorio, clic derecho → Nuevo → Acceso directo → `http://127.0.0.1:3000` → nombre "Recordatorios".

## Primera prueba real: qué mirar

- Después de que el bot responda, ¿al celular de la secretaria le siguen llegando notificaciones? Si no, avisame (se sacan los avisos de "escribiendo…").
- ¿El mensaje de bienvenida/ausencia de WhatsApp Business pausa al bot? (en la terminal aparece "secretaria escribió en …").
- La pausa solo cuenta lo que la secretaria escribió con el bot conectado: el primer día el bot puede meterse en charlas que ella ya venía teniendo.

`npm test` corre los tests (sin red).
