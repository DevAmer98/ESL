// Statistical Analysis → Deletion Log. Each row carries the full snapshot taken
// on the way out, which is what makes a deletion recoverable in principle.
import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, query } from "@/lib/http";
import { listQuerySchema, paginate, page, dateRange } from "@/lib/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTABLE = ["createdAt", "entity"];

const deletionQuerySchema = listQuerySchema.extend({
  entity: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(64).optional(),
  userId: z.string().trim().max(64).optional(),
});

export const GET = withStore(async (req, { store }) => {
  const params = query(req, deletionQuerySchema);

  const where = {
    storeId: store.id,
    ...(params.entity && { entity: params.entity }),
    ...(params.entityId && { entityId: params.entityId }),
    ...(params.userId && { userId: params.userId }),
    ...dateRange("createdAt", params.from, params.to),
    ...(params.q && { entityId: { contains: params.q, mode: "insensitive" } }),
  };

  const [items, total, entities] = await Promise.all([
    prisma.deletionLog.findMany({ where, ...paginate(params, SORTABLE, "createdAt") }),
    prisma.deletionLog.count({ where }),
    prisma.deletionLog.groupBy({
      by: ["entity"],
      where: { storeId: store.id },
      _count: { _all: true },
    }),
  ]);

  return ok({
    ...page(items, total, params),
    entities: entities.map((e) => ({ entity: e.entity, count: e._count._all })),
  });
});
