// Configuración del consultorio. Sin defaults para datos reales: si falta algo, falla
// al usarse (no se inventan horarios ni teléfonos).

import { env } from "./env.js";
import { validarSedes } from "./slots.js";

const req = (k) => {
  const v = env(k);
  if (!v) throw new Error(`Falta la variable ${k} en .env`);
  return v;
};

export const cfg = {
  // [{"nombre":"Sede Centro","horarios":{"mar":["08:00-16:00"]}}, ...]
  get sedes() { return validarSedes(JSON.parse(req("SEDES"))); },
  get turnoMin() { return Number(req("TURNO_MIN")); },
  get calendarId() { return req("CALENDAR_ID"); },
  get consultorio() { return req("CONSULTORIO"); }, // cómo se presenta el bot, ej: "el consultorio de la Dra. X"
  get sedeClinica() { return req("SEDE_CLINICA"); }, // control clínico, empadronamiento y "no sabe" (nombre tal cual en SEDES)
  get sedeEstudios() { return req("SEDE_ESTUDIOS"); }, // control de estudios
  get mailRecetas() { return req("MAIL_RECETAS").split(",").map((m) => m.trim()).join(" o "); }, // correos para derivaciones y recetas PAMI, separados por coma
  get llm() { return { url: req("LLM_BASE_URL").replace(/\/$/, ""), key: req("LLM_API_KEY"), modelo: req("LLM_MODEL") }; },
  get dias() { return Number(env("DIAS_ADELANTE")) || 14; }, // cuántos días hacia adelante se ofrecen
  get pausaHoras() { return Number(env("PAUSA_HORAS")) || 12; }, // cuánto se calla el bot en un chat cuando escribe alguien del consultorio
};

export const activo = () => env("BOT_ACTIVO") === "1";
