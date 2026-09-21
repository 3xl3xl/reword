import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LearningService } from "../src/service.js";
import { SqliteRepository } from "../src/storage/sqlite.js";
import { SnapshotRepository } from "../src/storage/snapshot.js";
import { quizSlot } from "../src/quiz.js";

test("quiz persists across restart, isolates users, rejects conflicts and resumes across slots", () => {
  const dir = mkdtempSync(join(tmpdir(), "reword-quiz-"));
  let repo = new SqliteRepository(join(dir, "db"));
  let now = new Date("2026-09-22T00:00:00Z");
  let service = new LearningService(repo, () => now);
  try {
    for (const [text, meaning_ja] of [
      ["apple", "りんご"],
      ["pear", "梨"],
      ["grape", "ぶどう"],
    ])
      service.save({ text: text!, meaning_ja: meaning_ja!, type: "word" });
    const quiz = service.startQuiz()!;
    assert.equal(quiz.total, 3);
    assert.deepEqual(service.startQuiz(), quiz);
    const answer = {
      quiz_id: quiz.quiz_id,
      question_id: quiz.current!.question_id,
      answer: "apple",
      outcome: "prompted" as const,
    };
    service.answerQuiz(answer);
    repo.close();
    repo = new SqliteRepository(join(dir, "db"));
    service = new LearningService(repo, () => now);
    assert.equal(service.getQuiz()!.answered, 1);
    service.answerQuiz(answer);
    assert.equal(service.stats().successful_uses, 1);
    assert.throws(
      () => service.answerQuiz({ ...answer, answer: "different" }),
      /differently/,
    );
    assert.equal(new LearningService(repo.forUser("oauth:b")).getQuiz(), null);
    now = new Date("2026-09-22T13:00:00Z");
    assert.equal(service.startQuiz()!.quiz_id, quiz.quiz_id);
    while (!service.getQuiz()!.completed) {
      const state = service.getQuiz()!;
      service.answerQuiz({
        quiz_id: state.quiz_id,
        question_id: state.current!.question_id,
        answer: "test incorrect response",
        outcome: "incorrect",
      });
    }
    const next = service.startQuiz()!;
    assert.notEqual(next.quiz_id, quiz.quiz_id);
    assert.equal(service.startQuiz()!.quiz_id, next.quiz_id);
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("legacy snapshots and Tokyo schedule boundaries", () => {
  const repo = new SnapshotRepository({ version: 1, items: [], events: [] });
  assert.equal(new LearningService(repo).startQuiz(), null);
  assert.equal(
    quizSlot(new Date("2026-09-21T22:59:59Z")),
    "2026-09-21T22:00+09:00",
  );
  assert.equal(
    quizSlot(new Date("2026-09-21T23:00:00Z")),
    "2026-09-22T08:00+09:00",
  );
  assert.equal(
    quizSlot(new Date("2026-09-22T13:00:00Z")),
    "2026-09-22T22:00+09:00",
  );
});
