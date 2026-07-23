// -----------------------------------------------------------------------------
// lib/crypto.js — secret handling.
//
// Two distinct jobs, deliberately kept apart:
//   • hashToken()      one-way, for session cookies we only ever compare
//   • encrypt/decrypt  reversible AES-256-GCM, for the Minew API token we must
//                      replay to the vendor on every push
// -----------------------------------------------------------------------------
import crypto from "crypto";

const ALGO = "aes-256-gcm";

function key() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  // Accept either 32 raw bytes or any-length passphrase (normalised via SHA-256).
  return Buffer.byteLength(raw) === 32
    ? Buffer.from(raw)
    : crypto.createHash("sha256").update(raw).digest();
}

/** Encrypt a secret for storage. Returns "iv.tag.ciphertext", all base64url. */
export function encrypt(plain) {
  if (plain == null || plain === "") return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}

/** Reverse of encrypt(). Returns null for absent or tampered values. */
export function decrypt(packed) {
  if (!packed) return null;
  try {
    const [iv, tag, ct] = packed.split(".").map((p) => Buffer.from(p, "base64url"));
    const d = crypto.createDecipheriv(ALGO, key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Opaque, high-entropy session token handed to the browser. */
export function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

/** What we actually persist for a session — the token itself never hits the DB. */
export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
