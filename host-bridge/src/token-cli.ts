// Issue a stateless bridge token. HOST-ONLY: it reads the signing key the
// sandbox never sees. The server doesn't track issued tokens, so this is purely
// a signing operation — nothing to register or restart.
//
//   npm run token -- --scopes read:gh,read:calendar     # mint with these scopes
//   npm run token -- --all                              # mint with every available scope
//   npm run token -- --all --out .bridge-token          # write to the handoff file
//   npm run token -- --scopes write:gh --ttl 3600       # 1-hour expiry
//   npm run token -- --list                             # show available scopes
import { writeFileSync } from "node:fs";
import { loadOrCreateKey, sign } from "./crypto.js";
import { loadBridge } from "./loader.js";

function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const next = args[i + 1];
    out[arg.slice(2)] = next && !next.startsWith("--") ? args[++i] : "";
  }
  return out;
}

const flags = parseFlags(process.argv.slice(2));
const { availableScopes } = loadBridge();
const available = [...availableScopes];

if ("list" in flags) {
  console.log(available.join("\n") || "(no scopes — check bridge.config.json)");
  process.exit(0);
}

const scopes = "all" in flags
  ? available
  : (flags.scopes ?? "").split(",").map((s) => s.trim()).filter(Boolean);

if (!scopes.length) {
  console.error("Usage: npm run token -- --scopes <a,b,...> | --all  [--ttl <seconds>] [--out <file>]");
  console.error(`Available scopes: ${available.join(", ") || "(none — check bridge.config.json)"}`);
  process.exit(1);
}

const unknown = scopes.filter((s) => !availableScopes.has(s));
if (unknown.length) {
  console.error(`Scope(s) not available under the current config: ${unknown.join(", ")}`);
  console.error(`Available: ${available.join(", ")}`);
  process.exit(1);
}

const ttl = flags.ttl ? Number(flags.ttl) : undefined;
if (flags.ttl && (!Number.isFinite(ttl) || (ttl as number) <= 0)) {
  console.error(`Invalid --ttl: ${flags.ttl}`);
  process.exit(1);
}

const token = sign(loadOrCreateKey(), scopes, ttl);
const summary = `scopes: ${scopes.join(", ")}${ttl ? `, ttl ${ttl}s` : ""}`;

if (flags.out) {
  writeFileSync(flags.out, token + "\n");
  // Status to stderr so stdout can still be piped cleanly if desired.
  console.error(`Wrote token (${summary}) to ${flags.out}`);
} else {
  console.error(`Issued token (${summary}):`);
  process.stdout.write(token + "\n");
}
