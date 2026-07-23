// -----------------------------------------------------------------------------
// Statistical Analysis → Traffic Analytics: operation volume over time.
//
// The bucket unit is a bound parameter, not interpolated text — date_trunc's
// first argument is a text field, so `date_trunc($1, ts)` binds cleanly and the
// granularity param never becomes SQL.
// -----------------------------------------------------------------------------
import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, query } from "@/lib/http";
import {
  BUCKET_FORMAT,
  bucketKeys,
  fillBuckets,
  granularitySchema,
  num,
  operationTypeEnum,
  rangeSchema,
  resolveWindow,
  startOfLocalDay,
} from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const trafficQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  days: rangeSchema.default(7),
  granularity: granularitySchema,
  operationType: operationTypeEnum.optional(),
});

export const GET = withStore(async (req, { store }) => {
  const params = query(req, trafficQuerySchema);
  const tz = store.timezone || "UTC";
  const { granularity } = params;
  const { from: rawFrom, to } = resolveWindow(params, granularity === "hour" ? 2 : 7);
  const from = params.from ?? startOfLocalDay(rawFrom, tz);
  const type = params.operationType ?? null;

  const [rows, byType, byHour] = await Promise.all([
    prisma.$queryRaw`
      SELECT to_char(
               date_trunc(${granularity}, "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}),
               ${BUCKET_FORMAT[granularity]}
             ) AS bucket,
             count(*) AS total,
             count(*) FILTER (WHERE result = 'SUCCESS') AS succeeded,
             count(*) FILTER (WHERE result = 'FAILURE') AS failed,
             count(DISTINCT "labelId") AS labels
        FROM "OperationRecord"
       WHERE "storeId" = ${store.id}
         AND "createdAt" >= ${from}
         AND "createdAt" <= ${to}
         AND (${type}::text IS NULL OR "operationType"::text = ${type}::text)
       GROUP BY 1
       ORDER BY 1
    `,
    prisma.operationRecord.groupBy({
      by: ["operationType"],
      where: { storeId: store.id, createdAt: { gte: from, lte: to } },
      _count: { _all: true },
    }),
    // Hour-of-day profile: which part of the trading day the fleet is busiest.
    prisma.$queryRaw`
      SELECT extract(hour FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))::int AS hour,
             count(*) AS total
        FROM "OperationRecord"
       WHERE "storeId" = ${store.id}
         AND "createdAt" >= ${from}
         AND "createdAt" <= ${to}
       GROUP BY 1
       ORDER BY 1
    `,
  ]);

  const keys = bucketKeys(from, to, granularity, tz);
  const series = fillBuckets(keys, rows, (bucket, row) => ({
    bucket,
    total: num(row?.total) ?? 0,
    succeeded: num(row?.succeeded) ?? 0,
    failed: num(row?.failed) ?? 0,
    labels: num(row?.labels) ?? 0,
  }));

  const total = series.reduce((a, b) => a + b.total, 0);
  const peak = series.reduce((a, b) => (b.total > (a?.total ?? -1) ? b : a), null);

  return ok({
    window: { from, to, granularity, timezone: tz },
    total,
    peak,
    series,
    byOperationType: byType.map((r) => ({
      operationType: r.operationType,
      count: r._count._all,
    })),
    byHourOfDay: byHour.map((r) => ({ hour: r.hour, total: num(r.total) })),
  });
});
