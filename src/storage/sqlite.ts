import type { Quiz } from "../quiz.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Item, Usage } from "../domain.js";
import type { Repository } from "./repository.js";
export class SqliteRepository implements Repository {
  private db: DatabaseSync;
  private ownsConnection = true;
  constructor(
    path: string,
    private readonly owner = "local",
    connection?: DatabaseSync,
  ) {
    if (connection) {
      this.db = connection;
      this.ownsConnection = false;
      return;
    }
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);`,
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS tenant_quizzes(owner TEXT PRIMARY KEY, data TEXT NOT NULL)",
    );
    this.transaction(() => {
      if (
        !this.db.prepare("SELECT version FROM migrations WHERE version=1").get()
      ) {
        this.db.exec(`
          CREATE TABLE items(id TEXT PRIMARY KEY, normalized_text TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(normalized_text,type));
          CREATE TABLE usage_events(event_id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id), data TEXT NOT NULL);
          CREATE INDEX usage_item ON usage_events(item_id);
          INSERT INTO migrations VALUES(1);
        `);
      }
      if (
        !this.db.prepare("SELECT version FROM migrations WHERE version=2").get()
      ) {
        this.db.exec(`
          CREATE TABLE tenant_items(owner TEXT NOT NULL, id TEXT NOT NULL, normalized_text TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,id), UNIQUE(owner,normalized_text,type));
          CREATE TABLE tenant_events(owner TEXT NOT NULL, event_id TEXT NOT NULL, item_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,event_id), FOREIGN KEY(owner,item_id) REFERENCES tenant_items(owner,id));
          CREATE INDEX tenant_usage_item ON tenant_events(owner,item_id);
          INSERT INTO tenant_items SELECT 'local', id, normalized_text, type, data FROM items;
          INSERT INTO tenant_events SELECT 'local', event_id, item_id, data FROM usage_events;
          DROP TABLE usage_events;
          DROP TABLE items;
          INSERT INTO migrations VALUES(2);
        `);
      }
    });
  }
  forUser(owner: string): SqliteRepository {
    if (!owner.startsWith("oauth:") || owner.length > 100)
      throw new Error("Invalid authenticated owner.");
    return new SqliteRepository("", owner, this.db);
  }
  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private decode<T>(row: Record<string, unknown> | undefined): T | undefined {
    return row ? (JSON.parse(row.data as string) as T) : undefined;
  }
  find(id: string) {
    return this.decode<Item>(
      this.db
        .prepare("SELECT data FROM tenant_items WHERE owner=? AND id=?")
        .get(this.owner, id),
    );
  }
  findNormalized(text: string, type: Item["type"]) {
    return this.decode<Item>(
      this.db
        .prepare(
          "SELECT data FROM tenant_items WHERE owner=? AND normalized_text=? AND type=?",
        )
        .get(this.owner, text, type),
    );
  }
  list() {
    return this.db
      .prepare("SELECT data FROM tenant_items WHERE owner=? ORDER BY id")
      .all(this.owner)
      .map((row) => this.decode<Item>(row)!);
  }
  put(item: Item) {
    this.db
      .prepare(
        "INSERT INTO tenant_items VALUES(?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET normalized_text=excluded.normalized_text, type=excluded.type, data=excluded.data",
      )
      .run(
        this.owner,
        item.id,
        item.normalized_text,
        item.type,
        JSON.stringify(item),
      );
  }
  event(id: string) {
    return this.decode<Usage>(
      this.db
        .prepare("SELECT data FROM tenant_events WHERE owner=? AND event_id=?")
        .get(this.owner, id),
    );
  }
  addEvent(event: Usage) {
    this.db
      .prepare("INSERT INTO tenant_events VALUES(?,?,?,?)")
      .run(this.owner, event.event_id, event.item_id, JSON.stringify(event));
  }
  history(id: string) {
    return this.db
      .prepare(
        "SELECT data FROM tenant_events WHERE owner=? AND item_id=? ORDER BY rowid DESC LIMIT 100",
      )
      .all(this.owner, id)
      .map((row) => this.decode<Usage>(row)!);
  }
  getQuiz() {
    return this.decode<Quiz>(
      this.db
        .prepare("SELECT data FROM tenant_quizzes WHERE owner=?")
        .get(this.owner),
    );
  }
  putQuiz(quiz: Quiz) {
    this.db
      .prepare(
        "INSERT INTO tenant_quizzes VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data",
      )
      .run(this.owner, JSON.stringify(quiz));
  }
  healthy() {
    return !!this.db.prepare("SELECT 1").get();
  }
  close() {
    if (this.ownsConnection) this.db.close();
  }
}
