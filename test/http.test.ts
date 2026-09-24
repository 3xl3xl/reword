import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { get } from "node:http";
import { smoke } from "../src/smoke.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SqliteRepository } from "../src/storage/sqlite.js";
import { LearningService } from "../src/service.js";
import { createApp } from "../src/http.js";
import type { AddressInfo } from "node:net";
test("real Streamable HTTP client completes learning loop and HTTP enforces boundaries", async () => {
  const repo = new SqliteRepository(":memory:");
  const hosts: string[] = [];
  const token = "test-secret-with-at-least-32-characters";
  const server = createApp(new LearningService(repo), {
    token,
    allowedHosts: hosts,
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const authority = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  hosts.push(authority);
  const base = `http://${authority}`;
  const client = new Client({ name: "reword-test", version: "1.0.0" });
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.deepEqual(await smoke(`${base}/mcp`, token), {
      health: "ok",
      mcp: "ok",
      tools: 25,
      authenticated: true,
    });
    assert.equal(new LearningService(repo).stats().total, 0);
    await assert.rejects(smoke(`${base}/mcp`), /Authentication is required/);
    await assert.rejects(smoke("http://remote.example/mcp"), /HTTPS/);
    assert.equal((await fetch(`${base}/mcp`, { method: "POST" })).status, 401);
    assert.equal(
      (
        await fetch(`${base}/mcp`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
      405,
    );
    assert.equal(
      (
        await fetch(`${base}/health`, {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      await new Promise<number | undefined>((resolve, reject) => {
        get(`${base}/health`, { headers: { Host: "evil.example" } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        }).on("error", reject);
      }),
      403,
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    assert.equal((await client.listTools()).tools.length, 25);
    async function call(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      return JSON.parse((result.content as { text: string }[])[0]!.text);
    }
    const item = await call("save_expression", {
      text: "creeping in",
      meaning_en: "appearing gradually",
      original_context: "anxiety",
    });
    assert.equal((await call("get_due_words"))[0].id, item.id);
    assert.equal(
      (await call("get_words_for_conversation", { topic: "anxiety" }))[0].id,
      item.id,
    );
    const updated = await call("record_usage", {
      item_id: item.id,
      event_id: randomUUID(),
      outcome: "independent",
      context: "Anxiety is creeping in.",
    });
    assert.equal(updated.successful_uses, 1);
    assert.equal(updated.mastery_score, 20);
    assert.ok(updated.next_review_at > item.next_review_at);
    assert.equal((await call("get_due_words")).length, 0);
    const correction = await call("save_correction", {
      text: "I felt broken.",
      original_sentence: "I felt a broke myself.",
      category: "grammar",
    });
    await call("update_learning_item", {
      item_id: correction.id,
      changes: { notes: "Practice feelings in natural conversation." },
    });
    const corrections = await call("get_corrections", {
      category: "grammar",
      query: "broken",
    });
    assert.equal(corrections.total, 1);
    assert.equal(
      corrections.items[0].notes,
      "Practice feelings in natural conversation.",
    );
    const invalid = await client.callTool({
      name: "record_usage",
      arguments: {
        item_id: item.id,
        event_id: randomUUID(),
        outcome: "incorrect",
        context: "",
      },
    });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    repo.close();
  }
});
