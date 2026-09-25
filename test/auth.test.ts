import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { createOAuth } from "../src/auth.js";
import { SqliteRepository } from "../src/storage/sqlite.js";
import { LearningService } from "../src/service.js";
import { createApp } from "../src/http.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";

const config = {
  issuer: "https://identity.example.com/",
  resource: "https://reword.example.com/mcp",
  jwksUrl: "https://identity.example.com/jwks",
};
async function authFixture() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const oauth = createOAuth(
    config,
    createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), kid: "test" }],
    }),
  );
  async function token(
    subject = "alice",
    claims: Record<string, unknown> = {},
    typ = "at+jwt",
  ) {
    return new SignJWT({
      iss: config.issuer,
      aud: config.resource,
      sub: subject,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      client_id: "test-client",
      jti: randomUUID(),
      scope: "reword",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test", typ })
      .sign(privateKey);
  }
  return { oauth, token };
}
test("OAuth validates signature, issuer, resource audience, lifetime, token type and stable identity", async () => {
  const { oauth, token } = await authFixture();
  const first = await oauth.verifier.verifyAccessToken(await token());
  const second = await oauth.verifier.verifyAccessToken(await token());
  assert.equal(first.extra?.owner, second.extra?.owner);
  assert.notEqual(
    first.extra?.owner,
    (await oauth.verifier.verifyAccessToken(await token("bob"))).extra?.owner,
  );
  for (const claims of [
    { iss: "https://evil.example/" },
    { aud: "another-service" },
    { exp: 0 },
    { nbf: Math.floor(Date.now() / 1000) + 500 },
    { sub: "" },
    { exp: undefined },
    { client_id: undefined },
    { iat: Math.floor(Date.now() / 1000) + 500 },
  ])
    await assert.rejects(
      oauth.verifier.verifyAccessToken(await token("alice", claims)),
    );
  await assert.rejects(
    oauth.verifier.verifyAccessToken(await token("alice", {}, "JWT")),
  );
  const foreign = await authFixture();
  await assert.rejects(oauth.verifier.verifyAccessToken(await foreign.token()));
  await assert.rejects(oauth.verifier.verifyAccessToken("not-a-jwt"));
  assert.throws(
    () => createOAuth({ ...config, jwksUrl: "http://identity.example/jwks" }),
    /HTTPS/,
  );
});
test("OAuth discovery, scope rejection and isolation through real MCP calls", async () => {
  const { oauth, token } = await authFixture();
  const repo = new SqliteRepository(":memory:");
  const local = new LearningService(repo);
  local.save({ text: "local secret", type: "expression" });
  const hosts: string[] = [];
  const server = createApp(local, {
    oauth,
    allowedHosts: hosts,
    serviceForOwner: (owner) => new LearningService(repo.forUser(owner)),
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const authority = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  hosts.push(authority);
  const base = `http://${authority}`;
  const clients: Client[] = [];
  try {
    const metadata = await (
      await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)
    ).json();
    assert.equal(metadata.resource, config.resource);
    assert.deepEqual(metadata.authorization_servers, [config.issuer]);
    const unauthorized = await fetch(`${base}/mcp`, { method: "POST" });
    assert.equal(unauthorized.status, 401);
    assert.ok(
      unauthorized.headers
        .get("www-authenticate")
        ?.includes("resource_metadata="),
    );
    const insufficient = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await token("alice", { scope: "other" })}`,
      },
    });
    assert.equal(insufficient.status, 403);
    assert.ok(
      insufficient.headers.get("www-authenticate")?.includes('scope="reword"'),
    );
    assert.equal(
      (
        await fetch(`${base}/mcp`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await token("alice", { aud: "wrong" })}`,
          },
        })
      ).status,
      401,
    );
    async function connect(subject: string) {
      const client = new Client({ name: subject, version: "1" });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: {
            headers: { Authorization: `Bearer ${await token(subject)}` },
          },
        }),
      );
      return client;
    }
    const alice = await connect("alice");
    const bob = await connect("bob");
    async function call(
      client: Client,
      name: string,
      args: Record<string, unknown> = {},
    ) {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      return JSON.parse((result.content as { text: string }[])[0]!.text);
    }
    const a = await call(alice, "save_expression", { text: "creeping in" });
    const b = await call(bob, "save_expression", { text: "creeping in" });
    assert.notEqual(a.id, b.id);
    const eventId = randomUUID();
    await call(alice, "record_usage", {
      item_id: a.id,
      event_id: eventId,
      outcome: "independent",
      context: "Anxiety is creeping in.",
    });
    await call(bob, "record_usage", {
      item_id: b.id,
      event_id: eventId,
      outcome: "incorrect",
      context: "I creeping in yesterday.",
    });
    for (const [name, args] of [
      ["review_words", { item_id: a.id }],
      ["update_learning_item", { item_id: a.id, changes: { notes: "hacked" } }],
      [
        "record_usage",
        {
          item_id: a.id,
          event_id: randomUUID(),
          outcome: "independent",
          context: "cross-user attempt",
        },
      ],
    ] as const) {
      assert.equal(
        (await bob.callTool({ name, arguments: args })).isError,
        true,
      );
    }
    assert.equal((await call(alice, "get_stats")).successful_uses, 1);
    assert.equal((await call(bob, "get_stats")).successful_uses, 0);
    assert.equal((await call(bob, "get_learning_words")).length, 1);
    const reconnected = await connect("alice");
    assert.equal((await call(reconnected, "get_learning_words"))[0].id, a.id);
    const today = await call(alice, "start_today_learning");
    assert.equal(today.view, "today");
    assert.equal(today.data.menu.length, 4);
    const material = await call(alice, "get_learning_material", {
      mode: "writing",
    });
    assert.equal(material.data.items[0].id, a.id);
    const foreignLesson = await bob.callTool({
      name: "prepare_learning_activity",
      arguments: {
        mode: "writing",
        topic: "feelings",
        questions: [{ prompt: "Write with creeping in.", item_ids: [a.id] }],
      },
    });
    assert.equal(foreignLesson.isError, true);
    const resource = await alice.readResource({
      uri: "ui://reword/today-v1.html",
    });
    assert.equal(resource.contents[0]?.mimeType, "text/html;profile=mcp-app");
    assert.ok("text" in resource.contents[0]!);
    assert.equal(
      JSON.stringify(resource.contents).includes("local secret"),
      false,
    );
    assert.equal(local.stats().total, 1);
    assert.equal(local.list()[0]?.text, "local secret");
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    repo.close();
  }
});

test("remote JWKS resolver caches keys, handles rotation and fails closed on outages", async () => {
  const { createRemoteJWKSet, customFetch } = await import("jose");
  const first = await generateKeyPair("RS256");
  const second = await generateKeyPair("RS256");
  let published = [{ ...(await exportJWK(first.publicKey)), kid: "first" }];
  let requests = 0;
  let offline = false;
  const keys = createRemoteJWKSet(new URL(config.jwksUrl), {
    cooldownDuration: 0,
    [customFetch]: async (url: string) => {
      assert.equal(String(url), config.jwksUrl);
      requests++;
      if (offline) return new Response("unavailable", { status: 503 });
      return Response.json({ keys: published });
    },
  });
  const oauth = createOAuth(config, keys);
  async function signed(key: typeof first.privateKey, kid: string) {
    return new SignJWT({ client_id: "client", scope: "reword" })
      .setProtectedHeader({
        alg: "RS256",
        kid,
        typ: "at+jwt",
        jku: "https://untrusted.example/keys",
      })
      .setIssuer(config.issuer)
      .setAudience(config.resource)
      .setSubject("alice")
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime("5m")
      .sign(key);
  }
  const initial = await signed(first.privateKey, "first");
  await oauth.verifier.verifyAccessToken(initial);
  await oauth.verifier.verifyAccessToken(initial);
  assert.equal(requests, 1);
  published.push({ ...(await exportJWK(second.publicKey)), kid: "second" });
  await oauth.verifier.verifyAccessToken(
    await signed(second.privateKey, "second"),
  );
  assert.equal(requests, 2);
  offline = true;
  await assert.rejects(
    oauth.verifier.verifyAccessToken(
      await signed(second.privateKey, "unknown"),
    ),
  );
  // Existing cached keys continue working; untrusted unknown keys never do.
  await oauth.verifier.verifyAccessToken(initial);
});
