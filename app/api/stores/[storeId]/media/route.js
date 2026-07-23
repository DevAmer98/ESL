import prisma from "@/lib/prisma";
import { withStore, ok, query, badRequest } from "@/lib/http";
import { listQuerySchema, paginate, page, search, dateRange } from "@/lib/query";
import { save, StorageError } from "@/lib/storage";
import { recordChanges } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTABLE = ["name", "bytes", "createdAt"];

export const GET = withStore(async (req, { store }) => {
  const params = query(req, listQuerySchema);

  const where = {
    storeId: store.id,
    ...search(params.q, ["name", "mimeType"]),
    ...dateRange("createdAt", params.from, params.to),
  };

  const [items, total] = await Promise.all([
    prisma.mediaAsset.findMany({ where, ...paginate(params, SORTABLE, "createdAt") }),
    prisma.mediaAsset.count({ where }),
  ]);

  return ok(page(items.map(shape), total, params));
});

export const POST = withStore(
  async (req, { store, user }) => {
    let form;
    try {
      form = await req.formData();
    } catch {
      throw badRequest("Expected a multipart/form-data upload");
    }

    const file = form.get("file");
    let stored;
    try {
      stored = await save(store.id, file);
    } catch (err) {
      // Storage rejects on type/size/emptiness — all of them are the client's
      // fault, so translate rather than let them surface as a 500.
      if (err instanceof StorageError) throw badRequest(err.message, { reason: err.code });
      throw err;
    }

    const name = String(form.get("name") || stored.name).slice(0, 200);

    const asset = await prisma.mediaAsset.create({
      data: {
        storeId: store.id,
        name,
        mimeType: stored.mimeType,
        bytes: stored.bytes,
        key: stored.key,
      },
    });

    await recordChanges({
      storeId: store.id,
      entity: "MediaAsset",
      entityId: asset.id,
      before: null,
      after: { name, mimeType: stored.mimeType, bytes: stored.bytes },
      userId: user.id,
    });

    return ok(shape(asset), { status: 201 });
  },
  { role: "ADMIN" },
);

/** The storage key is an internal detail; the browser gets a URL instead. */
function shape(asset) {
  const { key, ...rest } = asset;
  return { ...rest, url: `/api/stores/${asset.storeId}/media/${asset.id}` };
}
