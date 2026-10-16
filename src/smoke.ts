import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { pathToFileURL } from "node:url";
import { practiceMode } from "./features/practice/domain.js";
import { WIDGET_URI } from "./features/daily/mcp.js";

/** Read-only acceptance check: never saves vocabulary or records learning events. */
export async function smoke(endpoint: string, token?: string) {
  const url = new URL(endpoint);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname !== "/mcp"
  )
    throw new Error("Use an /mcp URL without credentials, query, or fragment.");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("Use HTTPS except for loopback development.");
  const health = await fetch(new URL("/health", url), {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!health.ok || (await health.json()).status !== "ok")
    throw new Error("Health check failed.");
  const challenge = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (url.protocol === "https:" && challenge.status !== 401)
    throw new Error("Public MCP endpoint did not require authentication.");
  if (challenge.status === 401) {
    const advertised = challenge.headers
      .get("www-authenticate")
      ?.match(/resource_metadata="([^"]+)"/)?.[1];
    if (advertised) {
      const metadataUrl = new URL(advertised);
      if (metadataUrl.origin !== url.origin)
        throw new Error("Unexpected metadata origin.");
      const response = await fetch(metadataUrl, {
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("OAuth metadata unavailable.");
      const metadata = await response.json();
      if (
        metadata.resource !== endpoint ||
        !Array.isArray(metadata.authorization_servers) ||
        !metadata.authorization_servers.length ||
        !metadata.scopes_supported?.includes("reword")
      )
        throw new Error("OAuth metadata does not match the endpoint or scope.");
    }
    if (!token)
      throw new Error(
        "Authentication is required. Set REWORD_SMOKE_TOKEN to an access token.",
      );
  }
  const client = new Client({ name: "reword-smoke", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      redirect: "error",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    },
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    for (const name of [
      "save_expression",
      "record_usage",
      "get_words_for_conversation",
      "get_corrections",
      "get_stats",
      "start_today_learning",
      "start_practice",
      "get_practice",
      "answer_practice",
    ])
      if (!tools.some((tool) => tool.name === name))
        throw new Error(`Missing tool: ${name}`);
    const stats = await client.callTool({ name: "get_stats", arguments: {} });
    if (stats.isError) throw new Error("Authenticated tool call failed.");
    // Only read existing sessions. Empty accounts are valid; never start practice.
    for (const mode of practiceMode.options) {
      const result = await client.callTool({
        name: "get_practice",
        arguments: { mode },
      });
      const data = result.structuredContent;
      if (
        result.isError ||
        typeof data !== "object" ||
        data === null ||
        !("view" in data) ||
        data.view !== "practice" ||
        !("data" in data)
      )
        throw new Error(`Practice read failed: ${mode}`);
    }
    const widget = await client.readResource({ uri: WIDGET_URI });
    if (
      !widget.contents.some(
        (resource) =>
          resource.uri === WIDGET_URI &&
          resource.mimeType === "text/html;profile=mcp-app" &&
          "text" in resource &&
          resource.text.includes("<html"),
      )
    )
      throw new Error("Practice widget unavailable.");
    return {
      health: "ok",
      mcp: "ok",
      tools: tools.length,
      authenticated: challenge.status === 401,
      practice_reads: "ok",
      widget_resource: "ok",
    };
  } finally {
    await client.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const endpoint = process.argv[2];
    if (!endpoint)
      throw new Error("Usage: npm run smoke -- https://your-domain/mcp");
    console.log(
      JSON.stringify(await smoke(endpoint, process.env.REWORD_SMOKE_TOKEN)),
    );
  } catch {
    // Do not print SDK/provider errors, which can contain tokens or private response content.
    console.error(
      "RE:WORD smoke check failed. Verify the endpoint, service health, OAuth metadata and REWORD_SMOKE_TOKEN.",
    );
    process.exitCode = 1;
  }
}
