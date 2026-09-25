# RE:WORD

**Don't study English outside the conversation. Turn the conversation itself into the study.**

A small English-learning MCP service with local and OAuth-authenticated modes: save → store → retrieve → reuse → record usage → update mastery → schedule reappearance. Ordinary conversation remains the primary learning surface; an optional connected practice workspace is available at `/learn/`.

## Product design and specification

The conversation-based product brief and detailed requirements are documented in [Product README](docs/product/README.md) and [PRODUCT_SPEC](docs/product/PRODUCT_SPEC.md). They cover Sentence Blocks, audio, drag-and-drop, Personal / Hard learning content, and scheduling requirements. These documents capture product intent; the implementation details below remain the reference for the current service.

## Learning workspace

Open **`/learn/`** on the running service for Saved Words, Daily Quiz and five-question Sentence Blocks. The workspace uses the same saved vocabulary, corrections, usage history and spaced repetition as the MCP tools. It supports persistent drafts, Personal / Hard lessons, tap and drag ordering, hints, selected-phrase audio, complete-sentence playback and a full-width Next.

Starter lessons are saved only after the user previews and chooses them. For conversation-based lessons, use `prepare_sentence_blocks` with five prompts and existing saved-item IDs. `get_sentence_blocks` and `answer_sentence_blocks` resume and update the same persisted session. [Implementation and validation details](docs/IMPLEMENTATION.md) describe the API, persistence and remaining extensions.

Locally, start the service and visit `http://127.0.0.1:3000/learn/`. Hosted users currently enter a RE:WORD bearer access token through **接続**; it is kept only in page memory. OpenAI TTS is optional: configure server-side `OPENAI_API_KEY` and `OPENAI_TTS_VOICE` (default `cedar`). Without it, the interface uses an available English device voice. No API key is sent to the browser.

Browser tests: `npx playwright install chromium` followed by `npm run test:ui`. They use a separate test database and synthetic audio stubs.

## Run locally

Requires Node.js 22.16+ and npm. Node 22's built-in SQLite emits an experimental warning; no native third-party database package is needed.

```sh
npm ci
cp .env.example .env
npm run dev
```

The default bind is loopback only. `GET http://127.0.0.1:3000/health` checks SQLite availability. The Streamable HTTP endpoint is `POST http://127.0.0.1:3000/mcp`. It requires an MCP client, including the protocol Accept headers; opening it in a browser returns 405.

```sh
npm run check  # formatting, production + test typechecking, tests, build
npm start      # runs the compiled build, loading .env if present
```

## Architecture

- `src/domain.ts`: pure, deterministic mastery and scheduling rules.
- `src/service.ts`: validated saving, relevance selection, atomic usage recording, and statistics. An injectable clock makes scheduling reproducible in tests.
- `src/storage/repository.ts`: synchronous storage boundary used by SQLite and in-memory learning snapshots.
- `src/learning-api.ts`: shared synchronous/asynchronous service contract for MCP.
- `src/storage/postgres.ts`: atomic per-user JSONB storage for hosted deployment.
- `src/storage/snapshot.ts`: in-memory repository used inside Postgres operations to reuse the learning rules.
- `src/app.ts`: Vercel Express entry point; requires hosted Postgres and OAuth.
- `src/storage/sqlite.ts`: SQLite persistence, automatic versioned schema initialization, WAL, unique normalized items, event history, and transactions.
- `src/mcp.ts`: MCP tool schemas, annotations, and conversation-first instructions.
- `src/auth.ts`: OAuth access-token validation, stable user identity, and protected resource metadata.
- `src/http.ts`: stateless Streamable HTTP, bounded request bodies, host/origin checks, optional bearer authentication, and health endpoint.
- `src/index.ts`: environment configuration and graceful shutdown.

Uses the published `@modelcontextprotocol/sdk` 1.30 release and its `registerTool` / `StreamableHTTPServerTransport` APIs. See the [official SDK server documentation](https://ts.sdk.modelcontextprotocol.io/server). Each HTTP request gets its own MCP server and transport; persistence lives in SQLite. GET streaming and DELETE sessions are intentionally unsupported in this stateless implementation.

SQLite stores typed item documents in JSON plus indexed identity columns, and immutable usage events in a separate table. This is intentionally small; retrieval scans the personal vocabulary collection. Large collections should move filtering and ranking into indexed queries. Schema version 2 scopes every item and usage event to an owner. Composite uniqueness and foreign keys prevent collisions and cross-user event references. All repository queries include the owner. Existing version 1 data migrates atomically to the `local` owner; it is never assigned automatically to a signing-in user. Request-scoped repositories share one SQLite connection; they do not accumulate connections per user.

## Tools and conversation behavior

| Tool                                | Purpose                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `save_word`, `save_expression`      | Save an explicitly requested item with meanings and original context                                     |
| `save_correction`                   | Save a natural version (`text`), mistake (`original_sentence`), explanation (`meaning_en`), and category |
| `get_learning_words`                | Paginated My Words, expressions, and corrections                                                         |
| `get_due_words`                     | Due items for explicitly requested practice                                                              |
| `get_words_for_conversation`        | At most three relevant due items; often none                                                             |
| `record_usage`                      | Record exposure, recognition, prompted or independent success, or incorrect usage                        |
| `review_words`                      | Inspect one item and its last 100 usage events                                                           |
| `get_learning_profile`, `get_stats` | Learning totals and conversation preferences                                                             |

Corrections are first-class learning items, so they use the same review and usage pipeline. Repeated incorrect attempts increase `failed_uses` and preserve their contexts in history. Saving an existing normalized item is idempotent and preserves its original metadata and progress. Use `update_learning_item` to edit wording, meanings, notes, context, or correction category without resetting progress. Renaming updates normalized identity and rejects duplicates. Editing is for fixing the same learning item; save a new item for a different concept. There is no delete tool yet.

The host model resolves “save that,” supplies meanings, assesses text usage, and decides whether a suggestion fits. The service does not run an LLM, monitor conversations, or automatically inject messages. MCP instructions tell the host to prioritize the discussion, avoid teaching interruptions in serious conversations, get consent for personal corrections, and never infer pronunciation quality from text. A connected host must actually call the tools for this loop to operate.

### Persisted quizzes

`start_quiz` creates up to three due questions with saved meanings, or resumes the current unfinished quiz. `get_quiz` reads the same state from another chat. `answer_quiz` stores a real user answer and its assessed outcome atomically with the learning event; identical retries cannot double-count progress and conflicting or out-of-order answers fail.

The server groups practice into 08:00 and 22:00 Asia/Tokyo slots. A completed quiz is not recreated in the same slot. An unfinished quiz carries over to the next slot. Only the current quiz is retained; learning events remain in item history. Questions snapshot the stored meaning and expected expression, so later vocabulary edits do not change an in-progress question. Items without meanings are skipped. The host must hide the grading answer until the user responds and must not fabricate answers.

State lives in the authenticated user's Postgres JSONB snapshot (or the local SQLite tenant quiz table), not in a chat session. These tools do not schedule jobs or send push notifications themselves: an independently configured ChatGPT scheduled task must call `start_quiz`, and delivery depends on ChatGPT and device notification settings.

### V1 scheduling

New items are immediately due, with mastery 0. Scores are clamped to 0–100.

| Event                   | Mastery | Next interval                                              |
| ----------------------- | ------- | ---------------------------------------------------------- |
| Exposure by assistant   | +0      | Unchanged                                                  |
| Recognition             | +3      | At least 6 hours; otherwise unchanged interval             |
| Prompted correct use    | +10     | Previous interval × 1.5, minimum 12 hours, maximum 30 days |
| Independent correct use | +20     | Previous interval × 2.5, minimum 24 hours, maximum 90 days |
| Incorrect use           | −25     | Previous interval ÷ 4, clamped to 1–6 hours                |

Successful/failed use counters exclude exposure and recognition. Learned means score ≥80 and at least five successful uses; learned items still return for maintenance. A failure can demote an item. A newly saved item that fails is scheduled one hour later; an already successful item returns sooner than its earned interval.

Conversation suggestions use exact Unicode keyword overlap against expression, meanings, notes, and context; this is a transparent heuristic, not semantic search. Tokens longer than two characters count. Only due items qualify, and recently seen items have a six-hour conversation cooldown. Retrieval itself never records exposure. Explicit practice via `get_due_words` bypasses the conversation cooldown.

`record_usage` requires a UUID `event_id` and nonempty observed context. Reuse that ID on retries: identical retries cannot increase mastery twice; conflicting reuse fails. Item update and event insertion commit together. A retry returns the item's current state. Different IDs represent different events; the host must avoid rewarding the same utterance under multiple IDs.

### Browsing personal corrections

`get_corrections` filters by `category`, case-insensitive `query`, `due_only`, and `recurring_only` (at least two recorded incorrect uses). It returns `items`, the filtered `total`, and `next_offset`. Recurring difficulty sorts first, followed by earliest review. Pagination applies after filtering. Both this tool and metadata editing preserve usage history and schedules.

## Deployment preparation

**Using Vercel?** Follow [Vercel + Neon setup](deploy/VERCEL.md). It uses the Postgres adapter and the exported Express entry point. The Docker instructions below are an alternative deployment path.

For a complete single-host recipe with HTTPS, health checks, persistent volumes, backup instructions, and a read-only acceptance check, see [deployment instructions](deploy/README.md).

This is ready for local use and deployment testing, not a finished public ChatGPT integration.

1. Build the image: `docker build -t reword .`.
2. Generate a secret, for example `openssl rand -hex 32`, and put it in a deployment environment file outside version control.
3. Set `REWORD_API_TOKEN` (minimum 32 characters), `ALLOWED_HOSTS` to the exact external hostname/port and any needed health-probe host, and `DATABASE_PATH=/app/data/reword.db`.
4. Run `docker run --rm --env-file .env.production -p 127.0.0.1:3000:3000 -v reword-data:/app/data reword`.
5. Put an HTTPS reverse proxy in front, preserving Host and forwarding Authorization. Do not expose unencrypted HTTP publicly. The image runs as a non-root user; mounted storage must be writable by uid 1000.

Non-loopback binding or `NODE_ENV=production` requires either complete OAuth configuration or a sufficiently long single-user token. Authenticated clients send `Authorization: Bearer <token>` on `/mcp`. `/health` returns no vocabulary and does not require authentication; host/origin checks still apply. Allowed browser origins are optional and explicitly listed in `ALLOWED_ORIGINS`; cross-origin browser CORS support is not implemented. Do not log authorization headers or conversation bodies at the proxy.

The static bearer token is a single-user development/private-deployment option. For per-user access, use OAuth mode below. HTTPS hosting, a domain, identity-provider configuration, and the eventual ChatGPT account connection require owner setup. Installing this repository does not make ChatGPT automatically discover or use it.

### OAuth resource-server mode

Set all three values and remove `REWORD_API_TOKEN`:

```dotenv
OAUTH_ISSUER=https://identity.example.com/
OAUTH_RESOURCE_URL=https://reword.example.com/mcp
OAUTH_JWKS_URL=https://identity.example.com/jwks
ALLOWED_HOSTS=reword.example.com,localhost:3000,127.0.0.1:3000
```

These are placeholders: use your provider's exact issuer and trusted HTTPS key-set URL. The resource URL must be the public HTTPS `/mcp` endpoint. Partial configuration and mixed static-token/OAuth modes fail startup.

The server publishes `/.well-known/oauth-protected-resource/mcp` and the root metadata alias. Authentication challenges advertise this metadata URL and the required `reword` scope. Discovery follows the [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). The external authorization server handles login, consent, authorization code + PKCE, refresh, and client registration; RE:WORD validates access tokens only.

This implementation accepts RFC 9068-style JWT access tokens with `typ: at+jwt`, signed using RS256 or ES256. Tokens must contain the configured `iss`, an `aud` including the exact resource URL, a nonempty `sub`, `client_id`, `jti`, `iat`, unexpired `exp`, and a space-separated `scope` containing `reword`. Future `nbf`/`iat`, bad signatures, wrong issuer/audience, missing claims, and generic ID tokens are rejected. Opaque tokens and provider-specific token formats are not supported. Confirm that your chosen provider can emit this profile and configure the client to request the resource and scope.

Keys are fetched and cached by `jose` from the configured JWKS endpoint, supporting key rotation. Token-supplied key URLs are ignored. No authorization header, access token, or identity-provider subject is stored in SQLite. The owner key is a hash of the verified `(issuer, subject)` pair; it is never accepted from tool arguments. Scope failures return 403; invalid tokens return 401. JWT revocation is not checked online: use short-lived access tokens and your provider's session controls.

Local records remain in the `local` namespace, inaccessible to OAuth users. A deliberate owner-transfer/import workflow is not implemented yet. Back up the database before upgrading; schema version 2 preserves data but the old application version cannot use the new schema. Do not switch authentication modes expecting existing records to transfer automatically.

Automated tests use locally signed keys and real HTTP MCP clients. Remote JWKS caching, rotation, and outage handling are tested through the actual jose resolver with a controlled fetch implementation. A live provider login, live JWKS network behavior, HTTPS proxy setup, and ChatGPT connection still need deployment acceptance testing.

Persist the entire SQLite data directory on local attached storage. Use one service replica; do not share SQLite over a network filesystem. Stop the service before copying its database files, or use SQLite's online backup API. Test restoration before relying on backups. Never bake the data directory or secrets into an image. Schema initialization is versioned and automatic; future schema changes need additional migrations.

## Validation and next steps

Tests cover independent success, shortened failure intervals, exposure cooldown, idempotent retries, correction recurrence, normalization, bounded relevant retrieval, mastery thresholds, transactional rollback, reopen persistence, and an actual SDK client initializing/listing/calling tools over HTTP with authentication and host/origin checks.

Next: configure an identity provider and test the full login/consent flow on an HTTPS staging deployment. Semantic relevance can wait until real conversation usage shows where the keyword heuristic falls short. Pronunciation requires an audio-capable evaluation pipeline and is outside V1.

## ChatGPT learning modes

`@reword` opens Flashcard, Multiple Choice, Sentence Blocks and Free Recall using the connected account's saved vocabulary and shared learning history. See [Learning Modes](docs/LEARNING_MODES.md) for interaction details, additive data changes, APIs and validation. The embedded MCP Apps UI uses the existing authenticated backend; `/learn/` is the standalone diagnostic workspace and local preview data is not production data.
