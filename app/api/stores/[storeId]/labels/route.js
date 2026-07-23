import prisma from "@/lib/prisma";
import { withStore, ok, body, query } from "@/lib/http";
import { paginate, page } from "@/lib/query";
import {
  LABEL_SORTABLE,
  assertLabelRefs,
  labelCreateSchema,
  labelListQuerySchema,
  labelWhere,
} from "@/lib/schemas/label";
import { recordChanges } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The columns the Devices table renders, so one round trip fills the grid. */
const LIST_INCLUDE = {
  product: { select: { id: true, code: true, name: true, priceCents: true } },
  group: { select: { id: true, name: true } },
  gateway: { select: { id: true, name: true, mac: true } },
  template: { select: { id: true, name: true } },
};

export const GET = withStore(async (req, { store }) => {
  const params = query(req, labelListQuerySchema);
  const where = labelWhere(store.id, params);

  const [items, total] = await Promise.all([
    prisma.label.findMany({
      where,
      include: LIST_INCLUDE,
      ...paginate(params, LABEL_SORTABLE, "updatedAt"),
    }),
    prisma.label.count({ where }),
  ]);

  return ok(page(items, total, params));
});

export const POST = withStore(
  async (req, { store, user }) => {
    const data = await body(req, labelCreateSchema);
    await assertLabelRefs(store.id, data);

    const label = await prisma.label.create({
      data: { ...data, storeId: store.id },
      include: LIST_INCLUDE,
    });

    await recordChanges({
      storeId: store.id,
      entity: "Label",
      entityId: label.id,
      before: {},
      after: data,
      userId: user.id,
    });

    return ok(label, { status: 201 });
  },
  { role: "ADMIN" },
);
