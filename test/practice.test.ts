import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LearningService } from "../src/service.js";
import { SqliteRepository } from "../src/storage/sqlite.js";
import { SnapshotRepository } from "../src/storage/snapshot.js";
import {
  chunkSentence,
  recommendedMode,
} from "../src/features/practice/domain.js";

test("flashcards use due items, hide backs, persist reveal/resume, record Know and Don't know once in the shared history", () => {
  const dir = mkdtempSync(join(tmpdir(), "reword-practice-"));
  let repo = new SqliteRepository(join(dir, "db"));
  let now = new Date("2026-09-25T00:00:00Z");
  let service = new LearningService(repo, () => now);
  try {
    const item = service.save({
      type: "expression",
      text: "weigh my options",
      meaning_ja: "compare choices",
      example: "I need to weigh my options before I decide.",
      original_context: "career",
    });
    service.save({ type: "word", text: "scarce", meaning_en: "not enough" });
    const future = service.save({
      type: "word",
      text: "future",
      meaning_en: "later",
    });
    service.record({
      item_id: future.id,
      event_id: randomUUID(),
      outcome: "independent",
      context: "Future plans",
    });
    assert.equal(recommendedMode(item), "flashcard");
    service.startPractice({ mode: "flashcard" });
    let view = service.getActivity("flashcard")!;
    assert.equal(view.total, 2);
    assert.equal(JSON.stringify(view).includes('"back"'), false);
    const first = view.current!;
    const action = {
      mode: "flashcard" as const,
      session_id: view.activity_id,
      question_id: first.question_id,
    };
    assert.throws(
      () => service.answerPractice({ ...action, answer: "know" }),
      /Reveal/,
    );
    service.answerPractice({ ...action, action: "reveal" });
    service.answerPractice({ ...action, action: "reveal" });
    assert.ok(service.getActivity("flashcard")!.current!.back);
    assert.equal(service.review(first.item_ids[0]!).history.length, 0);
    repo.close();
    repo = new SqliteRepository(join(dir, "db"));
    service = new LearningService(repo, () => now);
    assert.ok(service.getActivity("flashcard")!.current!.revealed);
    const before = service.stats().total;
    service.answerPractice({ ...action, answer: "know" });
    service.answerPractice({ ...action, answer: "know" });
    let history = service.review(first.item_ids[0]!).history;
    assert.equal(history.length, 1);
    assert.equal(history[0]!.practice_mode, "flashcard");
    assert.equal(history[0]!.outcome, "recognition");
    view = service.getActivity("flashcard")!;
    const second = { ...action, question_id: view.current!.question_id };
    const id = view.current!.item_ids[0]!;
    service.answerPractice({ ...second, action: "reveal" });
    service.answerPractice({ ...second, answer: "dont_know" });
    assert.equal(service.review(id).history[0]!.outcome, "incorrect");
    assert.equal(service.stats().total, before);
    assert.equal(service.getActivity("flashcard")!.completed, true);
    service.startPractice({ mode: "flashcard" });
    assert.equal(
      service.getActivity("flashcard")!.activity_id,
      view.activity_id,
    );
    assert.equal(
      new LearningService(repo.forUser("oauth:other")).getPractice({
        mode: "flashcard",
      }).data,
      null,
    );
    now = new Date("2026-09-26T00:00:00Z");
    service.startPractice({ mode: "flashcard" });
    assert.notEqual(
      service.getActivity("flashcard")!.activity_id,
      view.activity_id,
    );
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("four unique meaning options, hidden answer, generated fallback only fills missing saved candidates; correct and wrong share progress", () => {
  const repo = new SnapshotRepository();
  const service = new LearningService(repo);
  const a = service.save({
    type: "expression",
    text: "weigh my options",
    meaning_en: "compare choices",
    example: "I need to weigh my options.",
  });
  const b = service.save({
    type: "word",
    text: "scarce",
    meaning_en: "not enough",
  });
  assert.equal(service.startChoice(), null);
  service.startPractice({
    mode: "multiple_choice",
    generated_distractors: [
      {
        item_id: a.id,
        meanings: ["avoid problems", "decide immediately", "change views"],
      },
    ],
  });
  let view = service.getActivity("choice")!;
  const q = repo.getDaily()!.activities.choice!.questions[0]!;
  assert.equal(view.current!.options!.length, 4);
  assert.equal(new Set(view.current!.options!.map((o) => o.text)).size, 4);
  assert.ok(view.current!.options!.some((o) => o.text === b.meaning_en));
  assert.equal(
    view.current!.options!.filter((o) => o.text === a.meaning_en).length,
    1,
  );
  assert.equal(JSON.stringify(view).includes('"expected"'), false);
  const payload = {
    mode: "multiple_choice" as const,
    session_id: view.activity_id,
    question_id: q.id,
    answer: q.expected!,
  };
  service.answerPractice(payload);
  service.answerPractice(payload);
  assert.equal(service.review(a.id).history.length, 1);
  assert.equal(
    service.review(a.id).history[0]!.practice_mode,
    "multiple_choice",
  );
  assert.equal(service.review(a.id).history[0]!.outcome, "recognition");
  assert.equal(service.stats().total, 2);
  view = service.getActivity("choice")!;
  assert.equal(view.results[0]!.example, a.example);
  const state = repo.getDaily()!;
  state.activities.choice!.date = "2000-01-01";
  repo.putDaily(state);
  service.startPractice({
    mode: "multiple_choice",
    generated_distractors: [
      { item_id: a.id, meanings: ["avoid problems", "decide immediately"] },
    ],
  });
  view = service.getActivity("choice")!;
  const stored = repo.getDaily()!.activities.choice!.questions[0]!;
  service.answerPractice({
    ...payload,
    session_id: view.activity_id,
    question_id: stored.id,
    answer: stored.options!.find((o) => o.id !== stored.expected)!.id,
  });
  assert.equal(service.review(a.id).history[0]!.outcome, "incorrect");
  assert.throws(
    () =>
      service.startPractice({
        mode: "multiple_choice",
        generated_distractors: [{ item_id: randomUUID(), meanings: ["bad"] }],
      }),
    /not found/,
  );
});

test("saved examples create natural blocks without item duplication; split expressions rejected, checks and retries tagged", () => {
  const repo = new SqliteRepository(":memory:");
  const service = new LearningService(repo);
  try {
    const item = service.save({
      type: "expression",
      text: "weigh my options",
      meaning_en: "compare choices",
      example: "I need to weigh my options before I decide.",
    });
    assert.deepEqual(chunkSentence(item.example!, item.text), [
      "I",
      "need to",
      "weigh my options",
      "before I decide.",
    ]);
    assert.throws(
      () =>
        service.prepareSentences({
          questions: [
            {
              prompt: "Compare choices",
              item_ids: [item.id],
              blocks: ["I need to", "weigh", "my options", "before I decide."],
            },
          ],
        }),
      /together/,
    );
    service.startPractice({ mode: "sentence_blocks" });
    const view = service.getSentences()!;
    const q = repo.getSentences()!.questions[0]!;
    assert.equal(view.total, 1);
    assert.equal(view.current!.sentence, undefined);
    assert.equal(service.stats().total, 1);
    let payload = {
      mode: "sentence_blocks" as const,
      session_id: view.session_id,
      question_id: q.id,
      action: "check" as const,
      revision: 0,
      request_id: randomUUID(),
      block_ids: [...q.expected].reverse(),
    };
    service.answerPractice(payload);
    service.answerPractice(payload);
    assert.equal(service.review(item.id).history.length, 1);
    payload = {
      ...payload,
      revision: 1,
      request_id: randomUUID(),
      block_ids: q.expected,
    };
    service.answerPractice(payload);
    const history = service.review(item.id).history;
    assert.equal(history.length, 2);
    assert.ok(history.every((e) => e.practice_mode === "sentence_blocks"));
    assert.equal(history[0]!.outcome, "recognition");
    assert.equal(history[1]!.outcome, "incorrect");
  } finally {
    repo.close();
  }
});

test("Free Recall facade resumes a legacy quiz, masks expected answer and preserves slots/retries and legacy events", () => {
  const repo = new SqliteRepository(":memory:");
  const service = new LearningService(repo);
  try {
    const item = service.save({
      type: "word",
      text: "scarce",
      meaning_en: "not enough",
    });
    const legacy = service.startQuiz()!;
    const view = service.startPractice({ mode: "free_recall" });
    assert.equal(JSON.stringify(view).includes("expected_answer"), false);
    assert.equal(service.getQuiz()!.quiz_id, legacy.quiz_id);
    const input = {
      mode: "free_recall" as const,
      session_id: legacy.quiz_id,
      question_id: legacy.current!.question_id,
      answer: "Scarce!",
    };
    service.answerPractice(input);
    service.answerPractice(input);
    assert.equal(service.review(item.id).history.length, 1);
    assert.equal(
      service.review(item.id).history[0]!.practice_mode,
      "free_recall",
    );
    assert.equal(service.review(item.id).item.successful_uses, 1);
    assert.ok(service.review(item.id).item.interval_hours >= 12);
    service.startPractice({ mode: "free_recall" });
    assert.equal(service.getQuiz()!.quiz_id, legacy.quiz_id);
    const id = randomUUID();
    service.record({
      item_id: item.id,
      event_id: id,
      outcome: "exposure",
      context: "legacy",
    });
    service.record({
      item_id: item.id,
      event_id: id,
      outcome: "exposure",
      context: "legacy",
    });
    assert.throws(
      () =>
        service.record({
          item_id: item.id,
          event_id: id,
          outcome: "exposure",
          context: "legacy",
          practice_mode: "flashcard",
        }),
      /different/,
    );
  } finally {
    repo.close();
  }
});
