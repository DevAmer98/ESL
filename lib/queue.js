// -----------------------------------------------------------------------------
// lib/queue.js — durable outbox for hardware pushes.
//
// Why a queue instead of awaiting the vendor inside the request: a bulk refresh
// of 500 tags cannot live inside one HTTP request, the vendor API is flaky
// enough to need backoff, and the Statistical Analysis tabs are only honest if
// every attempt is recorded whether or not a browser was still listening.
//
// Claiming uses FOR UPDATE SKIP LOCKED, so running several app instances (or a
// separate worker process) is safe without any external broker.
// -----------------------------------------------------------------------------
import prisma from "@/lib/prisma";
import { pushToLabel, MinewError } from "@/lib/minew";
import { recordOperation } from "@/lib/audit";

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 10 * 60_000;

/** Exponential backoff with a cap: 5s, 10s, 20s, 40s … */
function backoffFor(attempt) {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

/**
 * Enqueue pushes for the given labels. Returns the created jobs.
 * @param labelIds  ids already verified to belong to `storeId`
 */
export async function enqueuePush({ storeId, labelIds, operatorId, reason = "PUSH" }) {
  if (!labelIds.length) return [];

  await prisma.pushJob.createMany({
    data: labelIds.map((labelId) => ({
      storeId,
      labelId,
      operatorId,
      payload: { reason },
    })),
  });

  // Reflect intent immediately so the UI can show "broadcasting" without
  // waiting for the worker to pick the job up.
  await prisma.label.updateMany({
    where: { id: { in: labelIds }, storeId },
    data: { status: "BROADCASTING" },
  });

  return prisma.pushJob.findMany({
    where: { storeId, labelId: { in: labelIds }, status: "QUEUED" },
    orderBy: { createdAt: "desc" },
    take: labelIds.length,
  });
}

/**
 * Atomically claim up to `limit` due jobs for this worker.
 * SKIP LOCKED means concurrent workers never fight over the same row.
 */
async function claim(limit) {
  const rows = await prisma.$queryRaw`
    UPDATE "PushJob"
       SET status = 'RUNNING', "startedAt" = NOW(), attempts = attempts + 1,
           "updatedAt" = NOW()
     WHERE id IN (
       SELECT id FROM "PushJob"
        WHERE status = 'QUEUED' AND "runAt" <= NOW()
        ORDER BY "runAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
     )
    RETURNING id, "storeId", "labelId", attempts, "maxAttempts", "operatorId", payload
  `;
  return rows;
}

/** Run one claimed job to completion, recording the outcome either way. */
async function runJob(job) {
  const startedAt = Date.now();

  const label = await prisma.label.findFirst({
    where: { id: job.labelId, storeId: job.storeId },
    include: { product: true, template: true, group: true },
  });

  if (!label) {
    await prisma.pushJob.update({
      where: { id: job.id },
      data: { status: "DEAD", finishedAt: new Date(), lastError: "Label no longer exists" },
    });
    return;
  }

  const settings = await prisma.storeSettings.findUnique({
    where: { storeId: job.storeId },
  });

  try {
    const result = await pushToLabel(settings, {
      label,
      product: label.product,
      template: label.template,
    });
    const durationMs = Date.now() - startedAt;

    await prisma.$transaction([
      prisma.pushJob.update({
        where: { id: job.id },
        data: { status: "SUCCEEDED", finishedAt: new Date(), lastError: null },
      }),
      prisma.label.update({
        where: { id: label.id },
        data: {
          status: "ONLINE",
          lastUpdateAt: new Date(),
          lastBroadcastAt: new Date(),
        },
      }),
    ]);

    await recordOperation({
      storeId: job.storeId,
      labelId: label.id,
      mac: label.mac,
      groupName: label.group?.name ?? null,
      operationType: job.payload?.reason === "SCHEDULED" ? "SCHEDULED_PUSH" : "PUSH",
      result: "SUCCESS",
      detail: result.detail,
      durationMs,
      snapshot: label.product ?? {},
      operatorId: job.operatorId,
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const retryable = err instanceof MinewError ? err.retryable : true;
    const exhausted = job.attempts >= job.maxAttempts;
    const willRetry = retryable && !exhausted;

    await prisma.pushJob.update({
      where: { id: job.id },
      data: willRetry
        ? {
            status: "QUEUED",
            runAt: new Date(Date.now() + backoffFor(job.attempts)),
            lastError: err.message,
          }
        : {
            status: exhausted ? "DEAD" : "FAILED",
            finishedAt: new Date(),
            lastError: err.message,
          },
    });

    if (!willRetry) {
      await prisma.label.update({
        where: { id: label.id },
        data: { status: "ERROR" },
      });
      await recordOperation({
        storeId: job.storeId,
        labelId: label.id,
        mac: label.mac,
        groupName: label.group?.name ?? null,
        operationType: job.payload?.reason === "SCHEDULED" ? "SCHEDULED_PUSH" : "PUSH",
        result: "FAILURE",
        detail: err.message,
        durationMs,
        snapshot: label.product ?? {},
        operatorId: job.operatorId,
      });
    }
  }
}

/**
 * Drain due jobs. Called by the in-process ticker (lib/worker.js) or by an
 * external cron hitting /api/jobs/tick.
 * @returns number of jobs processed
 */
export async function drain({ limit = 10 } = {}) {
  const jobs = await claim(limit);
  if (!jobs.length) return 0;
  // Sequential on purpose: the vendor API rate-limits, and ordering pushes per
  // store keeps the operation record readable.
  for (const job of jobs) await runJob(job);
  return jobs.length;
}

/** Re-queue dead jobs — surfaced in the UI as "Retry failed". */
export async function retryDead({ storeId, jobIds }) {
  return prisma.pushJob.updateMany({
    where: {
      storeId,
      ...(jobIds?.length ? { id: { in: jobIds } } : {}),
      status: { in: ["DEAD", "FAILED"] },
    },
    data: { status: "QUEUED", attempts: 0, runAt: new Date(), lastError: null },
  });
}
