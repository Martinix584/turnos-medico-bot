# Google Calendar

- **Proyecto:** `<PROYECTO>` (un proyecto de Google Cloud propio). Solo tiene habilitada la Google Calendar API, sin facturación.
- **Cuenta de servicio:** `bot-turnos@<PROYECTO>.iam.gserviceaccount.com`. Su clave está en `.env` (`GOOGLE_SA_JSON`). Es el acceso del bot al calendario: no compartirla.
- **Calendario:** "Turnos consultorio" (hora de Argentina). Lo creó la cuenta de servicio y está compartido con **el mail de la doctora como propietaria**. Su ID está en `.env` (`CALENDAR_ID`).

## Lo que hace la doctora

1. Aceptar la invitación al calendario que le llegó por mail (o en calendar.google.com, en "Otros calendarios").
2. Para bloquear días u horarios (vacaciones, congreso), crear cualquier evento **en ese calendario**, no en el personal.
3. Si quiere que la secretaria lo vea o lo edite, compartirlo desde la configuración del calendario.

## Si hay que cambiar la clave

```bash
gcloud iam service-accounts keys create clave.json --iam-account bot-turnos@<PROYECTO>.iam.gserviceaccount.com --project <PROYECTO>
```

Reemplazar `GOOGLE_SA_JSON` en `.env` con el contenido en una línea, entre comillas simples. Después borrar `clave.json` y la clave vieja (`gcloud iam service-accounts keys list/delete ...`).
