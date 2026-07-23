import prisma from "@/lib/prisma";
import { withStore, ok, notFound } from "@/lib/http";
import { recordOperation } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PENDING_DETAIL =
  "Reboot requested. No vendor reboot call exists yet — this needs the Minew " +
  "gateway SDK; the record stays PENDING until an adapter can execute it.";

export const POST = withStore(
  async (_req, { store, user, params }) => {
    const gateway = await prisma.gateway.findFirst({
      where: { id: params.id, storeId: store.id },
    });
    if (!gateway) throw notFound("Gateway not found");

    // Recorded rather than dropped: the operator's intent is auditable, and
    // whoever wires up the SDK can replay the pending rows.
    const record = await recordOperation({
      storeId: store.id,
      mac: gateway.mac,
      operationType: "REBOOT",
      result: "PENDING",
      detail: PENDING_DETAIL,
      snapshot: { gatewayId: gateway.id, name: gateway.name, ip: gateway.ip },
      operatorId: user.id,
    });

    return ok({ queued: true, operationId: record?.id ?? null, detail: PENDING_DETAIL }, { status: 202 });
  },
  { role: "OPERATOR" },
);
