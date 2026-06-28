// Manual smoke test for the host bridge. Connects as a real MCP client over the
// streamable-HTTP transport (so the initialize handshake + auth are exercised the
// same way the sandbox does it), lists tools, and calls a few. Run on the host
// after `npm install` and with the server started (`./run.sh` / `npm start`):
//
//   node smoke-test.mjs
//
// Reads the bearer token from ./.bridge-token. Optional: pass an audio path to
// also test whisper:  node smoke-test.mjs "Inbox/Recordings/foo.m4a"
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_MCP = process.env.BRIDGE_URL ?? "http://localhost:8765/mcp";
const token = readFileSync(new URL("./.bridge-token", import.meta.url), "utf8").trim();

const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({ name: "host-bridge-smoke", version: "0.0.0" });

const text = (r) => r?.content?.map((c) => c.text).join("\n") ?? JSON.stringify(r);

async function call(name, args) {
  process.stdout.write(`\n• ${name}(${JSON.stringify(args)})\n`);
  try {
    const r = await client.callTool({ name, arguments: args });
    console.log((r.isError ? "  [isError] " : "  ") + text(r).split("\n").join("\n  "));
  } catch (e) {
    console.log("  ERROR:", e.message);
  }
}

await client.connect(transport);
const { tools } = await client.listTools();
console.log("connected. tools:", tools.map((t) => t.name).join(", "));

await call("gh", { args: ["--version"] });
await call("gh", { args: ["auth", "status"] });
await call("acli", { args: ["--version"] });
await call("calendar_list_calendars", {});
await call("calendar_agenda", { days_ahead: 1 });

const audio = process.argv[2];
if (audio) await call("whisper_transcribe", { audio_path: audio });
else console.log("\n(skipping whisper — pass an audio path as arg 1 to test it)");

await client.close();
console.log("\ndone.");
