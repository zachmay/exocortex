import { z } from "zod";
import type { Plugin } from "../types.js";
import { runCapture } from "../exec.js";
import { accessAllowed, classifyAccess, commandPath, type AccessPolicy } from "../access.js";

// The host's GitHub CLI. Override the binary with GH_PATH; bump the per-call
// timeout with GH_TIMEOUT_MS (gh hits the network, so it gets more headroom).
const GH = process.env.GH_PATH ?? "gh";
const GH_TIMEOUT_MS = Number(process.env.GH_TIMEOUT_MS ?? 60_000);
const READ_SCOPE = "read:gh";
const WRITE_SCOPE = "write:gh";

// Read/write classifier for gh. Read verbs cover the obviously non-mutating
// subcommands; everything else defaults to write (see access.ts). `gh api` is
// special: it's a GET (read) unless a non-GET method or a body field is given.
const POLICY: AccessPolicy = {
  readVerbs: ["list", "view", "diff", "status", "checks", "search", "get", "show", "ls"],
  override(args) {
    if (commandPath(args)[0] !== "api") return null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-X" || a === "--method") {
        const m = (args[i + 1] ?? "").toUpperCase();
        if (m && m !== "GET" && m !== "HEAD") return "write";
      } else if (a.startsWith("--method=")) {
        const m = a.slice("--method=".length).toUpperCase();
        if (m && m !== "GET" && m !== "HEAD") return "write";
      } else if (
        a === "-f" || a === "-F" || a === "--field" || a === "--raw-field" || a === "--input" ||
        a.startsWith("--field=") || a.startsWith("--raw-field=") || a.startsWith("--input=")
      ) {
        return "write"; // a request body implies a POST
      }
    }
    return "read";
  },
};

const TOOL_DESCRIPTION = [
  "Run the host's authenticated GitHub CLI (`gh`) and return its output.",
  "Pass the argv that follows `gh` as an array — one token per element,",
  'e.g. ["pr", "list", "--limit", "5"] or ["issue", "view", "42", "-R", "owner/repo"].',
  "No shell is involved: quoting, globbing, and redirection do not apply, and you",
  "must identify the repo with `-R owner/repo` because the host has no notion of the",
  "sandbox's working directory. Runs with the host user's GitHub credentials.",
  "⚠️ UNRESTRICTED: `gh` can CREATE, MERGE, EDIT, and DELETE (PRs, issues, releases,",
  "repos, secrets, gists). Treat any state-changing command (create/merge/close/edit/",
  "delete, `secret`, `api` with -X/-f writes, etc.) as DESTRUCTIVE and confirm with the",
  "user before running it. Read-only queries (list/view/status/search/diff) need no",
  "confirmation.",
  "Enforced server-side: each call is classified read vs write from its argv; a token",
  "with only read:gh has write commands refused before they run.",
].join(" ");

const DOCUMENTATION = `# gh — GitHub CLI pass-through

Lends the sandboxed agent the **host user's authenticated \`gh\`**. The sandbox
has no GitHub egress and no \`gh\` auth of its own, so all GitHub work routes
through this. argv is forwarded verbatim via \`execFile\` (no shell) — no
injection surface, but no command filtering either.

**Tool:** \`gh(args: string[])\` → combined stdout/stderr; a non-zero exit is
returned as output with \`isError\`, not thrown.

**Examples**
- \`["pr", "list", "--limit", "5", "-R", "owner/repo"]\`
- \`["issue", "view", "42", "-R", "owner/repo"]\`
- \`["api", "/user"]\`

**Scopes:** \`read:gh\` (read-only subcommands + GET \`gh api\`) and \`write:gh\`
(state-changing commands; implies read). Each call's argv is classified read vs
write server-side (\`access.ts\`): the command path's verb decides, with anything
unrecognized treated as a write, and \`gh api\` keyed on its HTTP method/body. A
write command under a read-only token is refused before it runs. The "ask before
destructive ops" courtesy guard still lives in the tool description and driving
skills; this scope split is the hard backstop.

**Env:** \`GH_PATH\` (binary), \`GH_TIMEOUT_MS\` (default 60000).`;

const gh: Plugin = {
  manifest: {
    name: "gh",
    description: "Pass-through to the host's authenticated GitHub CLI (gh). Split read:gh / write:gh, enforced per call.",
    documentation: DOCUMENTATION,
    scopes: [
      {
        name: READ_SCOPE,
        description: "Run read-only gh commands (list/view/diff/status/checks/search and GET `gh api`).",
      },
      {
        name: WRITE_SCOPE,
        description: "Run state-changing gh commands (create/merge/edit/delete, non-GET `gh api`, …). Implies read.",
      },
    ],
  },
  register({ server, granted }) {
    const canRead = granted.has(READ_SCOPE);
    const canWrite = granted.has(WRITE_SCOPE);
    if (!canRead && !canWrite) return;
    server.registerTool(
      "gh",
      {
        title: "GitHub CLI (gh)",
        description: canWrite
          ? TOOL_DESCRIPTION
          : `${TOOL_DESCRIPTION}\n\nNOTE: this token holds read:gh only — write/state-changing commands will be refused.`,
        inputSchema: {
          args: z
            .array(z.string())
            .min(1)
            .describe('Arguments after `gh`, one token per element, e.g. ["pr","view","42"].'),
        },
      },
      async ({ args }) => {
        const needed = classifyAccess(args, POLICY);
        if (!accessAllowed(granted, "gh", needed)) {
          const text = `Refused: \`gh ${args.join(" ")}\` is a ${needed} operation; this token lacks ${needed}:gh.`;
          return { content: [{ type: "text" as const, text }], isError: true };
        }
        const { stdout, stderr, code } = await runCapture(GH, args, GH_TIMEOUT_MS);
        const body = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
        const text = code === 0 ? body || "(no output)" : `gh exited ${code}\n${body || "(no output)"}`;
        return { content: [{ type: "text" as const, text }], isError: code !== 0 };
      },
    );
  },
};

export default gh;
