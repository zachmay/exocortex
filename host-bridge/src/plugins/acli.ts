import { z } from "zod";
import type { Plugin } from "../types.js";
import { runCapture } from "../exec.js";
import { accessAllowed, classifyAccess, type AccessPolicy } from "../access.js";

// The host's Atlassian CLI (`acli` — Jira, Confluence, Bitbucket). Override the
// binary with ACLI_PATH; bump the per-call timeout with ACLI_TIMEOUT_MS.
const ACLI = process.env.ACLI_PATH ?? "acli";
const ACLI_TIMEOUT_MS = Number(process.env.ACLI_TIMEOUT_MS ?? 60_000);
const READ_SCOPE = "read:acli";
const WRITE_SCOPE = "write:acli";

// Read/write classifier for acli. Read verbs cover the non-mutating Jira/
// Confluence/Bitbucket subcommands; everything else defaults to write.
const POLICY: AccessPolicy = {
  readVerbs: ["list", "view", "search", "get", "show"],
};

const TOOL_DESCRIPTION = [
  "Run the host's authenticated Atlassian CLI (`acli`, covering Jira / Confluence /",
  "Bitbucket) and return its output. Pass the argv that follows `acli` as an array —",
  'one token per element, e.g. ["jira", "issue", "list", "--project", "ABC"] or',
  '["jira", "issue", "view", "ABC-123"]. No shell is involved: quoting, globbing, and',
  "redirection do not apply. Runs with the host user's Atlassian credentials.",
  "⚠️ UNRESTRICTED: `acli` can CREATE, EDIT, TRANSITION, and DELETE issues, comments,",
  "and pages. Treat any state-changing command (create/edit/update/transition/assign/",
  "delete, etc.) as DESTRUCTIVE and confirm with the user before running it. Read-only",
  "queries (list/view/search/get) need no confirmation.",
  "Enforced server-side: each call is classified read vs write from its argv; a token",
  "with only read:acli has write commands refused before they run.",
].join(" ");

const DOCUMENTATION = `# acli — Atlassian CLI pass-through

Lends the sandboxed agent the **host user's authenticated \`acli\`** (Jira,
Confluence, Bitbucket). The sandbox has no Atlassian egress or auth of its own.
argv is forwarded verbatim via \`execFile\` (no shell) — no injection surface, no
command filtering.

**Tool:** \`acli(args: string[])\` → combined stdout/stderr; a non-zero exit is
returned as output with \`isError\`, not thrown.

**Examples**
- \`["jira", "issue", "list", "--project", "ABC"]\`
- \`["jira", "issue", "view", "ABC-123"]\`

**Scopes:** \`read:acli\` (read-only subcommands) and \`write:acli\`
(state-changing commands; implies read). Each call's argv is classified read vs
write server-side (\`access.ts\`): the command path's verb decides, with anything
unrecognized treated as a write. A write command under a read-only token is
refused before it runs. The "ask before destructive ops" courtesy guard still
lives in the tool description and driving skills; this scope split is the hard
backstop.

**Env:** \`ACLI_PATH\` (binary), \`ACLI_TIMEOUT_MS\` (default 60000).`;

const acli: Plugin = {
  manifest: {
    name: "acli",
    description: "Pass-through to the host's authenticated Atlassian CLI (acli — Jira/Confluence/Bitbucket). Split read:acli / write:acli, enforced per call.",
    documentation: DOCUMENTATION,
    scopes: [
      {
        name: READ_SCOPE,
        description: "Run read-only acli commands (list/view/search/get).",
      },
      {
        name: WRITE_SCOPE,
        description: "Run state-changing acli commands (create/edit/transition/delete, …). Implies read.",
      },
    ],
  },
  register({ server, granted }) {
    const canRead = granted.has(READ_SCOPE);
    const canWrite = granted.has(WRITE_SCOPE);
    if (!canRead && !canWrite) return;
    server.registerTool(
      "acli",
      {
        title: "Atlassian CLI (acli)",
        description: canWrite
          ? TOOL_DESCRIPTION
          : `${TOOL_DESCRIPTION}\n\nNOTE: this token holds read:acli only — write/state-changing commands will be refused.`,
        inputSchema: {
          args: z
            .array(z.string())
            .min(1)
            .describe('Arguments after `acli`, one token per element, e.g. ["jira","issue","view","ABC-123"].'),
        },
      },
      async ({ args }) => {
        const needed = classifyAccess(args, POLICY);
        if (!accessAllowed(granted, "acli", needed)) {
          const text = `Refused: \`acli ${args.join(" ")}\` is a ${needed} operation; this token lacks ${needed}:acli.`;
          return { content: [{ type: "text" as const, text }], isError: true };
        }
        const { stdout, stderr, code } = await runCapture(ACLI, args, ACLI_TIMEOUT_MS);
        const body = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
        const text = code === 0 ? body || "(no output)" : `acli exited ${code}\n${body || "(no output)"}`;
        return { content: [{ type: "text" as const, text }], isError: code !== 0 };
      },
    );
  },
};

export default acli;
