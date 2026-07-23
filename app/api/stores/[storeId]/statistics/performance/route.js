// -----------------------------------------------------------------------------
// Statistical Analysis → Update Performance.
//
// Percentiles come from percentile_cont in Postgres rather than sorting rows in
// JS. Beyond speed, that keeps p95 honest: a JS implementation would only ever
// see the page of rows we fetched, and a p95 of a sample is not a p95.
// -----------------------------------------------------------------------------
import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, query } from "@/lib/http";
import {
  BUCKET_FORMAT,
  bucketKeys,
  fillBuckets,
  num,
  operationTypeEnum,
  rangeSchema,
  resolveWindow,
  startOfLocalDay,
} from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const performanceQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  days: rangeSchema.default(30),
  operationType: operationTypeEnum.optional(),
});

export const GET = withStore(async (req, { store }) => {
  const params = query(req, performanceQuerySchema);
  const tz = store.timezone || "UTC";
  const { from: rawFrom, to } = resolveWindow(params, 30);
  // Align to a local midnight so the series has whole days at both ends.
  const from = params.from ?? startOfLocalDay(rawFrom, tz);

  // A null operationType filter must not become `operationType = NULL`, which
  // matches nothing — the OR short-circuits it instead.
  const type = params.operationType ?? null;

  const [totals, series] = await Promise.all([
    prisma.$queryRaw`
      SELECT count(*) AS attempts,
             count(*) FILTER (WHERE result = 'SUCCESS') AS succeeded,
             count(*) FILTER (WHERE result = 'FAILURE') AS failed,
             count(*) FILTER (WHERE result = 'PENDING') AS pending,
             avg("durationMs") AS avg_ms,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") AS p50_ms,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") AS p95_ms,
             min("durationMs") AS min_ms,
             max("durationMs") AS max_ms
        FROM "OperationRecord"
       WHERE "storeId" = ${store.id}
         AND "createdAt" >= ${from}
         AND "createdAt" <= ${to}
         AND (${type}::text IS NULL OR "operationType"::text = ${type}::text)
    `,
    prisma.$queryRaw`
      SELECT to_char(
               date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}),
               ${BUCKET_FORMAT.day}
             ) AS bucket,
             count(*) AS attempts,
             count(*) FILTER (WHERE result = 'SUCCESS') AS succeeded,
             count(*) FILTER (WHERE result = 'FAILURE') AS failed,
             avg("durationMs") AS avg_ms,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") AS p50_ms,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") AS p95_ms
        FROM "OperationRecord"
       WHERE "storeId" = ${store.id}
         AND "createdAt" >= ${from}
         AND "createdAt" <= ${to}
         AND (${type}::text IS NULL OR "operationType"::text = ${type}::text)
       GROUP BY 1
       ORDER BY 1
    `,
  ]);

  const t = totals[0] ?? {};
  const attempts = num(t.attempts) ?? 0;
  const succeeded = num(t.succeeded) ?? 0;
  const failed = num(t.failed) ?? 0;
  const settled = succeeded + failed;

  const round = (v) => (v == null ? null : Math.round(Number(v)));

  const keys = bucketKeys(from, to, "day", tz);
  const daily = fillBuckets(keys, series, (date, row) => {
    const a = num(row?.attempts) ?? 0;
    const s = num(row?.succeeded) ?? 0;
    const f = num(row?.failed) ?? 0;
    return {
      date,
      attempts: a,
      succeeded: s,
      failed: f,
      successRate: s + f ? Number(((s / (s + f)) * 100).toFixed(2)) : 0,
      avgMs: round(row?.avg_ms),
      p50Ms: round(row?.p50_ms),
      p95Ms: round(row?.p95_ms),
    };
  });

  return ok({
    window: { from, to, timezone: tz },
    totals: {
      attempts,
      succeeded,
      failed,
      pending: num(t.pending) ?? 0,
      successRate: settled ? Number(((succeeded / settled) * 100).toFixed(2)) : 0,
      avgMs: round(t.avg_ms),
      p50Ms: round(t.p50_ms),
      p95Ms: round(t.p95_ms),
      minMs: round(t.min_ms),
      maxMs: round(t.max_ms),
    },
    daily,
  });
});
