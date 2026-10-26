import { env } from "./env.js";

// normalizarTel: reutilizado de bot-sws/botmedico (teléfonos argentinos). Solo para
// comparar contra BOT_SOLO_TELEFONOS; ambos lados pasan por la misma función.
const soloDigitos = (t) => (t || "").replace(/\D/g, "");
export function normalizarTel(t) {
  let d = soloDigitos(t).replace(/^0+/, "");
  if (d.startsWith("54")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("9")) d = d.slice(1);
  d = d.replace(/^0/, "");
  if (d.length === 12) for (const area of [3, 4, 2]) if (d.slice(area, area + 2) === "15") { d = d.slice(0, area) + d.slice(area + 2); break; }
  if (d.length === 7) d = "261" + d;
  return d.length === 10 ? d : null;
}

// Prueba en vivo: si BOT_SOLO_TELEFONOS está definido, el bot ignora al resto.
export const habilitado = (tel) => {
  const solo = env("BOT_SOLO_TELEFONOS")?.split(",").map(normalizarTel).filter(Boolean);
  return !solo?.length || solo.includes(normalizarTel(tel));
};
