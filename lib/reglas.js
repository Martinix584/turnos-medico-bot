// Reglas de asignación de sede: las decide el código, nunca el modelo.
// Las sedes salen de SEDE_CLINICA y SEDE_ESTUDIOS en .env y tienen que coincidir con SEDES
// (index.js lo valida al arrancar).

import { cfg } from "./config.js";

// Control clínico: casi seguro termina pidiendo estudios, va a la sede clínica y no puede ocupar
// más del 60% de sus turnos de cada mes calendario. Si se llena, el mes siguiente.
// "no_sabe" comparte ese cupo: si no, la IA podría saltearlo clasificando un control como no_sabe.
export const CUPO_CLINICO = 0.6;

// La sede se lee del .env al usarse (getter), no al importar.
const ruta = (sede, nombre, cupo = false) => ({ get sede() { return cfg[sede]; }, nombre, cupo });

export const RUTAS = {
  clinico: ruta("sedeClinica", "Control clínico", true),
  estudios: ruta("sedeEstudios", "Control de estudios"),
  empadronamiento: ruta("sedeClinica", "Empadronamiento por diabetes"),
  no_sabe: ruta("sedeClinica", "Consulta (no sabe si necesita análisis)", true), // por defecto: sede clínica
};

export const MOTIVOS_IA = Object.keys(RUTAS);
export const MOTIVOS_CUPO = MOTIVOS_IA.filter((k) => RUTAS[k].cupo);
