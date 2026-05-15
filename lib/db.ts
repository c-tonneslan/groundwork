// Single Postgres pool shared across Next.js API routes. The Vercel
// runtime can spin up many lambda instances, each of which keeps its
// own pool — that's fine for our scale, and `pg`'s pool gracefully
// reuses connections across handler invocations.

import { Pool } from "pg";

// Hot-module-reloading in dev would otherwise create a new pool every
// edit. Stash on globalThis so we keep exactly one.
const globalForPool = globalThis as unknown as { _gwPool?: Pool };

export const db = (() => {
  if (globalForPool._gwPool) return globalForPool._gwPool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Don't throw at import time: build/SSR may not have it set, and the
    // API route will surface the missing-config error to the client.
    return null as unknown as Pool;
  }
  const pool = new Pool({
    connectionString: url,
    // Supabase TLS uses their own CA; relax verification for that host.
    ssl: url.includes("supabase.co") ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  globalForPool._gwPool = pool;
  return pool;
})();

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
