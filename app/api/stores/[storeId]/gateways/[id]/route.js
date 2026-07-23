import prisma from "@/lib/prisma";
import { withStore, ok, body, noContent, notFound } from "@/lib/http";
import { gatewayUpdateSchema } from "@/lib/schemas/gateway";
import { recordChanges, recordDeletion } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function find(storeId, id, include) {
  return prisma.gateway.findFirst({ where: { id, storeId }, ...(include && { include }) });
}

export const GET = withStore(async (_req, { store, params }) => {
  const gateway = await find(store.id, params.id, { _count: { select: { labels: true } } });
  if (!gateway) throw notFound("Gateway not found");
  return ok(gateway);
});

export const PATCH = withStore(
  async (req, { store, user, params }) => {
    const before = await find(store.id, params.id);
    if (!before) throw notFound("Gateway not found");

    const data = await body(req, gatewayUpdateSchema);
    const after = await prisma.gateway.update({ where: { id: before.id }, data });

    await recordChanges({
      storeId: store.id,
      entity: "Gateway",
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
    if (!before) throw notFound("Gateway not found");

    // Labels survive: the FK is SetNull, so they simply become unassigned
    // rather than disappearing with the hardware that used to serve them.
    await prisma.gateway.delete({ where: { id: before.id } });
    await recordDeletion({
      storeId: store.id,
      entity: "Gateway",
      entityId: before.id,
      snapshot: before,
      userId: user.id,
    });

    return noContent();
  },
  { role: "ADMIN" },
);
