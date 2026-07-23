import prisma from "@/lib/prisma";
import { withStore, ok, body, notFound } from "@/lib/http";
import { assertLabelRefs, labelBindSchema } from "@/lib/schemas/label";
import { recordChanges, recordOperation } from "@/lib/audit";
import { enqueuePush } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withStore(
  async (req, { store, user, params }) => {
    const before = await prisma.label.findFirst({
      where: { id: params.id, storeId: store.id },
      include: { group: true },
    });
    if (!before) throw notFound("Label not found");

    const { push, ...refs } = await body(req, labelBindSchema);
    await assertLabelRefs(store.id, refs);

    const label = await prisma.label.update({
      where: { id: before.id },
      data: refs,
      include: { product: true, template: true, group: true },
    });

    await recordChanges({
      storeId: store.id,
      entity: "Label",
      entityId: label.id,
      before,
      after: refs,
      userId: user.id,
    });

    // BIND is its own operation type; the PUSH record comes from the queue when
    // the worker actually reaches the hardware, so this is not a double-record.
    await recordOperation({
      storeId: store.id,
      labelId: label.id,
      mac: label.mac,
      groupName: label.group?.name ?? null,
      operationType: label.productId ? "BIND" : "UNBIND",
      result: "SUCCESS",
      detail: label.product ? `Bound to ${label.product.code}` : "Unbound",
      snapshot: label.product ?? {},
      operatorId: user.id,
    });

    // A label whose product changed is showing the wrong price until it's
    // repainted, so the redraw is queued as part of the bind by default.
    const jobs = push
      ? await enqueuePush({ storeId: store.id, labelIds: [label.id], operatorId: user.id })
      : [];

    return ok({ label, queued: jobs.length });
  },
  { role: "OPERATOR" },
);
