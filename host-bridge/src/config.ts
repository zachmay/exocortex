import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The bridge manifest: which plugins to load. This is the committed source of
 * truth for what the server offers (and therefore which scopes are grantable).
 * It holds no secrets — tokens and the signing key live elsewhere.
 *
 * Shape (per-plugin value is `true` or `{ "enabled": true, ... }` so plugins can
 * carry settings later without a format change):
 *   { "plugins": { "gh": true, "calendar": { "enabled": true } } }
 */
export interface BridgeConfig {
  plugins: Record<string, boolean>;
}

export function configFile(): string {
  return process.env.BRIDGE_CONFIG_FILE ?? resolve(process.cwd(), "bridge.config.json");
}

export function loadConfig(): BridgeConfig {
  const file = configFile();
  if (!existsSync(file)) return { plugins: {} };
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    plugins?: Record<string, unknown>;
  };
  const plugins: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(raw.plugins ?? {})) {
    plugins[name] =
      value === true ||
      (typeof value === "object" && value !== null && (value as { enabled?: unknown }).enabled === true);
  }
  return { plugins };
}

export function enabledPluginNames(cfg: BridgeConfig): string[] {
  return Object.entries(cfg.plugins)
    .filter(([, on]) => on)
    .map(([name]) => name);
}
