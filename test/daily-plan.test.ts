import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { LearningService } from "../src/service.js";
import { SqliteRepository } from "../src/storage/sqlite.js";
import { SnapshotRepository } from "../src/storage/snapshot.js";
import { chunkSentence } from "../src/features/practice/domain.js";

function setup() {
  let now = new Date("2026-10-16T00:00:00Z");
  const repo = new SnapshotRepository();
  const service = new LearningService(repo, () => now);
  const save = (text: string) =>
    service.save({
      type: "expression",
      text,
      meaning_ja: text + "の意味",
      example: `I am ${text} a jacket.`,
    });
  const record = (
    id: string,
    outcome: "exposure" | "recognition" | "prompted" | "incorrect",
  ) =>
    service.record({
      item_id: id,
      outcome,
      event_id: randomUUID(),
      context: "test answer",
    });
  return {
    repo,
    service,
    save,
    record,
    time: (value: string) => {
      now = new Date(value);
    },
  };
}

test("daily plan reads only, counts distinct assessed items and separates recognition from production", () => {
  const { repo, service, save, record } = setup();
  assert.equal(service.todayLearning().plan.next_mode, null);
  const a = save("looking for");
  const b = save("waiting for");
  record(a.id, "exposure");
  assert.equal(service.todayLearning().plan.reviewed, 0);
  record(a.id, "recognition");
  record(a.id, "prompted");
  record(b.id, "incorrect");
  const before = repo.snapshot();
  const plan = service.todayLearning().plan;
  assert.equal(plan.reviewed, 2);
  assert.equal(plan.recognized, 1);
  assert.equal(plan.produced, 1);
  assert.equal(plan.target, 5);
  assert.deepEqual(repo.snapshot(), before);
});

test("review times are respected in menu and new choices; completed modes remain accessible", () => {
  const { service, save, record } = setup();
  const a = save("looking for");
  record(a.id, "prompted");
  const today = service.todayLearning();
  assert.ok(
    today.menu.every((entry) => !entry.available && entry.status === "waiting"),
  );
  assert.equal(today.plan.next_mode, null);
  assert.ok(today.plan.next_review_at);
  assert.equal(
    service.startChoice([{ item_id: a.id, meanings: ["a", "b", "c"] }]),
    null,
  );
});

test("recognized expressions move toward recall when due, while unfinished work takes precedence", () => {
  const { service, save, record, time } = setup();
  const a = save("looking for");
  record(a.id, "recognition");
  time("2026-10-17T00:00:00Z");
  assert.equal(service.todayLearning().plan.next_mode, "free_recall");
  service.startPractice({ mode: "flashcard" });
  assert.equal(service.todayLearning().plan.next_mode, "flashcard");
  assert.match(service.todayLearning().plan.reason, /途中/);
  time("2026-10-18T00:00:00Z");
  assert.equal(service.todayLearning().plan.next_mode, "flashcard");
});

test("latest error gets priority after its due time, older recovered failures do not", () => {
  const { service, save, record, time } = setup();
  const older = save("waiting for");
  const missed = save("looking for");
  record(older.id, "incorrect");
  time("2026-10-16T00:01:00Z");
  record(older.id, "prompted");
  record(missed.id, "incorrect");
  assert.equal(service.todayLearning().plan.mistakes_due, 0);
  time("2026-10-18T00:00:00Z");
  assert.equal(service.todayLearning().plan.mistakes_due, 1);
  assert.equal(service.practiceDue()[0]!.id, missed.id);
  assert.equal(service.todayLearning().plan.next_mode, "sentences");
  service.startPractice({ mode: "free_recall" });
  assert.equal(
    service.getQuiz()!.current!.expected_answer_for_grading_only,
    missed.text,
  );
});

test("daily counts roll over at Tokyo midnight and remain account isolated", () => {
  const { service, save, record, time } = setup();
  const a = save("looking for");
  time("2026-10-16T14:59:59Z");
  record(a.id, "prompted");
  assert.equal(service.todayLearning().plan.reviewed, 1);
  time("2026-10-16T15:00:00Z");
  assert.equal(service.todayLearning().date, "2026-10-17");
  assert.equal(service.todayLearning().plan.reviewed, 0);
  const database = new SqliteRepository(":memory:");
  try {
    const owner = new LearningService(database.forUser("oauth:owner"));
    owner.save({ type: "word", text: "hello", meaning_ja: "こんにちは" });
    const other = new LearningService(database.forUser("oauth:other"));
    assert.equal(other.todayLearning().plan.reviewed, 0);
    assert.equal(other.todayLearning().plan.next_mode, null);
    assert.equal(owner.todayLearning().plan.next_mode, "flashcard");
  } finally {
    database.close();
  }
});

test("working-holiday chunks retain verb/preposition units and saved expressions", () => {
  assert.ok(
    chunkSentence("I am looking for a jacket.").includes("looking for"),
  );
  assert.ok(
    chunkSentence("I am interested in music.").includes("interested in"),
  );
  assert.ok(chunkSentence("Can I try it on?").includes("try it on?"));
  assert.ok(
    chunkSentence(
      "I often hang out with my friends.",
      "hang out with my friends",
    ).includes("hang out with my friends."),
  );
  assert.equal(
    chunkSentence("I am looking for a jacket.").join(" "),
    "I am looking for a jacket.",
  );
});
