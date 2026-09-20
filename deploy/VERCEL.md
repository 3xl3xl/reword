# Vercel + Neon deployment

The Vercel entry point is `src/app.ts`, an exported Express application with no listener or filesystem database. Vercel hosts Express as a Function: [official deployment guide](https://vercel.com/docs/frameworks/backend/express). `npm run dev` and Docker still use the local SQLite entry point. Do not deploy the Docker Compose setup to Vercel.

## Account steps

1. Sign in to GitHub CLI with `gh auth login -h github.com` if uploading from your terminal. The account `3xl3xl` was verified during setup; sandbox restrictions may require running GitHub CLI with network/keychain access. Do not paste its token into this conversation.
2. Create a private GitHub repository named `reword` and upload this project's code. Keep `.env`, databases, and deployment credentials out of Git; the ignore rules cover these files.
3. In Vercel, select **New Project**, import that repository, choose the Express preset if not detected, and keep `npm run build` as the build command. Node 22 is supported by this codebase; choose Node 22 in project settings.
4. Connect [Neon through Vercel Marketplace](https://vercel.com/marketplace/neon/neon). Use its pooled Postgres connection URL as `DATABASE_URL`. Retain the provider's TLS connection parameters. Review the selected plan before provisioning.
5. Establish a stable public project URL such as `https://YOUR-PROJECT.vercel.app`. Configure your OAuth provider for that resource's `/mcp` URL and the `reword` scope. The provider must emit the access-token format documented in the main README.

A first deployment without environment variables returns a generic 503 and exposes no data. This allows a project URL to be assigned before OAuth setup. Login and consent still require an actual OAuth provider; GitHub repository access and a Vercel account do not supply that automatically.

## Environment variables

Set these on the Vercel project's **Production** environment:

```dotenv
DATABASE_URL=postgresql://...provider-supplied-pooled-url...
OAUTH_ISSUER=https://YOUR-IDENTITY-PROVIDER/
OAUTH_JWKS_URL=https://YOUR-IDENTITY-PROVIDER/keys
OAUTH_RESOURCE_URL=https://YOUR-PROJECT.vercel.app/mcp
```

`ALLOWED_HOSTS` defaults to the host in `OAUTH_RESOURCE_URL`; set an explicit comma-separated list only if serving additional domains. Do not set `REWORD_API_TOKEN` for this entry point. Never expose `DATABASE_URL` using a public/client-side environment variable prefix.

Do not copy production credentials into untrusted preview deployments. Previews need their own database and issuer/resource configuration to work; otherwise they should remain unconfigured. For an externally connected MCP client, Vercel deployment protection must allow requests to the production endpoint; the application's OAuth middleware must remain enabled.

## Initialize the database

The app does not run schema migrations during requests or builds. From a trusted local terminal, put the provider's connection URL into the ignored `.env` file as `DATABASE_URL`, then run:

```sh
npm run db:migrate
```

Alternatively, run the compiled `dist/migrate.js` in a trusted deployment job with `DATABASE_URL` injected. Migration is additive and idempotent; it uses a database transaction and advisory lock. The database role must be permitted to create the `reword_accounts` table. Redeploy after setting your environment variables.

## Verify

Run the read-only smoke check with a short-lived access token obtained from the chosen provider:

```sh
read -r -s REWORD_SMOKE_TOKEN
export REWORD_SMOKE_TOKEN
npm run smoke -- https://YOUR-PROJECT.vercel.app/mcp
unset REWORD_SMOKE_TOKEN
```

Then complete a real client login/consent flow, save an expression, and confirm it survives a redeployment. Repeat with a second account to verify isolation. Automated local tests do not establish live Vercel, Neon, or OAuth-provider connectivity.

## Storage design and limits

Each authenticated user has one versioned JSONB learning-state document in Postgres. A write inserts the account if needed, locks that user's row with `SELECT ... FOR UPDATE`, runs the existing learning service, and commits the state atomically. Different users have independent rows; retries and concurrent writes for the same user serialize. Reads retrieve one committed snapshot. Connections are checked out for a complete transaction and always released.

This keeps the V1 learning rules shared with SQLite without duplicating scheduling logic. It loads the user's vocabulary and history for each operation and rewrites that user's document on changes; it is suited to small personal collections, not high-volume analytics or unbounded event histories. Move to normalized Postgres item/event tables before those workloads grow. The PGlite tests exercise actual Postgres SQL, but use one connection and do not prove multi-process Neon concurrency or pooled-network behavior.

Existing SQLite data is not automatically uploaded or reassigned to OAuth identities. An explicit import is separate work. Use Neon's backup/recovery facilities for the hosted database; the Docker volume backup recipe applies only to SQLite deployments.
