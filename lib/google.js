// Token de Google con una cuenta de servicio (sin librerías): JWT RS256 firmado con
// WebCrypto y canjeado en oauth2. Secret GOOGLE_SA_JSON = el JSON de la clave completo.

import { env } from "./env.js";

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlTexto = (s) => b64url(new TextEncoder().encode(s));

export async function importarClave(pem) {
  // Si el secret se cargó con "\n" literales, se arreglan acá.
  const cuerpo = pem.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(cuerpo), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

export async function jwt(sa, scope, ahoraSeg = Math.floor(Date.now() / 1000)) {
  const datos = `${b64urlTexto(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64urlTexto(JSON.stringify({
    iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: ahoraSeg, exp: ahoraSeg + 3600,
  }))}`;
  const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await importarClave(sa.private_key), new TextEncoder().encode(datos));
  return `${datos}.${b64url(firma)}`;
}

let cache = { token: null, vence: 0 };
export async function token() {
  if (cache.token && Date.now() < cache.vence) return cache.token;
  const sa = JSON.parse(env("GOOGLE_SA_JSON"));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await jwt(sa, "https://www.googleapis.com/auth/calendar") }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Google token ${r.status}: ${await r.text()}`);
  cache = { token: (await r.json()).access_token, vence: Date.now() + 55 * 60e3 };
  return cache.token;
}
