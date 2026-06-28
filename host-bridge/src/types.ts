import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * A scope a plugin can expose: a `<verb>:<resource>` claim plus a description of
 * what holding it lets the caller do. A plugin advertises its scopes in its
 * manifest; tokens carry a subset of them; the server gates each tool on one.
 */
export interface ScopeSpec {
  name: string;
  description: string;
}

/**
 * Declarative metadata a plugin advertises about itself. The loader reads this
 * to know the plugin's name (also its tool-name prefix and config key) and the
 * scopes it can offer; the description/documentation are for humans and agents.
 */
export interface PluginManifest {
  /** Unique id — also the tool-name prefix and the key used in bridge.config.json. */
  name: string;
  /** One-line, agent-oriented summary (for a plugin/tools index). */
  description: string;
  /** Full documentation: what it does, its tools, usage, caveats. Markdown. */
  documentation: string;
  /** The scopes this plugin can expose — the menu a token/config draws from. */
  scopes: ScopeSpec[];
}

/**
 * Context handed to a plugin at registration time. `granted` is the set of
 * scopes the *current caller* holds (already intersected with what the config
 * makes available) — register a tool only when its scope is present, so callers
 * never see tools they can't use.
 */
export interface PluginContext {
  server: McpServer;
  granted: Set<string>;
}

/**
 * A bridge plugin: a self-describing manifest plus a register() that mounts its
 * scope-gated tools. Adding a capability is: write a plugin satisfying this
 * contract, list it in plugins/registry.ts, and enable it in bridge.config.json.
 * No core/transport changes required.
 */
export interface Plugin {
  manifest: PluginManifest;
  register(ctx: PluginContext): void;
}
