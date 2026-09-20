import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRepository } from "../src/storage/sqlite.js";
import { LearningService } from "../src/service.js";
import { schedule } from "../src/domain.js";
function fixture(t: { after(fn: () => void): void }) {
  const repo = new SqliteRepository(":memory:");
  t.after(() => repo.close());
  const now = new Date("2026-09-20T00:00:00Z");
  return { repo, now, service: new LearningService(repo, () => now) };
}
test("save → due → exposure → independent use → later review; retry is idempotent", (t) => {
  const { service, now, repo } = fixture(t);
  const item = service.save({
    text: "creeping in",
    type: "expression",
    meaning_en: "appearing gradually",
    original_context: "guilt and anxiety",
  });
  assert.equal(service.due()[0]?.id, item.id);
  assert.equal(service.conversation("anxiety")[0]?.id, item.id);
  const exposed = service.record({
    item_id: item.id,
    event_id: randomUUID(),
    outcome: "exposure",
    context: "Do you feel guilt creeping in?",
  });
  assert.equal(exposed.mastery_score, 0);
  assert.equal(exposed.next_review_at, item.next_review_at);
  assert.equal(service.conversation("anxiety").length, 0);
  const event = {
    item_id: item.id,
    event_id: randomUUID(),
    outcome: "independent" as const,
    context: "I can feel anxiety creeping in.",
  };
  const updated = service.record(event);
  assert.equal(updated.successful_uses, 1);
  assert.equal(updated.mastery_score, 20);
  assert.equal(
    Date.parse(updated.next_review_at) - now.getTime(),
    24 * 3600000,
  );
  assert.equal(service.due().length, 0);
  assert.equal(service.record(event).successful_uses, 1);
  assert.equal(repo.history(item.id).length, 2);
  assert.throws(
    () => service.record({ ...event, outcome: "incorrect" }),
    /different event/,
  );
});
test("failure shortens a previously earned interval and records difficulty", (t) => {
  const { service, repo } = fixture(t);
  const item = service.save({ text: "vacant", type: "word" });
  const good = service.record({
    item_id: item.id,
    event_id: randomUUID(),
    outcome: "independent",
    context: "The room is vacant.",
  });
  const bad = service.record({
    item_id: item.id,
    event_id: randomUUID(),
    outcome: "incorrect",
    context: "I vacant the room yesterday.",
  });
  assert.equal(bad.failed_uses, 1);
  assert.equal(bad.mastery_score, 0);
  assert.ok(bad.next_review_at < good.next_review_at);
  assert.equal(repo.history(item.id)[0]?.outcome, "incorrect");
});
test("normalization deduplicates without resetting progress, bounds validate, unknown IDs fail", (t) => {
  const { service } = fixture(t);
  const item = service.save({ text: " Creeping   In ", type: "expression" });
  assert.equal(
    service.save({ text: "creeping in", type: "expression" }).id,
    item.id,
  );
  assert.throws(() => service.save({ text: "   ", type: "word" }));
  assert.throws(
    () =>
      service.record({
        item_id: randomUUID(),
        event_id: randomUUID(),
        outcome: "independent",
        context: "valid",
      }),
    /not found/,
  );
  assert.equal(service.stats().total, 1);
});
test("personal corrections recur and keep history", (t) => {
  const { service, repo } = fixture(t);
  const item = service.save({
    text: "I felt broken.",
    original_sentence: "I felt a broke myself.",
    type: "correction",
    category: "grammar",
    meaning_en: "Use the adjective broken to describe a feeling.",
  });
  assert.equal(service.conversation("feeling")[0]?.id, item.id);
  for (let i = 0; i < 2; i++)
    service.record({
      item_id: item.id,
      event_id: randomUUID(),
      outcome: "incorrect",
      context: "I felt a broke myself.",
    });
  assert.equal(repo.find(item.id)?.failed_uses, 2);
  assert.equal(repo.history(item.id).length, 2);
  assert.throws(
    () => service.save({ text: "broken", type: "correction" }),
    /original sentence/,
  );
});
test("conversation returns at most three relevant items and nothing unrelated", (t) => {
  const { service } = fixture(t);
  for (let i = 0; i < 6; i++)
    service.save({
      text: `expression ${i}`,
      type: "expression",
      original_context: "work anxiety",
    });
  assert.equal(service.conversation("work anxiety", 50).length, 3);
  assert.equal(service.conversation("cooking dinner").length, 0);
});
test("independent usage outweighs prompted practice; recognition cannot mark learned", (t) => {
  const { service, now } = fixture(t);
  let item = service.save({ text: "vacant", type: "word" });
  assert.ok(
    schedule(item, "independent", now).mastery_score >
      schedule(item, "prompted", now).mastery_score,
  );
  for (let i = 0; i < 50; i++) item = schedule(item, "recognition", now);
  assert.equal(item.status, "learning");
  for (let i = 0; i < 5; i++) item = schedule(item, "independent", now);
  assert.equal(item.status, "learned");
  item = schedule(item, "incorrect", now);
  assert.equal(item.status, "learning");
});
test("SQLite survives reopen and failed transaction rolls back", () => {
  const dir = mkdtempSync(join(tmpdir(), "reword-"));
  const path = join(dir, "data.db");
  let repo = new SqliteRepository(path);
  try {
    const service = new LearningService(repo);
    const item = service.save({ text: "vacant", type: "word" });
    service.record({
      item_id: item.id,
      event_id: randomUUID(),
      outcome: "independent",
      context: "A vacant room.",
    });
    assert.throws(() =>
      repo.transaction(() => {
        repo.put({ ...item, text: "changed" });
        throw new Error("rollback");
      }),
    );
    repo.close();
    repo = new SqliteRepository(path);
    assert.equal(repo.find(item.id)?.text, "vacant");
    assert.equal(repo.find(item.id)?.successful_uses, 1);
    assert.equal(repo.history(item.id).length, 1);
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("editing preserves progress and history, updates identity, and rejects collisions", (t) => {
  const { service, repo, now } = fixture(t);
  const item = service.save({
    text: "creping in",
    type: "expression",
    meaning_en: "gradually appearing",
  });
  const used = service.record({
    item_id: item.id,
    event_id: randomUUID(),
    outcome: "independent",
    context: "Anxiety is creeping in.",
  });
  now.setHours(now.getHours() + 1);
  const edited = service.update({
    item_id: item.id,
    changes: { text: "creeping in", notes: "Anxiety" },
  });
  assert.equal(edited.meaning_en, used.meaning_en);
  assert.equal(edited.mastery_score, used.mastery_score);
  assert.equal(edited.successful_uses, used.successful_uses);
  assert.equal(edited.next_review_at, used.next_review_at);
  assert.equal(edited.created_at, used.created_at);
  assert.notEqual(edited.updated_at, used.updated_at);
  assert.equal(repo.history(item.id).length, 1);
  assert.equal(
    service.save({ text: "CREEPING IN", type: "expression" }).id,
    item.id,
  );
  assert.equal(repo.findNormalized("creping in", "expression"), undefined);
  now.setHours(now.getHours() + 1);
  assert.deepEqual(
    service.update({
      item_id: item.id,
      changes: { text: "creeping in", notes: "Anxiety" },
    }),
    edited,
  );
  const other = service.save({ text: "vacant", type: "expression" });
  assert.throws(
    () => service.update({ item_id: item.id, changes: { text: other.text } }),
    /already has/,
  );
  assert.equal(repo.find(item.id)?.text, "creeping in");
  assert.throws(
    () => service.update({ item_id: item.id, changes: {} }),
    /at least one/,
  );
  assert.throws(
    () => service.update({ item_id: randomUUID(), changes: { notes: "test" } }),
    /not found/,
  );
  assert.throws(() =>
    service.update({
      item_id: item.id,
      changes: { mastery_score: 100 } as never,
    }),
  );
});
test("correction filters paginate after filtering and identify recurring difficulty", (t) => {
  const { service } = fixture(t);
  service.save({ text: "broken", type: "word" });
  const first = service.save({
    text: "I felt broken.",
    type: "correction",
    original_sentence: "I felt a broke myself.",
    category: "grammar",
  });
  const second = service.save({
    text: "I was exhausted.",
    type: "correction",
    original_sentence: "I was exhaust.",
    category: "grammar",
  });
  service.save({
    text: "Make a decision.",
    type: "correction",
    original_sentence: "Do a decision.",
    category: "word choice",
  });
  for (let i = 0; i < 2; i++)
    service.record({
      item_id: first.id,
      event_id: randomUUID(),
      outcome: "incorrect",
      context: "I felt a broke myself.",
    });
  assert.deepEqual(
    service.corrections({ recurring_only: true }).items.map((i) => i.id),
    [first.id],
  );
  assert.equal(
    service.corrections({ recurring_only: true, due_only: true }).total,
    0,
  );
  const page = service.corrections({ category: "grammar", limit: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.next_offset, 1);
  assert.equal(page.items[0]?.id, first.id);
  const next = service.corrections({
    category: "grammar",
    limit: 1,
    offset: page.next_offset!,
  });
  assert.equal(next.items[0]?.id, second.id);
  assert.equal(next.next_offset, null);
  assert.equal(
    service.corrections({ query: " BROKE MYSELF " }).items[0]?.id,
    first.id,
  );
  assert.throws(
    () =>
      service.update({
        item_id: first.id,
        changes: { original_sentence: " " },
      }),
    /original sentence/,
  );
  assert.throws(() => service.corrections({ limit: 51 }));
});
