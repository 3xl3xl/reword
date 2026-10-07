import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LearningService } from "../src/service.js";
import { SqliteRepository } from "../src/storage/sqlite.js";
import { SnapshotRepository } from "../src/storage/snapshot.js";
const vocabulary = [
  ["scatter", "散らばる"],
  ["reliable", "頼りになる"],
  ["scarce", "不足した"],
  ["intense", "強烈な"],
  ["improvement", "改善"],
] as const;
function seed(service: LearningService) {
  return vocabulary.map(([text, meaning_ja]) =>
    service.save({ text, meaning_ja, type: "word" }),
  );
}
test("today menu is read-only, four modes, no fabricated seed data; all choices come from owned saved vocabulary", () => {
  const repo = new SnapshotRepository();
  const service = new LearningService(repo);
  assert.equal(service.todayLearning().menu.length, 4);
  assert.ok(service.todayLearning().menu.every((m) => !m.available));
  assert.equal(service.startChoice(), null);
  assert.equal(service.stats().total, 0);
  assert.equal(service.learningMaterial({ mode: "reading" }).empty, true);
  const items = seed(service);
  const before = repo.snapshot();
  const today = service.todayLearning();
  assert.ok(today.menu.every((m) => m.available));
  assert.deepEqual(repo.snapshot(), before);
  let view = service.startChoice()!;
  assert.equal(view.total, 5);
  assert.equal(JSON.stringify(view).includes('"expected"'), false);
  for (const option of view.current!.options!)
    assert.ok(items.some((i) => i.meaning_ja === option.text));
  const activity = repo.getDaily()!.activities.choice!;
  const q = activity.questions[0]!;
  const answer = {
    mode: "choice" as const,
    activity_id: view.activity_id,
    question_id: q.id,
    answer: q.expected!,
  };
  view = service.answerActivity(answer)!;
  assert.deepEqual(service.answerActivity(answer), view);
  assert.equal(service.review(q.item_ids[0]!).history.length, 1);
  assert.equal(service.review(q.item_ids[0]!).item.mastery_score, 3);
  assert.equal(service.review(q.item_ids[0]!).item.successful_uses, 0);
  assert.throws(
    () =>
      service.answerActivity({
        ...answer,
        answer: q.options!.find((o) => o.id !== q.expected)!.id,
      }),
    /differently/,
  );
  assert.equal(
    service.todayLearning().menu.find((m) => m.id === "choice")!.status,
    "in_progress",
  );
  while (!view.completed) {
    const question = repo
      .getDaily()!
      .activities.choice!.questions.find((q) => q.answer === undefined)!;
    view = service.answerActivity({
      ...answer,
      question_id: question.id,
      answer: question.expected!,
    })!;
  }
  assert.equal(
    service.todayLearning().menu.find((m) => m.id === "choice")!.status,
    "completed",
  );
  assert.equal(service.startChoice()!.activity_id, view.activity_id);
});
test("daily activities persist, isolate users, resume across midnight and only credit observed free-form usage", () => {
  const dir = mkdtempSync(join(tmpdir(), "reword-daily-"));
  let repo = new SqliteRepository(join(dir, "db"));
  let now = new Date("2026-09-24T14:59:00Z");
  let service = new LearningService(repo, () => now);
  try {
    const items = seed(service);
    const q = {
      prompt: "How can you make your work more reliable?",
      item_ids: [items[1]!.id],
    };
    assert.throws(
      () =>
        service.prepareActivity({
          mode: "conversation",
          topic: "Work",
          questions: [{ ...q, item_ids: [randomUUID()] }],
        }),
      /not found/,
    );
    let view = service.prepareActivity({
      mode: "conversation",
      topic: "Work",
      questions: [q, q],
    })!;
    assert.equal(
      new LearningService(repo.forUser("oauth:b")).getActivity("conversation"),
      null,
    );
    repo.close();
    repo = new SqliteRepository(join(dir, "db"));
    service = new LearningService(repo, () => now);
    assert.deepEqual(service.getActivity("conversation"), view);
    now = new Date("2026-09-24T15:01:00Z");
    assert.equal(
      service.prepareActivity({
        mode: "conversation",
        topic: "Other topic",
        questions: [q],
      })!.activity_id,
      view.activity_id,
    );
    assert.equal(service.todayLearning().date, "2026-09-25");
    const answer = {
      mode: "conversation" as const,
      activity_id: view.activity_id,
      question_id: view.current!.question_id,
      answer: "I like cats.",
      outcome: "prompted" as const,
      assessed_item_ids: [],
    };
    view = service.answerActivity(answer)!;
    assert.equal(service.review(items[1]!.id).history.length, 0);
    assert.throws(
      () =>
        service.answerActivity({
          ...answer,
          question_id: view.current!.question_id,
          assessed_item_ids: [items[0]!.id],
        }),
      /not part/,
    );
    view = service.answerActivity({
      ...answer,
      question_id: view.current!.question_id,
      answer: "I want to be more reliable at work.",
      assessed_item_ids: [items[1]!.id],
      feedback: "Natural phrasing.",
    })!;
    assert.equal(view.completed, true);
    assert.equal(service.review(items[1]!.id).item.mastery_score, 10);
    assert.equal(service.review(items[1]!.id).history[0]!.outcome, "prompted");
    assert.equal(service.stats().total, 5);
    assert.notEqual(
      service.prepareActivity({
        mode: "conversation",
        topic: "Work",
        questions: [q],
      })!.activity_id,
      view.activity_id,
    );
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("reading requires a real passage and four options, hides answers, and writing requires explicit assessment", () => {
  const service = new LearningService(new SnapshotRepository());
  const item = seed(service)[0]!;
  assert.throws(() =>
    service.prepareActivity({
      mode: "reading",
      topic: "Focus",
      questions: [{ prompt: "Why?", item_ids: [item.id] }],
    }),
  );
  const reading = service.prepareActivity({
    mode: "reading",
    topic: "Focus",
    passage: "When we try too many things, our attention can scatter.",
    questions: [
      {
        prompt: "What can happen to our attention?",
        item_ids: [item.id],
        options: [
          "It can scatter.",
          "It grows taller.",
          "It disappears forever.",
          "It becomes money.",
        ],
        correct_index: 0,
      },
    ],
  })!;
  assert.equal(reading.current!.options!.length, 4);
  assert.equal(JSON.stringify(reading).includes("correct_index"), false);
  assert.equal(JSON.stringify(reading).includes('"expected"'), false);
  const writing = service.prepareActivity({
    mode: "writing",
    topic: "Focus",
    questions: [
      { prompt: "Write one sentence with scatter.", item_ids: [item.id] },
    ],
  })!;
  assert.throws(
    () =>
      service.answerActivity({
        mode: "writing",
        activity_id: writing.activity_id,
        question_id: writing.current!.question_id,
        answer: "The papers scatter.",
      }),
    /Assess/,
  );
  assert.equal(service.review(item.id).history.length, 0);
});
