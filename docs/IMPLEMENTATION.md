# Learning workspace implementation

## Architecture and reuse

The existing TypeScript/Express MCP service remains the single learning backend. `src/service.ts` owns saving, quizzes, usage events, mastery and review scheduling. `src/storage/repository.ts` is its persistence boundary. SQLite serves local installations; Postgres executes the same service against a locked per-owner snapshot. OAuth continues to select the owner. No separate vocabulary database or grading store has been introduced.

The frontend is a small, same-origin ES-module application served at `/learn/`. It does not require a second framework or build pipeline. Feature boundaries are `public/features/sentences.js`, `public/features/drag.js`, `public/features/audio.js` and `public/features/api.js`. Saved words and the existing daily quiz are connected through `public/app.js`.

## Delivered behavior

- Five-question Sentence Blocks sessions with Personal and Hard sample lessons; Japanese prompts, stable shuffled phrase bank, tap to add/remove, uniform 54px answer blocks, wrapping rows, pointer reorder and Alt+arrow keyboard reorder.
- A 40px insertion gap, frozen drag-start geometry, 14px pointer hysteresis and 180ms FLIP movement. Reduced-motion preferences disable animation.
- Explicit Check; a first incorrect attempt does not reveal a solution. A starting-phrase hint appears after two wrong checks. A full-width Next appears after successful sentence playback (or immediately with voice off/unavailable).
- Durable drafts, current question, attempts, mode and completion in the user's actual learning state. Revision checks prevent stale tabs from overwriting newer work. The last request ID makes lost-response retries idempotent.
- The first attempt records prompted success or an incorrect usage on each linked saved item. Further failed checks do not repeatedly penalize. Recovery after a mistake records recognition, not independent conversation success. Playback itself never records speaking or pronunciation success.
- Saved Words supports words, expressions, corrections, synonyms, contextual examples, review dates, mastery and item history. Existing MCP save tools now accept and store synonyms and examples.
- Daily Quiz reuses `startQuiz`, `getQuiz`, `answerQuiz` and the 08:00/22:00 Tokyo slots. Browser responses omit grading answers. Browser grading is normalized exact matching; host-assessed equivalents remain available through the existing MCP flow.

## Content and personal context

The starter lesson picker explicitly previews income, Europe, Shopify, focus and confidence themes. Clicking its save-and-start button saves five practice expressions; these are labeled user-selected practice themes, not asserted biographical facts. Existing saved words occurring in these sentences are linked as well, with a deliberately small exact / `s` / `ed` matching rule.

For actual conversation-derived content, the host can call `prepare_sentence_blocks` with five Japanese prompts, correctly ordered phrase arrays, mode and existing `item_ids`. It must use user-supplied context and real saved vocabulary/corrections. The service validates ownership, shuffles once and persists the lesson. An unfinished lesson resumes instead of being replaced. No autonomous LLM generation or background conversation ingestion has been added.

`get_sentence_blocks` and `answer_sentence_blocks` expose the same session model to MCP. Correct sequences are server-only until solved; the public state contains the shuffled bank, selected IDs and, after two attempts, a partial hint.

## Database / API changes

- `Item.synonyms` and `Item.example` are optional for old records; new saves default to empty values. JSON storage makes this backward compatible without rewriting existing items.
- SQLite adds an idempotently created `tenant_sentences(owner, data)` table. All reads and writes are scoped to the same owner as vocabulary and events.
- Postgres adds an optional `sentences` field to its version-1 account snapshot. Existing rows need no schema migration. Writes use the existing account transaction and row lock.
- `/api/*` uses the same bearer/OAuth middleware as `/mcp`. It exposes words, history, stats, quizzes, sentence sessions and scoped speech. It never trusts a client-provided owner.
- `/learn/` is a public static shell; learning data requires the configured authentication. Local loopback development works without a token. Authenticated deployments currently accept a RE:WORD access token through the Connect dialog, held only in page memory; browser OAuth authorization/refresh is a future enhancement.
- Existing host/origin checks remain in place; same-origin browser requests are permitted. The Vercel entry point explicitly allows its configured public origin.

## Audio

Server-only `OpenAISpeechProvider` uses `gpt-4o-mini-tts` through the speech endpoint. Set `OPENAI_API_KEY` and optionally `OPENAI_TTS_VOICE` (default `cedar`) to enable it. The API key is never exposed to the frontend. Word speed is 0.85 and sentence speed is 1. Audio requests accept a session/question/block reference, not arbitrary client text; full sentences are available only after success. Per-owner in-process limits bound repeated speech requests (60/minute; these are not a distributed billing quota).

The frontend provider boundary supports cloud speech and browser speech synthesis. It prefers an available English male device voice, cancels old playback on new selections/navigation/mute, and falls back if cloud speech fails. A timeout prevents Next from being permanently blocked. Voice OFF disables both word/sentence playback and optional selection/result tones. The page discloses synthetic speech.

Official API reference used: [Text to speech](https://developers.openai.com/api/docs/guides/text-to-speech). Voice identity and quality depend on the available provider; this does not clone or promise a particular ChatGPT voice. Automated tests stub synthesis; live paid TTS and real-device listening are not verified without configured credentials.

## Validation

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:ui
```

The backend suite covers legacy persistence, quiz behavior, OAuth boundaries, sentence restart/resume, solution hiding, hint timing, duplicate block identity, retry conflicts, atomic usage scheduling, Postgres concurrency and user isolation. Speech HTTP tests ensure unsolved sentences cannot be requested as full audio.

The Playwright suite runs a separate in-memory backend and exercises all five questions, tap/remove, blank slot geometry, pointer/keyboard reorder, reload, incorrect feedback, hints, speech requests through a device-voice stub, full-width Next, completion, Saved Words history and a narrow mobile layout. It does not alter a real user's vocabulary. Screenshots are written to ignored `test-results/`.

## Remaining work beyond this MVP

- Browser OAuth sign-in and refresh, replacing manual access-token entry for hosted users.
- Live listening checks of TTS on target devices, native premium provider integrations and distributed speech quotas.
- A 100–200-pattern curriculum, five-level adaptive progression, validated alternative sentence orders and richer inflection matching.
- Optional generation from due words, corrections and explicitly supplied conversation topics; the MCP preparation contract is already available.
- Free-form sentence creation, recording, pronunciation assessment and evidence-based conversation usage. Do not treat listening as speaking evidence.
- Scheduler execution and ChatGPT push delivery remain host responsibilities. The existing daily quiz state is reused, but this server does not schedule or deliver ChatGPT notifications.

The earlier `docs/product/*` files remain conversation snapshots. This document describes the implemented MVP and supersedes their “unconfirmed” markers for the features above.
