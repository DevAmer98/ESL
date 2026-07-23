import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, body, query } from "@/lib/http";
import { listQuerySchema, paginate, page, search } from "@/lib/query";
import { recordChanges } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTABLE = ["name", "sortOrder", "createdAt", "updatedAt"];

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export const GET = withStore(async (req, { store }) => {
  const params = query(req, listQuerySchema);

  const where = { storeId: store.id, ...search(params.q, ["name", "description"]) };

  const [items, total] = await Promise.all([
    prisma.labelGroup.findMany({
      where,
      ...paginate(params, SORTABLE, "sortOrder"),
      include: { _count: { select: { labels: true } } },
    }),
    prisma.labelGroup.count({ where }),
  ]);

  return ok(page(items.map(shape), total, params));
});

export const POST = withStore(
  async (req, { store, user }) => {
    const data = await body(req, createSchema);

    const group = await prisma.labelGroup.create({
      data: { ...data, storeId: store.id },
      include: { _count: { select: { labels: true } } },
    });

    await recordChanges({
      storeId: store.id,
      entity: "LabelGroup",
      entityId: group.id,
      before: null,
      after: data,
      userId: user.id,
    });

    return ok(shape(group), { status: 201 });
  },
  { role: "ADMIN" },
);

/** Flatten Prisma's `_count` into the field the table actually renders. */
function shape(group) {
  const { _count, ...rest } = group;
  return { ...rest, labelCount: _count?.labels ?? 0 };
}
