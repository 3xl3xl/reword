import { OpenAISpeechProvider } from "./features/audio/speech.js";
import { SqliteRepository } from "./storage/sqlite.js";
import { LearningService } from "./service.js";
import { createOAuth } from "./auth.js";
import { createApp } from "./http.js";
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be 1–65535");
const host = process.env.HOST ?? "127.0.0.1";
const token = process.env.REWORD_API_TOKEN;
const oauthValues = [
  process.env.OAUTH_ISSUER,
  process.env.OAUTH_RESOURCE_URL,
  process.env.OAUTH_JWKS_URL,
];
if (oauthValues.some(Boolean) && !oauthValues.every(Boolean))
  throw new Error(
    "Set all three OAUTH_ISSUER, OAUTH_RESOURCE_URL, OAUTH_JWKS_URL values.",
  );
const oauth = oauthValues.every(Boolean)
  ? createOAuth({
      issuer: oauthValues[0]!,
      resource: oauthValues[1]!,
      jwksUrl: oauthValues[2]!,
    })
  : undefined;
if (oauth && token)
  throw new Error("Choose OAuth or the single-user bearer token, not both.");
if (
  (host !== "127.0.0.1" && host !== "localhost") ||
  process.env.NODE_ENV === "production"
) {
  if (!oauth && (!token || token.length < 32))
    throw new Error(
      "Non-local/production serving requires OAuth or REWORD_API_TOKEN with at least 32 characters",
    );
}
const repo = new SqliteRepository(
  process.env.DATABASE_PATH ?? "./data/reword.db",
);
const allowedHosts = (
  process.env.ALLOWED_HOSTS ?? `localhost:${port},127.0.0.1:${port}`
)
  .split(",")
  .map((s) => s.trim());
const app = createApp(new LearningService(repo), {
  token,
  oauth,
  serviceForOwner: (owner) => new LearningService(repo.forUser(owner)),
  speech: process.env.OPENAI_API_KEY
    ? new OpenAISpeechProvider(
        process.env.OPENAI_API_KEY,
        process.env.OPENAI_TTS_VOICE,
      )
    : undefined,
  allowedHosts,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .filter(Boolean),
});
const server = app.listen(port, host, () =>
  console.log(`RE:WORD listening on ${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(() => {
      repo.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
