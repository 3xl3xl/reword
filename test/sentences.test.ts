import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LearningService } from "../src/service.js";
import { SqliteRepository } from "../src/storage/sqlite.js";
import { SnapshotRepository } from "../src/storage/snapshot.js";
import { OpenAISpeechProvider } from "../src/features/audio/speech.js";

test("sentence session survives restart, hides solutions, records actual attempts exactly once and completes five questions", () => {
  const dir = mkdtempSync(join(tmpdir(), "reword-sentence-"));
  let repo = new SqliteRepository(join(dir, "db"));
  let service = new LearningService(repo);
  try {
    const word = service.save({
      type: "word",
      text: "scatter",
      synonyms: ["disperse"],
      example: "My progress feels scattered.",
    });
    let session = service.startStarterSentences("hard")!;
    assert.equal(session.total, 5);
    assert.equal(service.stats().total, 6);
    assert.equal(service.stats().successful_uses, 0);
    assert.deepEqual(service.startStarterSentences("personal"), session);
    assert.equal(JSON.stringify(session).includes('"expected"'), false);
    assert.equal(session.current!.sentence, undefined);
    assert.equal(session.current!.hint, undefined);
    assert.equal(
      new LearningService(repo.forUser("oauth:b")).getSentences(),
      null,
    );
    const ids = repo.getSentences()!.questions[0]!.expected;
    const action = (kind: "draft" | "check" | "next", blocks: string[]) => ({
      session_id: session.session_id,
      question_id: session.current!.question_id,
      revision: session.revision,
      request_id: randomUUID(),
      action: kind,
      block_ids: blocks,
    });
    const draft = action("draft", ids.slice(0, 2));
    session = service.sentenceAction(draft)!;
    repo.close();
    repo = new SqliteRepository(join(dir, "db"));
    service = new LearningService(repo);
    assert.deepEqual(service.getSentences(), session);
    assert.deepEqual(service.review(word.id).item.synonyms, ["disperse"]);
    assert.deepEqual(service.sentenceAction(draft), session);
    assert.throws(
      () => service.sentenceAction({ ...draft, block_ids: [] }),
      /differently/,
    );
    assert.throws(
      () => service.sentenceAction({ ...draft, request_id: randomUUID() }),
      /changed/,
    );
    assert.throws(
      () => service.sentenceAction(action("check", ids.slice(1))),
      /every block/,
    );
    assert.throws(
      () => service.sentenceAction(action("draft", [ids[0]!, ids[0]!])),
      /Invalid blocks/,
    );
    assert.throws(() => service.sentenceAction(action("next", [])), /Complete/);
    const wrong = action("check", [...ids].reverse());
    session = service.sentenceAction(wrong)!;
    assert.equal(service.stats().failed_uses, 1);
    assert.equal(session.current!.hint, undefined);
    assert.equal(session.current!.sentence, undefined);
    service.sentenceAction(wrong);
    assert.equal(service.stats().failed_uses, 1);
    session = service.sentenceAction(action("check", [...ids].reverse()))!;
    assert.match(session.current!.hint!, /Start with/);
    assert.equal(service.stats().failed_uses, 1);
    session = service.sentenceAction(action("check", ids))!;
    assert.equal(session.current!.correct, true);
    assert.equal(service.stats().successful_uses, 0); // recovery is recognition, not independent fluency
    const recoveredItem = service.review(session.current!.item_ids[0]!).item;
    assert.equal(recoveredItem.mastery_score, 3);
    assert.ok(recoveredItem.next_review_at > recoveredItem.created_at);
    while (!session.completed) {
      if (!session.current!.correct) {
        const expected =
          repo.getSentences()!.questions[repo.getSentences()!.index]!.expected;
        session = service.sentenceAction(action("check", expected))!;
      }
      session = service.sentenceAction(action("next", []))!;
    }
    assert.equal(session.answered, 5);
    assert.equal(session.first_try, 4);
    assert.equal(service.review(word.id).item.successful_uses, 1);
    assert.match(service.review(word.id).history[0]!.context, /feel scattered/);
    assert.equal(service.review(word.id).history[0]!.outcome, "prompted");
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prepared personal lessons require owned saved items and accept duplicate words as distinct blocks", () => {
  const repo = new SnapshotRepository();
  const service = new LearningService(repo);
  const item = service.save({
    type: "correction",
    text: "I want to go to Europe.",
    original_sentence: "I want go Europe",
  });
  const question = {
    prompt: "ヨーロッパに行きたい",
    blocks: ["I", "want", "to", "go", "to", "Europe."],
    item_ids: [item.id],
  };
  assert.throws(
    () =>
      service.prepareSentences({
        questions: Array(5).fill({ ...question, item_ids: [randomUUID()] }),
      }),
    /not found/,
  );
  assert.equal(service.getSentences(), null);
  const session = service.prepareSentences({
    questions: Array(5).fill(question),
  })!;
  const expected = [...repo.getSentences()!.questions[0]!.expected];
  [expected[2], expected[4]] = [expected[4]!, expected[2]!];
  const result = service.sentenceAction({
    session_id: session.session_id,
    question_id: session.current!.question_id,
    revision: 0,
    request_id: randomUUID(),
    action: "check",
    block_ids: expected,
  })!;
  assert.equal(result.current!.correct, true);
  assert.equal(service.review(item.id).history.length, 1);
});

test("speech provider keeps credentials server-side, chooses phrase speed and fails closed", async () => {
  let body: Record<string, unknown> = {};
  const provider = new OpenAISpeechProvider("test-key", "cedar", (async (
    _url,
    options,
  ) => {
    body = JSON.parse(options!.body as string);
    assert.equal(
      (options!.headers as Record<string, string>).Authorization,
      "Bearer test-key",
    );
    return new Response(new Uint8Array([1, 2]), {
      headers: { "Content-Type": "audio/mpeg" },
    });
  }) as typeof fetch);
  assert.deepEqual(
    await provider.synthesize("scattered", "word"),
    new Uint8Array([1, 2]),
  );
  assert.equal(body.speed, 0.85);
  assert.equal(body.model, "gpt-4o-mini-tts");
  await provider.synthesize("I want to learn.", "sentence");
  assert.equal(body.speed, 1);
  await assert.rejects(
    new OpenAISpeechProvider(
      "test-key",
      "cedar",
      (async () => new Response("", { status: 503 })) as typeof fetch,
    ).synthesize("word", "word"),
    /unavailable/,
  );
});
