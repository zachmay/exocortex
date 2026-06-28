import { z } from "zod";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { Plugin } from "../types.js";
import { run } from "../exec.js";

// mlx-whisper runs on Apple Metal via MLX, which isn't exposed to the Linux
// microVM — so transcription happens on the host. Override the binary with
// MLX_WHISPER_BIN and the vault root (for the path guard) with VAULT_ROOT.
const MLX_WHISPER_BIN =
  process.env.MLX_WHISPER_BIN ?? path.join(homedir(), ".venvs/exocortex-mlx/bin/mlx_whisper");
const VAULT_ROOT = process.env.VAULT_ROOT ?? "/Users/zachmay/Projects/Exocortex/Exocortex";
const DEFAULT_MODEL = "mlx-community/whisper-large-v3-turbo";
const DEFAULT_LANGUAGE = "en";
const WHISPER_TIMEOUT_MS = 15 * 60 * 1000; // ~5 hr of audio at 20x realtime
const SCOPE = "use:transcribe";

// Resolve a caller-supplied audio path against the vault root. Accepts
// vault-relative or absolute-inside-the-vault paths; rejects anything that
// escapes the vault — the sandbox shouldn't make us read arbitrary host files.
function resolveAudioPath(input: string): string {
  const root = path.resolve(VAULT_ROOT);
  const resolved = path.resolve(root, input);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(
      `audio_path resolves outside the vault (${resolved}); refuse to read host files outside ${root}`,
    );
  }
  return resolved;
}

// Single-flight: mlx-whisper holds the GPU; queuing a second call doesn't help.
// Reject concurrent calls with a clear error rather than blocking.
let inFlight = false;

async function transcribe(input: { audio_path: string; model?: string; language?: string }): Promise<string> {
  if (inFlight) {
    throw new Error(
      "whisper busy: another transcription is in flight (mlx_whisper is single-GPU). Retry when it finishes.",
    );
  }
  inFlight = true;
  const hostPath = resolveAudioPath(input.audio_path);
  const workDir = await mkdtemp(path.join(tmpdir(), "host-bridge-whisper-"));
  try {
    await run(
      MLX_WHISPER_BIN,
      [
        hostPath,
        "--model", input.model ?? DEFAULT_MODEL,
        "--language", input.language ?? DEFAULT_LANGUAGE,
        "--output-dir", workDir,
        "--output-format", "txt",
      ],
      WHISPER_TIMEOUT_MS,
    );
    // mlx_whisper writes `<basename-without-ext>.txt` into --output-dir.
    const stem = path.basename(hostPath, path.extname(hostPath));
    const text = await readFile(path.join(workDir, `${stem}.txt`), "utf8");
    return text.trim();
  } finally {
    rm(workDir, { recursive: true, force: true }).catch(() => {});
    inFlight = false;
  }
}

const DOCUMENTATION = `# whisper — audio transcription via mlx-whisper

Transcribes vault audio on the host using \`mlx_whisper\` (Metal-accelerated).
Host-native because MLX/Metal isn't available in the Linux microVM.

**Tool:** \`whisper_transcribe({ audio_path, model?, language? })\` → transcript text.

- \`audio_path\` — vault-relative (e.g. \`Inbox/Recordings/foo.m4a\`); absolute paths
  must stay inside the vault. Anything escaping the vault is refused.
- \`model\` — mlx-whisper model id (default \`${DEFAULT_MODEL}\`).
- \`language\` — ISO code (default \`${DEFAULT_LANGUAGE}\`).

**Single-flight:** only one transcription runs at a time (the GPU is the
bottleneck); a concurrent call errors rather than queues. Timeout 15 min.

Scope: \`use:transcribe\`. **Env:** \`MLX_WHISPER_BIN\`, \`VAULT_ROOT\`.`;

const whisper: Plugin = {
  manifest: {
    name: "whisper",
    description: "Transcribe vault audio via mlx-whisper on the host (Metal-accelerated). Single-flight.",
    documentation: DOCUMENTATION,
    scopes: [
      { name: SCOPE, description: "Run mlx-whisper transcription on audio files inside the vault." },
    ],
  },
  register({ server, granted }) {
    if (!granted.has(SCOPE)) return;
    server.registerTool(
      "whisper_transcribe",
      {
        title: "Transcribe audio",
        description:
          "Transcribe a vault audio file using mlx-whisper on the host (Metal-accelerated). Returns the transcript text. Single-flight: only one transcription runs at a time.",
        inputSchema: {
          audio_path: z
            .string()
            .min(1)
            .describe(
              "Vault-relative path to the audio file (e.g. 'Inbox/Recordings/foo.m4a'). Absolute paths must stay inside the vault.",
            ),
          model: z.string().optional().describe(`mlx-whisper model id. Default: ${DEFAULT_MODEL}.`),
          language: z
            .string()
            .optional()
            .describe(`ISO language code passed to --language. Default: ${DEFAULT_LANGUAGE}.`),
        },
      },
      async (input) => ({ content: [{ type: "text" as const, text: await transcribe(input) }] }),
    );
  },
};

export default whisper;
