# Daily learning efficiency update

The reference screenshots organize learning around a Today plan, grammar, scenes and reading. This first increment adapts the Today entry point to RE:WORD's actual saved vocabulary and existing practice modes. It does not add a news feed, a grammar curriculum or speech assessment.

## Behavior

- Today's plan has a five-expression goal and counts distinct items with actual assessed answers on the current Asia/Tokyo day. Repeated answers to the same expression count once. Exposure/playback does not count. This is activity progress, not mastery or a measured proficiency score.
- Recognition and successful prompted/independent use are shown separately. Their item counts can overlap. Successful use includes existing sentence-block outcomes; it is not evidence of unaided speaking.
- Unfinished sessions take priority, including sessions started on a previous day. Otherwise the plan suggests reconstruction for due mistakes, recall for previously recognized/used due expressions, and flashcards for new material. This is a transparent heuristic, not a validated learning model.
- New practice prioritizes items whose latest assessed outcome is incorrect. Exposure does not erase that state; a later successful assessment does. Due times are respected. Existing sessions and their question order remain unchanged.
- Multiple-choice targets now come only from due items, matching other modes. Non-due saved meanings may still be used as distractors. When nothing is due, the menu shows waiting and the next review time rather than offering an empty new drill.
- Completed flashcard, choice and recall sets show their missed expressions and a route back to the plan. Existing daily/quiz-slot session limits remain in effect.
- The chunker retains additional everyday units such as `looking for`, `waiting for`, `interested in`, `try it on`, `pay with`, and `hang out with`. Longest matching expressions retain priority. This remains a heuristic chunker, not a full parser.

The API addition is `todayLearning().plan`; existing menu fields and all four mode identifiers remain. `waiting` is a new menu status. No database schema migration or production data write is required to view the plan.

## Verification — 2026-10-17 (Japan)

- `npm run check`: formatting, production/test types, 59 backend tests and widget/TypeScript builds pass.
- Six added backend tests cover read-only distinct progress, exposure exclusion, due-only choice targets, recommendations and resume, latest-error ordering, Tokyo midnight/account isolation and chunk preservation. The existing choice test now advances the clock before expecting another scheduled review.
- DOM checks passed for goal progress, recommended button → practice API, completion feedback, HTML escaping, return navigation, Japanese review time and disabled waiting states. These used JSDOM and mocked the host bridge; they do not verify browser layout or the real ChatGPT bridge.
- Playwright assertions were extended for the plan/recommended resume action, but were not executed: the Chromium download failed with an invalid/truncated ZIP. Real browser/mobile layout, iPhone audio, deployment and real ChatGPT account behavior remain unverified.

## Remaining work

The pre-existing multiple-choice near-synonym ambiguity and exact-normalized free-recall grading are unchanged. New screens for grammar/scenes/news, semantic answer assessment and a measured learning-outcome comparison remain separate work. The current changes are prepared on top of draft PR #1 and are not a production release.
