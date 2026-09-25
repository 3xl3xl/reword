# RE:WORD Learning Modes

## Architecture

A saved `word`, `expression` or `correction` remains one learning item. `LearningService` owns mastery, scheduling, quiz state and usage events. SQLite stores tenant-scoped JSON; Postgres runs the same service against a locked account snapshot. The existing repository transaction remains the unit of work. There is no separate mastery score or vocabulary copy per mode.

`@reword` opens the four-mode ChatGPT menu. Conversation → save it → review → reuse in conversation remains the core loop. Reading, conversation and writing tools from the earlier iteration remain callable for explicit requests; they are no longer primary menu entries.

## Modes

| Mode            | Interaction                                                                                                      | Recorded outcome                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Flashcard       | Due saved text → tap to reveal meaning, example and context → Know / Don't know                                  | recognition / incorrect                                                           |
| Multiple Choice | Saved text → four meaning cards → select → Check → feedback and saved example → full-width Next                  | recognition / incorrect                                                           |
| Sentence Blocks | Saved example or host-prepared sentence → natural chunks → tap / drag / keyboard → Check → sentence audio → Next | prompted on first success; incorrect on first miss; recognition on later recovery |
| Free Recall     | Existing saved-meaning prompt → type the English                                                                 | prompted / incorrect using existing quiz scheduling                               |

Flashcards persist their revealed side and answered position. New cards come from due items. Four-choice candidates prefer other saved meanings, ranked by shared context/meaning tokens with random tie-breaking. Identical meanings and explicitly recorded synonyms are excluded. If too few suitable candidates exist, ChatGPT can supply missing incorrect meanings through `generated_distractors`; these never create learning items. The server enforces four distinct options and a single designated answer. Semantic plausibility and ambiguity of generated alternatives remain the host's responsibility; token matching is not a semantic model.

Check is explicit. Selecting a card does not record an answer. Feedback shows the selected response, correct meaning, a short explanation and the stored example when available. Reload resumes at the first unanswered question; feedback already viewed is available in persisted results.

Sentence Blocks supports 1–5 questions. A saved multiword expression stays together when it appears literally in the sentence. A lightweight chunker preserves that expression and common phrases, grouping remaining words; unsuitable examples require host preparation. Existing unfinished lessons are preserved. Blocks have a shared minimum height, consistent padding and automatic growth for multiline text. The existing insertion gap, pointer tolerance, keyboard controls, draft revision checks and duplicate-request protection remain.

Free Recall uses the exact existing quiz record, slots, progress and retries. `start_quiz`, `get_quiz`, and `answer_quiz` retain their contracts, including host-assessed equivalent answers. The interactive practice facade grades normalized exact text; it hides the grading answer until submission. Repeated successful prompted recall continues to extend the existing review interval.

## Additive data changes

Usage events accept optional `practice_mode`:

```ts
"flashcard" | "multiple_choice" | "sentence_blocks" | "free_recall";
```

Events keep existing `item_id`, `event_id`, `outcome`, `context`, and `created_at` (the timestamp). Legacy events without a mode remain valid and are not rewritten. Mode is part of duplicate-event conflict checking. Opening, flipping and listening do not create usage events.

Flashcard session state extends the existing optional daily activity snapshot with front/back/revealed fields. Choice questions optionally snapshot the front text and example. SQLite's existing `tenant_daily` and Postgres's optional `daily` JSON fields are reused. No schema migration or replacement of account records is required.

`recommendedMode` is a replaceable suggestion based on current mastery thresholds, exposed with learning material. It does not lock modes or change the scheduling algorithm. Personal/Hard describe sentence content; `practice_mode` records the exercise type independently.

## Boundaries

New MCP tools: `start_practice`, `get_practice`, `answer_practice`. Existing tools remain; there are 28 total.

HTTP equivalents use the existing authentication and ownership selection:

- `POST /api/practice/start`
- `GET /api/practice?mode=flashcard`
- `POST /api/practice/answer`

The common API delegates to existing choice, sentence and quiz methods. Flashcard reveal/answer changes persist transactionally. Postgres wraps each write in its existing row-locked unit of work; SQLite avoids nested transactions.

`public/features/practice.js` is shared by the native MCP Apps widget and the standalone diagnostic workspace. Flashcard text, choice target text and feedback examples use the existing device speech provider boundary; Sentence Blocks retains block and sentence playback plus optional server TTS. Voice OFF cancels playback. No microphone or pronunciation assessment is implied.

## Verification and remaining work

Run `npm run check` and `npm run test:ui`. Tests cover legacy quiz persistence, slots, resume, answer progress and retries; due cards and reveal persistence; four unique options and hidden answers; tagged usage and shared progress; expression chunk preservation; account isolation and concurrent Postgres answers; authenticated HTTP boundaries; explicit Check/Next, device playback hooks, drag/keyboard ordering and multiline mobile blocks.

Real ChatGPT tool selection and production-data connection still require deployment to the existing registered MCP endpoint and a connection refresh. This implementation does not prove that a local preview is using production data. Live audio quality is device-dependent and remains a manual check.

Future work: semantic distractor quality evaluation, richer language-aware chunking and accepted alternative word orders, adaptive progression informed by mode-specific history, and live ChatGPT integration validation. Existing schedules remain host-driven; no new notification scheduler is introduced.
