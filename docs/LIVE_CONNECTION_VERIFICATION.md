# Live connection verification

Local tests, a successful Vercel build, and a Ready preview do not prove that ChatGPT uses the production database or that audio works on an iPhone. Keep PR #1 in Draft until the live gates below have recorded results. Preserve the existing database, registered `/mcp` URL, and OAuth issuer/subject owner mapping.

## 1. Checks without external credentials

Use Node.js 22.16+ on the PR branch:

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:ui
```

Pass: formatting, production/test types, all backend tests, widget/TypeScript build, and browser tests succeed. A browser download failure is an environment blocker, not an application test failure. Device voice stubs and the isolated MCP Apps host do not establish real ChatGPT or iPhone behavior.

The offline choice-quality set includes explicitly asserted residual risks: unregistered near synonyms and paraphrases can still be accepted as distractors. Passing these tests does not prove semantic answer uniqueness. Review both saved and generated alternatives; retain existing sessions rather than regenerating them behind the learner's back.

## 2. Read-only deployed check (requires access)

First establish the actual registered production endpoint from the existing connection settings; do not substitute a preview or invent the URL. Follow [Vercel + Neon deployment](../deploy/VERCEL.md) for configuration and any necessary additive migration. Do not create a replacement database or reassign existing account rows. Use the trusted environment for credentials, never chat or Git.

```sh
read -r -s REWORD_SMOKE_TOKEN
export REWORD_SMOKE_TOKEN
npm run smoke -- https://YOUR-REGISTERED-HOST/mcp
unset REWORD_SMOKE_TOKEN
```

Replace the placeholder host before execution. Pass: health, authentication challenge/advertised OAuth metadata, legacy and new practice tool discovery, authenticated stats, read-only `get_practice` for all four modes, and the HTML MCP Apps resource succeed. `practice_reads` and `widget_resource` must be `ok`. Missing sessions are valid; this check never starts a quiz, saves words, records answers or prints personal session content.

This does not exercise browser rendering, login/consent, host tool selection, production vocabulary identity, audio playback, or write persistence. Do not call it a complete end-to-end pass.

## 3. Manual ChatGPT and iPhone gates

Refresh the existing ChatGPT connection after deploying tool changes. Record the deployed commit, test date, client/device, and pass/fail evidence for each gate. Use actual learner answers; never fabricate answers to complete a test. Use an explicitly designated test account for write/redeploy checks when possible. Do not seed samples into the learner's production account.

| Gate                 | Action                                                                                                                                | Pass criterion                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login and account    | Complete real login/consent; read saved words and stats.                                                                              | Correct existing vocabulary and history are visible under the expected owner; no local samples or reset account.                                                                                                            |
| Entry/tool selection | Ask `@reword` for today's learning, then request each primary mode.                                                                   | Host invokes the menu and intended practice tools; four modes appear in ChatGPT. No localhost or token-paste detour.                                                                                                        |
| Flashcard            | Reveal; submit the learner's Know/Don't know; reopen.                                                                                 | Back hidden before reveal, exactly one history event per answer, persisted position/reveal state.                                                                                                                           |
| Multiple Choice      | Inspect four choices; select without Check, then Check; reopen.                                                                       | No answer recorded before Check; four display-distinct choices with one defensible semantic answer; feedback and saved example; persisted answer. If material is insufficient, explain it rather than fabricate vocabulary. |
| Sentence Blocks      | Arrange/tap/drag blocks, Check, use Next, interrupt and reopen.                                                                       | Saved expressions remain intact, multiline blocks usable, drafts/resume persist, hints/feedback and Next work.                                                                                                              |
| Free Recall          | Submit an actual response; reopen.                                                                                                    | Existing quiz slots/progress preserved, grading answer hidden beforehand, usage recorded once. Equivalent host grading and interactive exact-text grading are distinguished.                                                |
| iPhone audio         | Listen to word/block/sentence, toggle Voice OFF, navigate during playback.                                                            | Intelligible target-device speech; mute/navigation cancels playback; Next remains usable when voice is unavailable. Playback does not record speaking success.                                                              |
| Redeploy persistence | On the designated account, explicitly save a test expression and leave a real draft; redeploy the same configured service; reconnect. | Same item ID, history, mastery and draft survive; no database replacement.                                                                                                                                                  |
| Isolation/retries    | Use a second authorized account and retry the same answer request.                                                                    | No other account's items/session/history visible; retry does not duplicate usage; conflicting/stale writes rejected. Local Postgres tests do not prove live pooled/multi-process behavior.                                  |

## 4. Results and review gate

Record evidence rather than checking boxes from memory:

| Gate                               | Status                                                    | Date / deployed commit                                                           | Evidence / blocker                                                                                                          |
| ---------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Local check                        | Passed: 53 backend tests, format, types, widget and build | 2026-10-12; working tree based on `5c763f7` plus this smoke/documentation change | Includes read-only smoke against empty and populated accounts; all learning state unchanged.                                |
| Browser tests                      | Blocked in this environment                               | 2026-10-12                                                                       | Chromium download returned an invalid ZIP; not rerun. Previous PR reports four passes before this change; not a fresh pass. |
| Deployed read-only smoke           | Unverified                                                | —                                                                                | Requires endpoint and short-lived token.                                                                                    |
| ChatGPT login, data and four modes | Unverified                                                | —                                                                                | Requires connected account/client.                                                                                          |
| iPhone audio                       | Unverified                                                | —                                                                                | Requires physical-device listening.                                                                                         |
| Redeploy persistence and isolation | Unverified                                                | —                                                                                | Requires trusted deployment access and second account.                                                                      |

Update the PR with actual results and the remaining semantic limitations. Mark it ready for review only after all live gates pass, or explicitly document a revised review scope; do not silently reinterpret missing evidence as success.
