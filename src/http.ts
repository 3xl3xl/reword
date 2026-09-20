import express from "express";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcp } from "./mcp.js";
import type { OAuth } from "./auth.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { LearningApi } from "./learning-api.js";
export interface HttpOptions {
  token?: string;
  oauth?: OAuth;
  serviceForOwner?: (owner: string) => LearningApi;
  allowedHosts: string[];
  allowedOrigins?: string[];
}
export function createApp(service: LearningApi, options: HttpOptions) {
  if (options.oauth && (options.token || !options.serviceForOwner))
    throw new Error(
      "OAuth requires a tenant service factory and cannot be combined with a shared token.",
    );
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (!options.allowedHosts.includes(req.headers.host ?? "")) {
      res.status(403).json({ error: "Host not allowed" });
      return;
    }
    const origin = req.headers.origin;
    if (origin && !(options.allowedOrigins ?? []).includes(origin)) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    next();
  });
  app.get("/health", async (_req, res) => {
    try {
      res.status((await service.healthy()) ? 200 : 503).json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  if (options.oauth) {
    app.get(
      [
        "/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-protected-resource",
      ],
      (_req, res) => {
        res.json(options.oauth!.metadata);
      },
    );
    app.use(
      "/mcp",
      requireBearerAuth({
        verifier: options.oauth.verifier,
        requiredScopes: ["reword"],
        resourceMetadataUrl: options.oauth.metadataUrl,
      }),
    );
  }
  app.use("/mcp", (req, res, next) => {
    if (options.token) {
      const actual = Buffer.from(req.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${options.token}`);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        res.setHeader("WWW-Authenticate", "Bearer");
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: "64kb" }));
  app.post("/mcp", async (req, res) => {
    let selected = service;
    if (options.oauth) {
      const owner = req.auth?.extra?.owner;
      if (typeof owner !== "string") {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      selected = options.serviceForOwner!(owner);
    }
    const server = createMcp(selected);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent)
        res.status(500).json({ error: "MCP request failed" });
    }
  });
  app.all("/mcp", (_req, res) => {
    res.setHeader("Allow", "POST");
    res
      .status(405)
      .json({ error: "Method not allowed; stateless transport uses POST." });
  });
  return app;
}
