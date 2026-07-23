import prisma from "@/lib/prisma";
import { withStore, ok, notFound } from "@/lib/http";
import { resolveTargets } from "@/lib/services/schedules";
import { enqueuePush } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withStore(
  async (req, { store, user, params }) => {
    const schedule = await prisma.scheduledUpdate.findFirst({
      where: { id: params.id, storeId: store.id },
    });
    if (!schedule) throw notFound("Schedule not found");

    const labelIds = await resolveTargets(schedule);

    if (schedule.templateId && labelIds.length) {
      await prisma.label.updateMany({
        where: { id: { in: labelIds }, storeId: store.id },
        data: { templateId: schedule.templateId },
      });
    }

    await enqueuePush({
      storeId: store.id,
      labelIds,
      operatorId: user.id,
      reason: "SCHEDULED",
    });

    // lastRunAt/lastResult only — nextRunAt is left alone so a manual "run now"
    // does not shift the cadence the merchant configured.
    await prisma.scheduledUpdate.updateMany({
      where: { id: schedule.id, storeId: store.id },
      data: {
        lastRunAt: new Date(),
        lastResult: `Manual run — queued ${labelIds.length} label(s)`,
      },
    });

    return ok({ queued: labelIds.length, labelIds, nextRunAt: schedule.nextRunAt });
  },
  { role: "OPERATOR" },
);
