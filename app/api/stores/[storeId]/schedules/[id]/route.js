import prisma from "@/lib/prisma";
import { withStore, ok, body, notFound } from "@/lib/http";
import { assertValidCron, nextRun } from "@/lib/services/schedules";
import { schedulePatchSchema, assertOwnedRefs } from "@/lib/schemas/schedules";
import { recordChanges, recordDeletion } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function find(id, storeId) {
  return prisma.scheduledUpdate.findFirst({ where: { id, storeId } });
}

export const GET = withStore(async (req, { store, params }) => {
  const schedule = await prisma.scheduledUpdate.findFirst({
    where: { id: params.id, storeId: store.id },
    include: { template: { select: { id: true, name: true } } },
  });
  if (!schedule) throw notFound("Schedule not found");
  return ok(schedule);
});

export const PATCH = withStore(
  async (req, { store, user, params }) => {
    const before = await find(params.id, store.id);
    if (!before) throw notFound("Schedule not found");

    const data = await body(req, schedulePatchSchema);

    const cron = data.cron ?? before.cron;
    const timezone = data.timezone ?? before.timezone;
    const enabled = data.enabled ?? before.enabled;

    assertValidCron(cron, timezone);
    await assertOwnedRefs(store.id, {
      templateId: data.templateId,
      target: data.target,
    });

    // The cadence is derived state — recompute it whenever any input to it
    // moves, and clear it while disabled so the worker's index stays small.
    const cadenceChanged =
      data.cron !== undefined || data.timezone !== undefined || data.enabled !== undefined;

    const schedule = await prisma.scheduledUpdate.update({
      where: { id: before.id },
      data: {
        ...data,
        ...(cadenceChanged && { nextRunAt: enabled ? nextRun(cron, timezone) : null }),
      },
    });

    await recordChanges({
      storeId: store.id,
      entity: "ScheduledUpdate",
      entityId: schedule.id,
      before,
      after: data,
      userId: user.id,
    });

    return ok(schedule);
  },
  { role: "ADMIN" },
);

export const DELETE = withStore(
  async (req, { store, user, params }) => {
    const before = await find(params.id, store.id);
    if (!before) throw notFound("Schedule not found");

    await prisma.scheduledUpdate.deleteMany({ where: { id: before.id, storeId: store.id } });

    await recordDeletion({
      storeId: store.id,
      entity: "ScheduledUpdate",
      entityId: before.id,
      snapshot: before,
      userId: user.id,
    });

    return ok({ deleted: true, id: before.id });
  },
  { role: "ADMIN" },
);
