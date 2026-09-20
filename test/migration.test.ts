import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SqliteRepository } from "../src/storage/sqlite.js";
import { LearningService } from "../src/service.js";
test("v1 migration preserves local vocabulary and history without assigning it to OAuth users", () => {
  const dir = mkdtempSync(join(tmpdir(), "reword-migration-"));
  const path = join(dir, "legacy.db");
  const source = new SqliteRepository(":memory:");
  const service = new LearningService(source);
  const item = service.save({ text: "vacant", type: "word" });
  service.record({
    item_id: item.id,
    event_id: randomUUID(),
    outcome: "independent",
    context: "A vacant room.",
  });
  const saved = source.find(item.id)!;
  const event = source.history(item.id)[0]!;
  source.close();
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE migrations(version INTEGER PRIMARY KEY);INSERT INTO migrations VALUES(1);
 CREATE TABLE items(id TEXT PRIMARY KEY,normalized_text TEXT,type TEXT,data TEXT);
 CREATE TABLE usage_events(event_id TEXT PRIMARY KEY,item_id TEXT REFERENCES items(id),data TEXT);`);
  legacy
    .prepare("INSERT INTO items VALUES(?,?,?,?)")
    .run(saved.id, saved.normalized_text, saved.type, JSON.stringify(saved));
  legacy
    .prepare("INSERT INTO usage_events VALUES(?,?,?)")
    .run(event.event_id, event.item_id, JSON.stringify(event));
  legacy.close();
  try {
    for (let i = 0; i < 2; i++) {
      const repo = new SqliteRepository(path);
      try {
        assert.deepEqual(repo.find(item.id), saved);
        assert.deepEqual(repo.history(item.id), [event]);
        const tenant = repo.forUser("oauth:test");
        assert.equal(tenant.list().length, 0);
        assert.equal(tenant.find(item.id), undefined);
        assert.equal(tenant.event(event.event_id), undefined);
        assert.deepEqual(tenant.history(item.id), []);
        assert.throws(() => tenant.addEvent(event));
        tenant.close();
        assert.equal(repo.healthy(), true);
      } finally {
        repo.close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
