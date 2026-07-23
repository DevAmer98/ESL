// Statistical Analysis → Data Changes. Field-level history written by
// lib/audit.js; this route only reads it.
import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, query } from "@/lib/http";
import { listQuerySchema, paginate, page, dateRange } from "@/lib/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTABLE = ["createdAt", "entity", "field"];

const changeQuerySchema = listQuerySchema.extend({
  entity: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(64).optional(),
  field: z.string().trim().max(64).optional(),
  userId: z.string().trim().max(64).optional(),
});

export const GET = withStore(async (req, { store }) => {
  const params = query(req, changeQuerySchema);

  const where = {
    storeId: store.id,
    ...(params.entity && { entity: params.entity }),
    ...(params.entityId && { entityId: params.entityId }),
    ...(params.field && { field: params.field }),
    ...(params.userId && { userId: params.userId }),
    ...dateRange("createdAt", params.from, params.to),
    ...(params.q && {
      OR: [
        { entityId: { contains: params.q, mode: "insensitive" } },
        { field: { contains: params.q, mode: "insensitive" } },
        { oldValue: { contains: params.q, mode: "insensitive" } },
        { newValue: { contains: params.q, mode: "insensitive" } },
      ],
    }),
  };

  const [items, total, entities] = await Promise.all([
    prisma.dataChange.findMany({ where, ...paginate(params, SORTABLE, "createdAt") }),
    prisma.dataChange.count({ where }),
    // Populates the entity dropdown without a second round-trip.
    prisma.dataChange.groupBy({
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
