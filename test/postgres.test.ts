import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PostgresStore, type SqlPool } from "../src/storage/postgres.js";
import { createApp } from "../src/http.js";
import { smoke } from "../src/smoke.js";
import type { AddressInfo } from "node:net";

test("Postgres SQL learning loop, rollback, idempotency and isolated users", async () => {
  const db = new PGlite();
  // PGlite has one connection; serialize complete transactions like a pool of size one.
  let tail = Promise.resolve();
  const pool: SqlPool = {
    async connect() {
      let release!: () => void;
      const before = tail;
      tail = new Promise<void>((resolve) => (release = resolve));
      await before;
      return {
        query: (sql, values) => db.query<Record<string, unknown>>(sql, values),
        release,
      };
    },
  };
  const store = new PostgresStore(pool);
  try {
    await store.migrate();
    await store.migrate();
    assert.equal(await store.healthy(), true);
    const alice = store.forUser("oauth:" + "a".repeat(64));
    const bob = store.forUser("oauth:" + "b".repeat(64));
    const [item, duplicate] = await Promise.all([
      alice.save({ text: "creeping in", type: "expression" }),
      alice.save({ text: "CREEPING IN", type: "expression" }),
    ]);
    assert.equal(item.id, duplicate.id);
    assert.equal((await alice.due())[0]?.id, item.id);
    const event = {
      item_id: item.id,
      event_id: randomUUID(),
      outcome: "independent" as const,
      context: "Anxiety is creeping in.",
    };
    await Promise.all([alice.record(event), alice.record(event)]);
    assert.equal((await alice.stats()).successful_uses, 1);
    assert.equal((await alice.due()).length, 0);
    await assert.rejects(
      Promise.resolve(alice.record({ ...event, outcome: "incorrect" })),
      /different event/,
    );
    assert.equal((await alice.review(item.id)).history.length, 1);
    const bad = await alice.record({
      ...event,
      event_id: randomUUID(),
      outcome: "incorrect",
    });
    assert.equal(bad.failed_uses, 1);
    assert.equal((await bob.list()).length, 0);
    await assert.rejects(Promise.resolve(bob.review(item.id)), /not found/);
    await assert.rejects(
      Promise.resolve(
        bob.update({ item_id: item.id, changes: { notes: "cross-user" } }),
      ),
      /not found/,
    );
    await alice.update({ item_id: item.id, changes: { notes: "feelings" } });
    assert.equal(
      (await store.forUser("oauth:" + "a".repeat(64)).review(item.id)).item
        .notes,
      "feelings",
    );
    const correction = await alice.save({
      type: "correction",
      text: "I felt broken.",
      original_sentence: "I felt a broke myself.",
    });
    assert.equal((await alice.corrections()).items[0]?.id, correction.id);
    await alice.save({
      text: "durable",
      type: "word",
      meaning_ja: "長持ちする",
    });
    const [quiz, sameQuiz] = await Promise.all([
      alice.startQuiz(),
      alice.startQuiz(),
    ]);
    assert.equal(quiz!.quiz_id, sameQuiz!.quiz_id);
    const reopened = new PostgresStore(pool).forUser("oauth:" + "a".repeat(64));
    assert.deepEqual(await reopened.getQuiz(), quiz);
    assert.equal(await bob.getQuiz(), null);
    const quizAnswer = {
      quiz_id: quiz!.quiz_id,
      question_id: quiz!.current!.question_id,
      answer: "durable",
      outcome: "prompted" as const,
    };
    await Promise.all([
      reopened.answerQuiz(quizAnswer),
      alice.answerQuiz(quizAnswer),
    ]);
    assert.equal((await reopened.getQuiz())!.answered, 1);
    await assert.rejects(
      Promise.resolve(bob.answerQuiz(quizAnswer)),
      /not found/,
    );
    const [sentence, resumed] = await Promise.all([
      alice.startStarterSentences("hard"),
      alice.startStarterSentences("hard"),
    ]);
    assert.equal(sentence!.session_id, resumed!.session_id);
    assert.deepEqual(await reopened.getSentences(), sentence);
    assert.equal(await bob.getSentences(), null);
    const sentenceDraft = {
      session_id: sentence!.session_id,
      question_id: sentence!.current!.question_id,
      revision: 0,
      request_id: randomUUID(),
      action: "draft" as const,
      block_ids: [sentence!.current!.blocks[0]!.id],
    };
    const [drafted, retried] = await Promise.all([
      alice.sentenceAction(sentenceDraft),
      reopened.sentenceAction(sentenceDraft),
    ]);
    assert.deepEqual(drafted, retried);
    assert.equal(drafted!.revision, 1);
    await assert.rejects(
      Promise.resolve(bob.sentenceAction(sentenceDraft)),
      /not found/,
    );
    const hosts: string[] = [];
    const token = "test-secret-with-at-least-32-characters";
    const server = createApp(alice, { allowedHosts: hosts, token }).listen(
      0,
      "127.0.0.1",
    );
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const authority = `127.0.0.1:${(server.address() as AddressInfo).port}`;
    hosts.push(authority);
    try {
      assert.equal((await smoke(`http://${authority}/mcp`, token)).mcp, "ok");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await db.close();
  }
});
