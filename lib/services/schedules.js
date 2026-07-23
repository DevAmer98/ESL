// -----------------------------------------------------------------------------
// lib/services/schedules.js — Store Settings → Scheduled Updates.
//
// A schedule resolves a target (all labels / groups / explicit labels) into
// push jobs at its cron time. It only ever enqueues; the queue owns delivery,
// retries and the operation record, so a schedule firing is cheap and cannot
// block on the vendor API.
// -----------------------------------------------------------------------------
import { CronExpressionParser } from "cron-parser";
import prisma from "@/lib/prisma";
import { enqueuePush } from "@/lib/queue";
import { badRequest } from "@/lib/http";

/** Next fire time after `from`, or null if the expression is invalid. */
export function nextRun(cron, timezone = "UTC", from = new Date()) {
  try {
    return CronExpressionParser.parse(cron, { currentDate: from, tz: timezone })
      .next()
      .toDate();
  } catch {
    return null;
  }
}

/** Validate at write time so a bad cron can never wedge the worker. */
export function assertValidCron(cron, timezone = "UTC") {
  if (!nextRun(cron, timezone)) {
    throw badRequest(`"${cron}" is not a valid cron expression`);
  }
}

/** Resolve a schedule's target to concrete label ids within its store. */
export async function resolveTargets(schedule) {
  const target = schedule.target ?? {};
  const where = { storeId: schedule.storeId };

  if (!target.allLabels) {
    const or = [];
    if (target.groupIds?.length) or.push({ groupId: { in: target.groupIds } });
    if (target.labelIds?.length) or.push({ id: { in: target.labelIds } });
    if (!or.length) return [];
    where.OR = or;
  }

  const labels = await prisma.label.findMany({ where, select: { id: true } });
  return labels.map((l) => l.id);
}

/**
 * Fire every schedule whose nextRunAt has passed.
 * Each is advanced before it runs, so a slow store cannot cause a double-fire.
 */
export async function runDueSchedules(now = new Date()) {
  const due = await prisma.scheduledUpdate.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    take: 50,
  });

  let fired = 0;
  for (const schedule of due) {
    const advanceTo = nextRun(schedule.cron, schedule.timezone, now);

    // Advance first: if enqueueing throws, we skip a beat rather than spin.
    await prisma.scheduledUpdate.update({
      where: { id: schedule.id },
      data: { nextRunAt: advanceTo, lastRunAt: now },
    });
    if (!advanceTo) {
      await prisma.scheduledUpdate.update({
        where: { id: schedule.id },
        data: { enabled: false, lastResult: "Disabled — invalid cron expression" },
      });
      continue;
    }

    try {
      const labelIds = await resolveTargets(schedule);

      if (schedule.templateId && labelIds.length) {
        await prisma.label.updateMany({
          where: { id: { in: labelIds }, storeId: schedule.storeId },
          data: { templateId: schedule.templateId },
        });
      }

      await enqueuePush({
        storeId: schedule.storeId,
        labelIds,
        operatorId: null,
        reason: "SCHEDULED",
      });

      await prisma.scheduledUpdate.update({
        where: { id: schedule.id },
        data: { lastResult: `Queued ${labelIds.length} label(s)` },
      });
      fired++;
    } catch (err) {
      await prisma.scheduledUpdate.update({
        where: { id: schedule.id },
        data: { lastResult: `Failed: ${err.message}` },
      });
    }
  }
  return fired;
}
