import prisma from "@/lib/prisma";
import { withStore, ok, body, noContent, notFound } from "@/lib/http";
import { assertLabelRefs, labelUpdateSchema } from "@/lib/schemas/label";
import { recordChanges, recordDeletion } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DETAIL_INCLUDE = {
  product: true,
  group: { select: { id: true, name: true } },
  gateway: { select: { id: true, name: true, mac: true, status: true } },
  template: { select: { id: true, name: true, sizeInches: true, colorMode: true } },
};

function find(storeId, id, include) {
  return prisma.label.findFirst({ where: { id, storeId }, ...(include && { include }) });
}

export const GET = withStore(async (_req, { store, params }) => {
  const label = await find(store.id, params.id, DETAIL_INCLUDE);
  if (!label) throw notFound("Label not found");
  return ok(label);
});

export const PATCH = withStore(
  async (req, { store, user, params }) => {
    const before = await find(store.id, params.id);
    if (!before) throw notFound("Label not found");

    const data = await body(req, labelUpdateSchema);
    await assertLabelRefs(store.id, data);

    const after = await prisma.label.update({
      where: { id: before.id },
      data,
      include: DETAIL_INCLUDE,
    });

    await recordChanges({
      storeId: store.id,
      entity: "Label",
      entityId: before.id,
      before,
      after: data,
      userId: user.id,
    });

    return ok(after);
  },
  { role: "ADMIN" },
);

export const DELETE = withStore(
  async (_req, { store, user, params }) => {
    const before = await find(store.id, params.id);
    if (!before) throw notFound("Label not found");

    await prisma.label.delete({ where: { id: before.id } });
    await recordDeletion({
      storeId: store.id,
      entity: "Label",
      entityId: before.id,
      snapshot: before,
      userId: user.id,
    });

    return noContent();
  },
  { role: "ADMIN" },
);
