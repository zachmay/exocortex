import { z } from "zod";
import type { Plugin } from "../types.js";
import { run } from "../exec.js";

// icalBuddy reads the macOS EventKit store, which only exists on the host — hence
// a host-native bridge. Override the binary with ICALBUDDY_PATH (Homebrew installs
// it as `icalBuddy`, camelCase).
const ICALBUDDY = process.env.ICALBUDDY_PATH ?? "icalBuddy";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SCOPE = "read:calendar";

// Shared formatting flags: no relative dates ("today"/"tomorrow"), ISO date +
// 24h time, fixed property set. `notes` is opt-in because invite bodies are huge.
function eventFormatFlags(includeNotes: boolean): string[] {
  const props = includeNotes
    ? "title,datetime,location,attendees,notes"
    : "title,datetime,location,attendees";
  return ["-nrd", "-df", "%Y-%m-%d", "-tf", "%H:%M", "-iep", props, "-po", props];
}

interface CalendarFilter {
  calendars?: string[];
  exclude_calendars?: string[];
  include_all_day?: boolean;
  include_notes?: boolean;
}

function eventBaseFlags(input: CalendarFilter): string[] {
  const flags = eventFormatFlags(input.include_notes ?? false);
  if (input.calendars?.length) flags.push("-ic", input.calendars.join(","));
  if (input.exclude_calendars?.length) flags.push("-ec", input.exclude_calendars.join(","));
  if (input.include_all_day === false) flags.push("-ea");
  return flags;
}

const filterShape = {
  calendars: z
    .array(z.string())
    .optional()
    .describe("Only these calendar names (use calendar_list_calendars to see names)."),
  exclude_calendars: z.array(z.string()).optional().describe("Exclude these calendar names."),
  include_all_day: z
    .boolean()
    .optional()
    .describe("Include all-day events. Default true; false adds -ea."),
  include_notes: z
    .boolean()
    .optional()
    .describe("Include event notes/bodies. Default false (they can be very large)."),
};

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text: text.trim() || "(no events)" }],
});

const DOCUMENTATION = `# calendar — read-only calendar via icalBuddy

Read-only queries against the host's macOS calendar store (EventKit) via
\`icalBuddy\`. Host-native because EventKit only exists on the host. Output is
icalBuddy's raw text, piped straight back.

**Tools**
- \`calendar_list_calendars()\` — all calendar names.
- \`calendar_agenda({ days_ahead?, ...filter })\` — today, optionally +N days.
- \`calendar_now({ ...filter })\` — events happening right now.
- \`calendar_range({ start, end, ...filter })\` — events between two YYYY-MM-DD dates.

**Filter args** (event tools): \`calendars\`, \`exclude_calendars\`,
\`include_all_day\` (default true), \`include_notes\` (default false).

Scope: \`read:calendar\`. **Env:** \`ICALBUDDY_PATH\`.

> macOS TCC note: the process must run in the user's GUI session to keep its
> calendar-access grant — run the bridge via the LaunchAgent, not a LaunchDaemon.`;

const calendar: Plugin = {
  manifest: {
    name: "calendar",
    description: "Read-only calendar queries via the host's icalBuddy (macOS EventKit).",
    documentation: DOCUMENTATION,
    scopes: [
      { name: SCOPE, description: "Read calendars and events from the host's macOS calendar store." },
    ],
  },
  register({ server, granted }) {
    if (!granted.has(SCOPE)) return;

    server.registerTool(
      "calendar_list_calendars",
      {
        title: "List calendars",
        description:
          "List all calendars available on the host. Use the names with the calendars/exclude_calendars args of the event tools.",
        inputSchema: {},
      },
      async () => {
        const { stdout } = await run(ICALBUDDY, ["calendars"]);
        return textResult(stdout);
      },
    );

    server.registerTool(
      "calendar_agenda",
      {
        title: "Events today (and ahead)",
        description:
          "Calendar events today, optionally extending N days into the future (icalBuddy eventsToday / eventsToday+N).",
        inputSchema: {
          days_ahead: z
            .number()
            .int()
            .min(0)
            .max(366)
            .optional()
            .describe("Days past today to include. 0 (default) = just today."),
          ...filterShape,
        },
      },
      async (input) => {
        const n = input.days_ahead ?? 0;
        const command = n > 0 ? `eventsToday+${n}` : "eventsToday";
        const { stdout } = await run(ICALBUDDY, [...eventBaseFlags(input), command]);
        return textResult(stdout);
      },
    );

    server.registerTool(
      "calendar_now",
      {
        title: "Events now",
        description: "Calendar events occurring at the present moment (icalBuddy eventsNow).",
        inputSchema: { ...filterShape },
      },
      async (input) => {
        const { stdout } = await run(ICALBUDDY, [...eventBaseFlags(input), "eventsNow"]);
        return textResult(stdout);
      },
    );

    server.registerTool(
      "calendar_range",
      {
        title: "Events in date range",
        description:
          "Calendar events between two dates, inclusive (icalBuddy eventsFrom:START to:END). Dates are YYYY-MM-DD.",
        inputSchema: {
          start: z.string().regex(ISO_DATE).describe("Start date, YYYY-MM-DD."),
          end: z.string().regex(ISO_DATE).describe("End date, YYYY-MM-DD."),
          ...filterShape,
        },
      },
      async (input) => {
        const { stdout } = await run(ICALBUDDY, [
          ...eventBaseFlags(input),
          `eventsFrom:${input.start}`,
          `to:${input.end}`,
        ]);
        return textResult(stdout);
      },
    );
  },
};

export default calendar;
