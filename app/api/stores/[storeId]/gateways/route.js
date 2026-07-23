import prisma from "@/lib/prisma";
import { withStore, ok, body, query } from "@/lib/http";
import { paginate, page } from "@/lib/query";
import {
  GATEWAY_SORTABLE,
  gatewayCreateSchema,
  gatewayListQuerySchema,
  gatewayWhere,
} from "@/lib/schemas/gateway";
import { recordChanges } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withStore(async (req, { store }) => {
  const params = query(req, gatewayListQuerySchema);
  const where = gatewayWhere(store.id, params);

  const [items, total] = await Promise.all([
    prisma.gateway.findMany({
      where,
      include: { _count: { select: { labels: true } } },
      ...paginate(params, GATEWAY_SORTABLE, "updatedAt"),
    }),
    prisma.gateway.count({ where }),
  ]);

  return ok(page(items, total, params));
});

export const POST = withStore(
  async (req, { store, user }) => {
    const data = await body(req, gatewayCreateSchema);

    const gateway = await prisma.gateway.create({ data: { ...data, storeId: store.id } });

    await recordChanges({
      storeId: store.id,
      entity: "Gateway",
      entityId: gateway.id,
      before: {},
      after: data,
      userId: user.id,
    });

    return ok(gateway, { status: 201 });
  },
  { role: "ADMIN" },
);
