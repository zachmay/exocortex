// Read/write classification for CLI pass-through plugins (gh, acli).
//
// The pass-through plugins forward argv verbatim, so the only thing standing
// between a read-only token and a destructive command is this module: given an
// argv, decide whether it is a read or a write, then check the caller's scopes.
//
// SECURITY-FIRST DEFAULT: a call is treated as a *write* unless it is provably
// read-only. A command we don't recognize requires the write scope — we never
// fail open. Over-restriction (a harmless read needing write scope) is the safe
// failure mode; under-restriction is not.

export type Access = "read" | "write";

/**
 * Per-plugin rules for classifying an argv. `readVerbs` are the command-path
 * tokens that mark a call read-only (list/view/search/…); `override` is an
 * escape hatch for commands whose nature lives in flags rather than a verb
 * (e.g. `gh api`, where the HTTP method decides).
 */
export interface AccessPolicy {
  /** Command-path verbs (compared case-insensitively) that mean read-only. */
  readVerbs: string[];
  /**
   * Optional pre-check: return "read"/"write" to force the classification, or
   * null to fall through to the verb check.
   */
  override?: (args: string[]) => Access | null;
}

/**
 * The command path: the leading run of positional (non-flag) tokens, e.g.
 * ["pr","list"] from ["pr","list","--limit","5"]. We stop at the first flag, so
 * a flag *value* such as `--search "create"` is never mistaken for a verb.
 */
export function commandPath(args: string[]): string[] {
  const path: string[] = [];
  for (const tok of args) {
    if (tok.startsWith("-")) break;
    path.push(tok);
  }
  return path;
}

/** Classify an argv as a read or a write operation. Defaults to write. */
export function classifyAccess(args: string[], policy: AccessPolicy): Access {
  const forced = policy.override?.(args);
  if (forced) return forced;
  const read = new Set(policy.readVerbs.map((v) => v.toLowerCase()));
  return commandPath(args).some((t) => read.has(t.toLowerCase())) ? "read" : "write";
}

/**
 * Does the caller's granted scope set permit `needed` access to `plugin`?
 * `write:<plugin>` implies read; `read:<plugin>` permits reads only.
 */
export function accessAllowed(granted: Set<string>, plugin: string, needed: Access): boolean {
  if (granted.has(`write:${plugin}`)) return true;
  return needed === "read" && granted.has(`read:${plugin}`);
}
