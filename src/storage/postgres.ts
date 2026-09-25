import { LearningService } from "../service.js";
import type { LearningApi } from "../learning-api.js";
import { SnapshotRepository, type Snapshot } from "./snapshot.js";
// A transaction receives a dedicated connection, never pool.query across BEGIN/COMMIT.
export interface SqlConnection {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}
export interface SqlPool {
  connect(): Promise<SqlConnection & { release(): void }>;
}
export const schema = `CREATE TABLE IF NOT EXISTS reword_accounts (
  owner TEXT PRIMARY KEY,
  state JSONB NOT NULL DEFAULT '{"version":1,"items":[],"events":[]}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;
export class PostgresStore {
  constructor(private pool: SqlPool) {}
  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(724391)");
      await client.query(schema);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async healthy() {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT owner FROM reword_accounts LIMIT 0");
      return true;
    } finally {
      client.release();
    }
  }
  forUser(owner: string): LearningApi {
    if (owner !== "local" && !/^oauth:[a-f0-9]{64}$/.test(owner))
      throw new Error("Invalid owner");
    const invoke = async <K extends Exclude<keyof LearningApi, "healthy">>(
      method: K,
      args: Parameters<LearningService[K]>,
      write = false,
    ): Promise<ReturnType<LearningService[K]>> => {
      const client = await this.pool.connect();
      try {
        if (write) {
          await client.query("BEGIN");
          await client.query("SET LOCAL lock_timeout = '5s'");
          await client.query(
            "INSERT INTO reword_accounts(owner) VALUES($1) ON CONFLICT(owner) DO NOTHING",
            [owner],
          );
        }
        const result = await client.query(
          "SELECT state FROM reword_accounts WHERE owner=$1" +
            (write ? " FOR UPDATE" : ""),
          [owner],
        );
        const repo = new SnapshotRepository(
          result.rows[0]?.state as Snapshot | undefined,
        );
        const service = new LearningService(repo);
        const resultValue = (
          service[method] as (
            ...parameters: Parameters<LearningService[K]>
          ) => ReturnType<LearningService[K]>
        )(...args);
        if (write) {
          await client.query(
            "UPDATE reword_accounts SET state=$2::jsonb,updated_at=now() WHERE owner=$1",
            [owner, JSON.stringify(repo.snapshot())],
          );
          await client.query("COMMIT");
        }
        return resultValue;
      } catch (error) {
        if (write) await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
    return {
      startPractice: (...args) => invoke("startPractice", args, true),
      getPractice: (...args) => invoke("getPractice", args),
      answerPractice: (...args) => invoke("answerPractice", args, true),
      getSentences: (...args) => invoke("getSentences", args),
      prepareSentences: (...args) => invoke("prepareSentences", args, true),
      startStarterSentences: (...args) =>
        invoke("startStarterSentences", args, true),
      sentenceAction: (...args) => invoke("sentenceAction", args, true),
      todayLearning: (...args) => invoke("todayLearning", args),
      learningMaterial: (...args) => invoke("learningMaterial", args),
      getActivity: (...args) => invoke("getActivity", args),
      startChoice: (...args) => invoke("startChoice", args, true),
      prepareActivity: (...args) => invoke("prepareActivity", args, true),
      answerActivity: (...args) => invoke("answerActivity", args, true),
      getQuiz: (...args) => invoke("getQuiz", args),
      startQuiz: (...args) => invoke("startQuiz", args, true),
      answerQuiz: (...args) => invoke("answerQuiz", args, true),
      save: (...args) => invoke("save", args, true),
      update: (...args) => invoke("update", args, true),
      record: (...args) => invoke("record", args, true),
      corrections: (...args) => invoke("corrections", args),
      list: (...args) => invoke("list", args),
      due: (...args) => invoke("due", args),
      conversation: (...args) => invoke("conversation", args),
      stats: (...args) => invoke("stats", args),
      review: (...args) => invoke("review", args),
      healthy: () => this.healthy(),
    };
  }
}
