import prisma from "@/lib/prisma";
import { withStore, ok, notFound } from "@/lib/http";
import { read, remove, StorageError } from "@/lib/storage";
import { recordDeletion } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function find(id, storeId) {
  return prisma.mediaAsset.findFirst({ where: { id, storeId } });
}

/**
 * Streams the bytes. The path carries the asset id, never the storage key —
 * the key never leaves the server, so it can never be forged into a traversal.
 */
export const GET = withStore(async (req, { store, params }) => {
  const asset = await find(params.id, store.id);
  if (!asset) throw notFound("Media asset not found");

  let bytes;
  try {
    bytes = await read(asset.key);
  } catch (err) {
    if (err instanceof StorageError) throw notFound("Media file is missing");
    throw err;
  }

  return new Response(bytes, {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${asset.name.replace(/"/g, "")}"`,
      // Content is immutable per id, but it is tenant data — never a shared cache.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

export const DELETE = withStore(
  async (req, { store, user, params }) => {
    const asset = await find(params.id, store.id);
    if (!asset) throw notFound("Media asset not found");

    await prisma.mediaAsset.deleteMany({ where: { id: asset.id, storeId: store.id } });
    // Row first: an orphaned file is recoverable housekeeping, an orphaned row
    // is a broken image in the library.
    const fileRemoved = await remove(asset.key);

    await recordDeletion({
      storeId: store.id,
      entity: "MediaAsset",
      entityId: asset.id,
      snapshot: asset,
      userId: user.id,
    });

    return ok({ deleted: true, id: asset.id, fileRemoved });
  },
  { role: "ADMIN" },
);
