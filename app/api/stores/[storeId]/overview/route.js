// -----------------------------------------------------------------------------
// Overview dashboard aggregate — one request, every tile and both charts.
//
// The window is anchored to store-local midnight so `weekly` really is N whole
// local days and `successRate` covers exactly the same span. That coupling is
// deliberate: the sum of the weekly bars must equal the operation count the
// Operation Record tab reports for the same range, or the dashboard is lying.
// -----------------------------------------------------------------------------
import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, query } from "@/lib/http";
import {
  BUCKET_FORMAT,
  bucketKeys,
  fillBuckets,
  num,
  rangeSchema,
  startOfLocalDay,
  storeParameters,
} from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const overviewQuerySchema = z.object({
  days: rangeSchema.default(7),
});

export const GET = withStore(async (req, { store }) => {
  const { days } = query(req, overviewQuerySchema);
  const tz = store.timezone || "UTC";

  const now = new Date();
  const from = startOfLocalDay(new Date(now.getTime() - (days - 1) * 86_400_000), tz);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const { lowBatteryThreshold } = await storeParameters(store.id);

  const [gatewayRows, labelRows, refreshRows, battery, windowRows, dailyRows, queueRows] =
    await Promise.all([
      prisma.gateway.groupBy({
        by: ["status"],
        where: { storeId: store.id },
        _count: { _all: true },
      }),
      prisma.label.groupBy({
        by: ["status"],
        where: { storeId: store.id },
        _count: { _all: true },
      }),
      prisma.operationRecord.groupBy({
        by: ["result"],
        where: { storeId: store.id, createdAt: { gte: dayAgo } },
        _count: { _all: true },
      }),
      prisma.$transaction([
        prisma.label.count({
          where: { storeId: store.id, battery: { gte: lowBatteryThreshold } },
        }),
        prisma.label.count({
          where: { storeId: store.id, battery: { lt: lowBatteryThreshold } },
        }),
      ]),
      prisma.operationRecord.groupBy({
        by: ["result"],
        where: { storeId: store.id, createdAt: { gte: from, lte: now } },
        _count: { _all: true },
      }),
      // Bucketed in SQL, not JS: this table grows without bound and pulling a
      // month of rows into the request just to count them does not survive
      // contact with production.
      prisma.$queryRaw`
        SELECT to_char(
                 date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}),
                 ${BUCKET_FORMAT.day}
               ) AS bucket,
               count(*) FILTER (WHERE result = 'SUCCESS') AS succeeded,
               count(*) FILTER (WHERE result = 'FAILURE') AS failed,
               count(*) AS total
          FROM "OperationRecord"
         WHERE "storeId" = ${store.id}
           AND "createdAt" >= ${from}
           AND "createdAt" <= ${now}
         GROUP BY 1
         ORDER BY 1
      `,
      prisma.pushJob.groupBy({
        by: ["status"],
        where: { storeId: store.id },
        _count: { _all: true },
      }),
    ]);

  const tally = (rows, key) =>
    Object.fromEntries(rows.map((r) => [r[key], r._count._all]));
  const gw = tally(gatewayRows, "status");
  const lb = tally(labelRows, "status");
  const rf = tally(refreshRows, "result");
  const win = tally(windowRows, "result");
  const q = tally(queueRows, "status");

  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  // BROADCASTING is a label mid-push: still reachable, so it counts as online.
  const labelOnline = (lb.ONLINE ?? 0) + (lb.BROADCASTING ?? 0);

  const attempted = (win.SUCCESS ?? 0) + (win.FAILURE ?? 0);

  const keys = bucketKeys(from, now, "day", tz);
  const weekly = fillBuckets(keys, dailyRows, (date, row) => ({
    date,
    succeeded: num(row?.succeeded) ?? 0,
    failed: num(row?.failed) ?? 0,
    total: num(row?.total) ?? 0,
  }));

  return ok({
    window: { from, to: now, days, timezone: tz },
    gateway: {
      online: gw.ONLINE ?? 0,
      offline: gw.OFFLINE ?? 0,
      total: sum(gw),
    },
    label: {
      online: labelOnline,
      offline: lb.OFFLINE ?? 0,
      total: sum(lb),
    },
    refresh: { success: rf.SUCCESS ?? 0, failure: rf.FAILURE ?? 0 },
    battery: { normal: battery[0], low: battery[1], threshold: lowBatteryThreshold },
    weekly,
    successRate: attempted ? Number(((win.SUCCESS ?? 0) / attempted * 100).toFixed(2)) : 0,
    operations: {
      succeeded: win.SUCCESS ?? 0,
      failed: win.FAILURE ?? 0,
      pending: win.PENDING ?? 0,
      total: sum(win),
    },
    queue: {
      queued: q.QUEUED ?? 0,
      running: q.RUNNING ?? 0,
      failed: q.FAILED ?? 0,
      dead: q.DEAD ?? 0,
    },
  });
});
