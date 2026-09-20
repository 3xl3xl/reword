import { Pool } from "pg";
import { PostgresStore } from "./storage/postgres.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
  max: 1,
});
try {
  await new PostgresStore(pool).migrate();
  console.log("Postgres schema ready.");
} catch {
  console.error(
    "Database migration failed. Verify DATABASE_URL and database permissions.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
