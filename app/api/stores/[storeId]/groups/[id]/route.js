import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, body, notFound } from "@/lib/http";
import { recordChanges, recordDeletion } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullish(),
    sortOrder: z.coerce.number().int().min(0).max(9999),
  })
  .partial();

/** Always store-scoped — a bare findUnique would happily cross tenants. */
function find(id, storeId) {
  return prisma.labelGroup.findFirst({
    where: { id, storeId },
    include: { _count: { select: { labels: true } } },
  });
}

export const GET = withStore(async (req, { store, params }) => {
  const group = await find(params.id, store.id);
  if (!group) throw notFound("Group not found");
  return ok(shape(group));
});

export const PATCH = withStore(
  async (req, { store, user, params }) => {
    const before = await find(params.id, store.id);
    if (!before) throw notFound("Group not found");

    const data = await body(req, patchSchema);

    const group = await prisma.labelGroup.update({
      where: { id: before.id },
      data,
      include: { _count: { select: { labels: true } } },
    });

    await recordChanges({
      storeId: store.id,
      entity: "LabelGroup",
      entityId: group.id,
      before,
      after: data,
      userId: user.id,
    });

    return ok(shape(group));
  },
  { role: "ADMIN" },
);

export const DELETE = withStore(
  async (req, { store, user, params }) => {
    const group = await find(params.id, store.id);
    if (!group) throw notFound("Group not found");

    // Deleting a grouping must never delete inventory: the labels survive,
    // un-grouped. One transaction so we can't orphan the labels and then fail
    // to remove the group (or vice versa).
    const [ungrouped] = await prisma.$transaction([
      prisma.label.updateMany({
        where: { storeId: store.id, groupId: group.id },
        data: { groupId: null },
      }),
      prisma.labelGroup.deleteMany({ where: { id: group.id, storeId: store.id } }),
    ]);

    await recordDeletion({
      storeId: store.id,
      entity: "LabelGroup",
      entityId: group.id,
      snapshot: shape(group),
      userId: user.id,
    });

    return ok({ deleted: true, id: group.id, labelsUngrouped: ungrouped.count });
  },
  { role: "ADMIN" },
);

function shape(group) {
  const { _count, ...rest } = group;
  return { ...rest, labelCount: _count?.labels ?? 0 };
}
