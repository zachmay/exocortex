import type { Plugin } from "./types.js";
import { REGISTRY } from "./plugins/registry.js";
import { enabledPluginNames, loadConfig } from "./config.js";

export interface LoadedBridge {
  /** The enabled plugins, in registry order. */
  plugins: Plugin[];
  /** Union of the enabled plugins' manifest scopes — the grantable universe. */
  availableScopes: Set<string>;
}

/**
 * Resolve the config against the registry: mount the plugins the config enables,
 * and compute the scopes those plugins make available. A config entry naming a
 * plugin that isn't in the registry is warned about and skipped; a registry
 * plugin the config doesn't enable simply isn't loaded.
 */
export function loadBridge(): LoadedBridge {
  const cfg = loadConfig();
  const byName = new Map(REGISTRY.map((p) => [p.manifest.name, p]));

  const plugins: Plugin[] = [];
  for (const name of enabledPluginNames(cfg)) {
    const plugin = byName.get(name);
    if (!plugin) {
      console.warn(`config enables unknown plugin "${name}" (not in registry) — skipping`);
      continue;
    }
    plugins.push(plugin);
  }

  const availableScopes = new Set<string>();
  for (const plugin of plugins) {
    for (const scope of plugin.manifest.scopes) availableScopes.add(scope.name);
  }

  return { plugins, availableScopes };
}
