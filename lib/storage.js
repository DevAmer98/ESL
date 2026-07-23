// -----------------------------------------------------------------------------
// lib/storage.js — local-disk media storage for the Media Library tab.
//
// Deliberately a thin, swappable seam: save/read/remove is the whole surface an
// object store would also implement, so moving to S3 later touches this file
// only. Keys are opaque to the caller and always store-prefixed, which is what
// lets the API return a key to the browser and accept it back safely.
// -----------------------------------------------------------------------------
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

export const STORAGE_ROOT = path.resolve(process.cwd(), "storage");

export const MAX_BYTES = 5 * 1024 * 1024;

/** Extension per mime, so a client-supplied filename never picks the suffix. */
const EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/tiff": "tiff",
};

export class StorageError extends Error {
  constructor(message, code = "storage_error") {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

/** cuid-shaped: sortable prefix + entropy. Only needs to be collision-free. */
function newId() {
  return "c" + Date.now().toString(36) + crypto.randomBytes(8).toString("hex");
}

/**
 * Resolve a key to an absolute path, refusing anything that escapes the root.
 * A key round-trips through the browser, so "../../.env" must die here and not
 * three lines later inside fs.readFile.
 */
export function resolveKey(key) {
  if (typeof key !== "string" || !key || key.includes("\0")) {
    throw new StorageError("Invalid storage key", "invalid_key");
  }
  const full = path.resolve(STORAGE_ROOT, key);
  if (full !== STORAGE_ROOT && !full.startsWith(STORAGE_ROOT + path.sep)) {
    throw new StorageError("Invalid storage key", "invalid_key");
  }
  return full;
}

/**
 * Persist an uploaded image.
 * @param storeId tenant the asset belongs to — becomes the key prefix
 * @param file    a web `File` from `req.formData()`
 * @returns {Promise<{key: string, bytes: number, mimeType: string, name: string}>}
 */
export async function save(storeId, file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new StorageError("No file supplied", "no_file");
  }

  const mimeType = (file.type || "").toLowerCase().split(";")[0].trim();
  if (!mimeType.startsWith("image/") || !EXT_BY_MIME[mimeType]) {
    throw new StorageError(`Unsupported file type "${file.type || "unknown"}"`, "bad_mime");
  }
  // Trust the declared size only as a fast path; the buffer below is the truth.
  if (file.size > MAX_BYTES) {
    throw new StorageError(`File exceeds the ${MAX_BYTES / 1024 / 1024} MB limit`, "too_large");
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    throw new StorageError(`File exceeds the ${MAX_BYTES / 1024 / 1024} MB limit`, "too_large");
  }
  if (!buf.byteLength) throw new StorageError("File is empty", "empty");

  const key = `${storeId}/${newId()}.${EXT_BY_MIME[mimeType]}`;
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf);

  return { key, bytes: buf.byteLength, mimeType, name: file.name || "upload" };
}

/** Read the bytes back. Throws `not_found` if the row outlived the file. */
export async function read(key) {
  try {
    return await fs.readFile(resolveKey(key));
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw new StorageError("Stored file is missing", "not_found");
  }
}

/**
 * Delete the file. Missing is success — deleting the DB row is the operation
 * that matters, and a half-deleted asset should not be undeletable.
 */
export async function remove(key) {
  const full = resolveKey(key);
  try {
    await fs.unlink(full);
    return true;
  } catch {
    return false;
  }
}
