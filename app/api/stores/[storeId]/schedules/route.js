import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, body, query } from "@/lib/http";
import { listQuerySchema, paginate, page, search } from "@/lib/query";
import { assertValidCron, nextRun } from "@/lib/services/schedules";
import { scheduleCreateSchema, assertOwnedRefs } from "@/lib/schemas/schedules";
import { recordChanges } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTABLE = ["name", "nextRunAt", "lastRunAt", "createdAt", "updatedAt"];

export const GET = withStore(async (req, { store }) => {
  const params = query(req, listQuerySchema.extend({ enabled: z.enum(["true", "false"]).optional() }));

  const where = {
    storeId: store.id,
    ...search(params.q, ["name", "cron"]),
    ...(params.enabled && { enabled: params.enabled === "true" }),
  };

  const [items, total] = await Promise.all([
    prisma.scheduledUpdate.findMany({
      where,
      ...paginate(params, SORTABLE, "createdAt"),
      include: { template: { select: { id: true, name: true } } },
    }),
    prisma.scheduledUpdate.count({ where }),
  ]);

  return ok(page(items, total, params));
});

export const POST = withStore(
  async (req, { store, user }) => {
    const data = await body(req, scheduleCreateSchema);

    // Reject at write time: a bad expression accepted here would sit silently
    // in the table and never fire.
    assertValidCron(data.cron, data.timezone);
    await assertOwnedRefs(store.id, data);

    const schedule = await prisma.scheduledUpdate.create({
      data: {
        ...data,
        storeId: store.id,
        nextRunAt: data.enabled ? nextRun(data.cron, data.timezone) : null,
      },
    });

    await recordChanges({
      storeId: store.id,
      entity: "ScheduledUpdate",
      entityId: schedule.id,
      before: null,
      after: data,
      userId: user.id,
    });

    return ok(schedule, { status: 201 });
  },
  { role: "ADMIN" },
);
