import prisma from "@/lib/prisma";
import { withStore, ok, body, noContent, notFound } from "@/lib/http";
import { productDto, productUpdateSchema } from "@/lib/schemas/product";
import { recordChanges, recordDeletion } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Always read scoped — a bare findUnique would hand over another tenant's row. */
function find(storeId, id) {
  return prisma.product.findFirst({ where: { id, storeId } });
}

export const GET = withStore(async (_req, { store, params }) => {
  const product = await find(store.id, params.id);
  if (!product) throw notFound("Product not found");
  return ok(productDto(product));
});

export const PATCH = withStore(
  async (req, { store, user, params }) => {
    const before = await find(store.id, params.id);
    if (!before) throw notFound("Product not found");

    const data = await body(req, productUpdateSchema);
    const after = await prisma.product.update({ where: { id: before.id }, data });

    await recordChanges({
      storeId: store.id,
      entity: "Product",
      entityId: before.id,
      before,
      after: data,
      userId: user.id,
    });

    return ok(productDto(after));
  },
  { role: "ADMIN" },
);

export const DELETE = withStore(
  async (_req, { store, user, params }) => {
    const before = await find(store.id, params.id);
    if (!before) throw notFound("Product not found");

    await prisma.product.delete({ where: { id: before.id } });
    await recordDeletion({
      storeId: store.id,
      entity: "Product",
      entityId: before.id,
      snapshot: before,
      userId: user.id,
    });

    return noContent();
  },
  { role: "ADMIN" },
);
