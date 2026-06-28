import type { Plugin } from "../types.js";
import gh from "./gh.js";
import acli from "./acli.js";
import calendar from "./calendar.js";
import whisper from "./whisper.js";

/**
 * Every plugin installed in this bridge. Listing it here makes it *available*;
 * bridge.config.json decides which are actually *loaded*. Add a capability by
 * writing a plugin (see types.ts → Plugin) and adding one import + entry here.
 */
export const REGISTRY: Plugin[] = [gh, acli, calendar, whisper];
