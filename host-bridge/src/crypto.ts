import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

// ── The signing key ────────────────────────────────────────────────────────────
// The whole security model rests on this key being host-only. It MUST live
// OUTSIDE the vault, because the vault is mounted read/write into the sandbox at
// /vault — anything under it is readable by the sandboxed agent, which could then
// forge tokens with any scopes. The default path is in the host user's config
// dir, well clear of the vault; override with BRIDGE_KEY_FILE.
const DEFAULT_KEY_FILE = resolve(homedir(), ".config/exocortex-host-bridge/key");

export function keyFile(): string {
  return process.env.BRIDGE_KEY_FILE ?? DEFAULT_KEY_FILE;
}

/** Load the signing key, generating a fresh 256-bit one (0600) on first use. */
export function loadOrCreateKey(): Buffer {
  const file = keyFile();
  if (existsSync(file)) {
    return Buffer.from(readFileSync(file, "utf8").trim(), "hex");
  }
  const key = randomBytes(32);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, key.toString("hex") + "\n", { mode: 0o600 });
  return key;
}

// ── Stateless tokens ───────────────────────────────────────────────────────────
// A token is `<payload>.<sig>` (JWT-ish but minimal): the payload is the
// base64url of a small JSON claim set, the sig is base64url(HMAC-SHA256(key,
// payload)). The server holds NO list of issued tokens — it verifies the HMAC
// with the key and reads the scopes straight out of the payload. The scopes are
// visible to the holder (that's fine — the sandbox already knows what it may do)
// but tamper-proof: changing them invalidates the signature.

interface TokenPayload {
  v: 1;
  scopes: string[];
  /** Issued-at, unix seconds. */
  iat: number;
  /** Optional expiry, unix seconds. */
  exp?: number;
}

const b64url = (buf: Buffer): string => buf.toString("base64url");
const hmac = (key: Buffer, body: string): string =>
  b64url(createHmac("sha256", key).update(body).digest());

/** Sign a scope set into a token. ttlSeconds, if given, sets an expiry. */
export function sign(key: Buffer, scopes: string[], ttlSeconds?: number): string {
  const iat = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    v: 1,
    scopes,
    iat,
    ...(ttlSeconds ? { exp: iat + ttlSeconds } : {}),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${hmac(key, body)}`;
}

/**
 * Verify a token's signature and (if present) expiry. Returns its scopes on
 * success, or null on any failure — bad shape, wrong signature, expired. Uses a
 * constant-time comparison so a forged signature can't be probed byte-by-byte.
 */
export function verify(key: Buffer, token: string): string[] | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = hmac(key, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
  } catch {
    return null;
  }
  if (payload.v !== 1 || !Array.isArray(payload.scopes)) return null;
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload.scopes;
}
