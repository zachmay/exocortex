import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadBridge } from "./loader.js";
import { loadOrCreateKey, verify } from "./crypto.js";

const PORT = Number(process.env.BRIDGE_PORT ?? 8765);

// Loaded once at startup. The server is a PURE VERIFIER: it holds the signing
// key and the set of loaded plugins, and nothing else — no token store, no
// per-client state, nothing to reconcile.
const KEY = loadOrCreateKey();
const { plugins, availableScopes } = loadBridge();

/** Fresh server exposing only the tools the caller's granted scopes unlock. */
function buildServer(granted: Set<string>): McpServer {
  const server = new McpServer({ name: "host-bridge", version: "0.2.0" });
  for (const plugin of plugins) plugin.register({ server, granted });
  return server;
}

const app = express();
app.use(express.json());

// Open, unauthenticated liveness probe.
app.get("/health", (_req, res) => {
  res.json({ ok: true, plugins: plugins.map((p) => p.manifest.name), scopes: [...availableScopes] });
});

// Verify the bearer token → its scopes, intersected with what the current config
// actually offers (so disabling a plugin in bridge.config.json instantly stops
// serving its tools to every existing token). Invalid/expired/absent → 401.
app.use((req, res, next) => {
  const match = /^Bearer (.+)$/.exec(req.header("authorization") ?? "");
  const scopes = match ? verify(KEY, match[1]) : null;
  if (!scopes) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.locals.granted = new Set(scopes.filter((s) => availableScopes.has(s)));
  next();
});

// Stateless streamable-HTTP MCP endpoint: a fresh server + transport per request,
// scoped to the caller's granted scopes.
app.post("/mcp", async (req, res) => {
  const server = buildServer(res.locals.granted as Set<string>);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  }
});

// No session continuity in stateless mode.
const methodNotAllowed = (_req: express.Request, res: express.Response) =>
  res.status(405).json({ error: "method not allowed" });
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(PORT, "0.0.0.0", () => {
  const names = plugins.map((p) => p.manifest.name).join(", ") || "none";
  console.log(`host-bridge listening on http://0.0.0.0:${PORT}/mcp  [plugins: ${names}]`);
  console.log(`scopes available: ${[...availableScopes].join(", ") || "none"}`);
});
