# HTTPS deployment

This Compose setup runs one RE:WORD process with persistent SQLite and a Caddy HTTPS proxy. The application has no published host port. Only ports 80 and 443 are public. The deployment is an OAuth resource server; your identity provider handles login and issues the access tokens described in the main README.

## Prerequisites

- A Docker host with Docker Compose v2 and inbound TCP 80/443.
- A domain whose DNS A/AAAA records point to this host. Remove incorrect AAAA records.
- An OAuth provider configured for the `https://YOUR_DOMAIN/mcp` resource and `reword` scope, emitting the documented `at+jwt` token format.
- Client registration and allowed redirect URLs configured for the intended MCP client at that provider. These values depend on the provider/client; no credentials are embedded here.

Caddy manages HTTPS certificates for the configured domain and forwards the original host to RE:WORD. See [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https) and [reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy). Certificate state and application data use separate named volumes. Compose waits for the app's health check before starting the proxy; see [Compose service configuration](https://docs.docker.com/reference/compose-file/services/).

## Configure and start

Run from the repository root:

```sh
cp deploy/production.env.example deploy/production.env
# Edit the new file with your real domain, email, issuer and JWKS URL.
docker compose --env-file deploy/production.env config --quiet
docker compose --env-file deploy/production.env up -d --build
docker compose --env-file deploy/production.env ps
```

`deploy/production.env` is ignored by Git and the Docker build context. The domain must have no scheme, port, or path. Compose derives the resource URL and allowed hosts from it. This recipe requires OAuth and does not expose the shared development bearer token mode.

The app runs as uid 1000 with a read-only root filesystem, a writable data volume and temporary directory. Do not scale it past one replica or place SQLite on network storage. The image tags track Node 22 and Caddy 2; pin tested digests in your production release process.

Docker/Caddy execution must be verified on the deployment host; these files are not evidence of a successful live deployment.

## Acceptance checks

First confirm `https://YOUR_DOMAIN/health` returns `{"status":"ok"}`. Then check `https://YOUR_DOMAIN/.well-known/oauth-protected-resource/mcp` and ensure the resource and issuer are correct. An unauthenticated POST to `/mcp` should return 401 with `resource_metadata` in the `WWW-Authenticate` header.

Obtain a short-lived access token through your provider's normal client login flow. Do not paste tokens into task messages or command arguments. In a terminal, read it without echoing:

```sh
read -r -s REWORD_SMOKE_TOKEN
export REWORD_SMOKE_TOKEN
npm run smoke -- https://YOUR_DOMAIN/mcp
unset REWORD_SMOKE_TOKEN
```

The smoke command checks health, authentication challenge, advertised metadata when present, MCP initialization, tool discovery, and an authenticated `get_stats`. It does not save items or record usage, and prints no private statistics or tokens. It rejects non-loopback HTTP and redirects. It does not automate login, verify PKCE, or establish that a particular ChatGPT account is connected.

After the smoke check, use the target MCP client to complete consent and save a test expression. Confirm it persists after an application restart, and that a second user cannot see it. Keep real conversation data out of logs. Caddy access logging is not enabled in this recipe.

## Update, backup and restore

Take a backup before an update. For a simple consistent backup, stop the application, archive the entire data volume through a one-off container, and restart it. The following creates a new uniquely named backup and does not remove the source volume:

```sh
mkdir -p backups
docker compose --env-file deploy/production.env stop reword
docker compose --env-file deploy/production.env run --rm --no-deps --user 0 --entrypoint sh -v "$PWD/backups:/backup" reword -c 'tar -czf "/backup/reword-$(date -u +%Y%m%dT%H%M%SZ).tgz" -C /app/data .'
docker compose --env-file deploy/production.env start reword
```

If the archive command fails, restart the app and investigate before updating. Backups contain every user's learning data; restrict their permissions and store an encrypted copy off-host. Never use `docker compose down -v` on a live deployment: it deletes persistent volumes.

Restore into a separate empty volume on a staging host first, preserving uid 1000 ownership. Point a single RE:WORD instance at that volume and verify health, record counts and user isolation. Production restore is a deliberate replacement operation; do not extract an archive over a running database. To roll back across schema changes, restore the pre-upgrade backup together with the matching application image.

Then update with `docker compose --env-file deploy/production.env up -d --build`, inspect health, and rerun the smoke check.
