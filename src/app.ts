import express from "express";
import { Pool } from "pg";
import { createApp } from "./http.js";
import { createOAuth } from "./auth.js";
import { PostgresStore } from "./storage/postgres.js";
// Vercel entry point: no listen(), SQLite filesystem, or background tasks.
const app = express();
let configured: ReturnType<typeof createApp> | undefined;
function application() {
  if (configured) return configured;
  const {
    DATABASE_URL,
    OAUTH_ISSUER,
    OAUTH_RESOURCE_URL,
    OAUTH_JWKS_URL,
    ALLOWED_HOSTS,
  } = process.env;
  if (!DATABASE_URL || !OAUTH_ISSUER || !OAUTH_RESOURCE_URL || !OAUTH_JWKS_URL)
    throw new Error(
      "Configure DATABASE_URL and all OAuth settings before deploying.",
    );
  if (process.env.REWORD_API_TOKEN)
    throw new Error("Vercel deployment requires OAuth, not a shared token.");
  const oauth = createOAuth({
    issuer: OAUTH_ISSUER,
    resource: OAUTH_RESOURCE_URL,
    jwksUrl: OAUTH_JWKS_URL,
  });
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    allowExitOnIdle: true,
  });
  pool.on("error", () => console.error("Postgres connection error"));
  const store = new PostgresStore(pool);
  configured = createApp(store.forUser("local"), {
    oauth,
    allowedHosts: ALLOWED_HOSTS?.split(",").map((s) => s.trim()) ?? [
      new URL(OAUTH_RESOURCE_URL).host,
    ],
    serviceForOwner: (owner) => store.forUser(owner),
  });
  return configured;
}
app.use((req, res, next) => {
  try {
    application()(req, res, next);
  } catch {
    res.status(503).json({ error: "Service configuration unavailable" });
  }
});
export default app;
