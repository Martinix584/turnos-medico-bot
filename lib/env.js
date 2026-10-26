// Deno (Supabase) o Node (tests).
export const env = (k) => globalThis.Deno?.env.get(k) ?? globalThis.process?.env[k];
