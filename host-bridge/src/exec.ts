import { execFile } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Run a command with an explicit argv array via execFile — NO shell is spawned,
 * so user-supplied arguments cannot inject shell syntax. Always prefer this over
 * exec()/a shell string when any argument is derived from tool input.
 */
export function run(cmd: string, args: string[], timeoutMs = 15_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = stderr?.toString().trim();
          reject(new Error(`${cmd} failed: ${err.message}${detail ? `\n${detail}` : ""}`));
          return;
        }
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      },
    );
  });
}

export interface CaptureResult extends RunResult {
  /** Process exit code; 0 on success, the CLI's code on a non-zero exit. */
  code: number;
}

/**
 * Like run(), but does NOT reject on a non-zero exit — it resolves with the exit
 * code plus both streams. For CLI *pass-through* tools (gh, acli) a non-zero exit
 * is ordinary, informative output ("PR not found", "no such issue"), not an
 * exceptional failure, so the caller wants the streams + code rather than a
 * thrown error. Still uses execFile (no shell). Rejects ONLY when the binary
 * can't be spawned (missing on PATH) or the call times out.
 */
export function runCapture(cmd: string, args: string[], timeoutMs = 60_000): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: number | string; killed?: boolean }) | null;
        if (e?.killed) {
          reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
          return;
        }
        // A string code (e.g. "ENOENT") means spawn failed — the binary isn't
        // runnable, which is a real error, not CLI output. A numeric code means
        // the process ran and exited non-zero: ordinary pass-through output.
        if (e && typeof e.code !== "number") {
          reject(new Error(`${cmd} could not be run: ${e.message}`));
          return;
        }
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          code: e ? e.code as number : 0,
        });
      },
    );
  });
}
