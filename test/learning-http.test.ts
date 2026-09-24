import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { LearningService } from "../src/service.js";
import { SnapshotRepository } from "../src/storage/snapshot.js";
import { createApp } from "../src/http.js";
test("learning HTTP protects data and solutions; voice only accepts visible content; real quiz answers persist", async () => {
  const repo = new SnapshotRepository();
  const service = new LearningService(repo);
  const hosts: string[] = [];
  const token = "test-user-token";
  let spoken = "";
  const server = createApp(service, {
    token,
    allowedHosts: hosts,
    speech: {
      async synthesize(text) {
        spoken = text;
        return new Uint8Array([1, 2]);
      },
    },
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  hosts.push(new URL(base).host);
  const request = (path: string, data?: unknown, origin = base) =>
    fetch(base + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: origin,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  try {
    assert.equal((await fetch(base + "/api/words")).status, 401);
    const page = await fetch(base + "/learn/");
    assert.equal(page.status, 200);
    assert.match(
      page.headers.get("content-security-policy")!,
      /frame-ancestors 'none'/,
    );
    assert.equal(
      (await request("/api/words", undefined, "https://evil.example")).status,
      403,
    );
    service.save({ type: "word", text: "scatter", meaning_ja: "散らばる" });
    const quiz = await (await request("/api/quiz/start", {})).json();
    assert.equal(JSON.stringify(quiz).includes("grading"), false);
    assert.equal(JSON.stringify(quiz).includes("scatter"), false);
    const result = await (
      await request("/api/quiz/answer", {
        quiz_id: quiz.quiz_id,
        question_id: quiz.current.question_id,
        answer: "scatter",
      })
    ).json();
    assert.equal(result.results[0].outcome, "prompted");
    assert.equal(service.stats().successful_uses, 1);
    assert.equal(
      (await request("/api/sentences/start", { mode: "hard" })).status,
      400,
    );
    let session = await (
      await request("/api/sentences/start", {
        mode: "hard",
        confirm_save: true,
      })
    ).json();
    assert.equal(session.current.sentence, undefined);
    assert.equal(
      (
        await request("/api/speech", {
          session_id: session.session_id,
          question_id: session.current.question_id,
          kind: "sentence",
        })
      ).status,
      409,
    );
    const speech = await request("/api/speech", {
      session_id: session.session_id,
      question_id: session.current.question_id,
      kind: "word",
      block_id: session.current.blocks[0].id,
    });
    assert.equal(speech.status, 200);
    assert.equal(spoken, session.current.blocks[0].text);
    session = await (
      await request("/api/sentences/action", {
        session_id: session.session_id,
        question_id: session.current.question_id,
        revision: 0,
        request_id: randomUUID(),
        action: "check",
        block_ids: repo.getSentences()!.questions[0]!.expected,
      })
    ).json();
    assert.equal(session.current.correct, true);
    assert.equal(
      (
        await request("/api/speech", {
          session_id: session.session_id,
          question_id: session.current.question_id,
          kind: "sentence",
        })
      ).status,
      200,
    );
    assert.equal(spoken, session.current.sentence);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
