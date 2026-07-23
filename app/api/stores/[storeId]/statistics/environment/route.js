// -----------------------------------------------------------------------------
// Statistical Analysis → Temperature and Humidity.
//
// min/max/avg per bucket rather than raw points: a week of per-minute readings
// from sixty sensors is a quarter of a million rows, and a chart can only draw
// a few hundred. Aggregating in SQL means the response size is bounded by the
// bucket count, not by the fleet size.
// -----------------------------------------------------------------------------
import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, query, notFound } from "@/lib/http";
import {
  BUCKET_FORMAT,
  bucketKeys,
  fillBuckets,
  granularitySchema,
  num,
  rangeSchema,
  resolveWindow,
  startOfLocalDay,
} from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const environmentQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  days: rangeSchema.default(7),
  granularity: granularitySchema,
  labelId: z.string().trim().max(64).optional(),
});

/** Decimal columns arrive from pg as strings; the browser wants numbers. */
const dec = (v) => (v == null ? null : Number(Number(v).toFixed(2)));

export const GET = withStore(async (req, { store }) => {
  const params = query(req, environmentQuerySchema);
  const tz = store.timezone || "UTC";
  const { granularity } = params;
  const { from: rawFrom, to } = resolveWindow(params, 7);
  const from = params.from ?? startOfLocalDay(rawFrom, tz);

  // Prove the label is ours before it reaches the query — a labelId from another
  // tenant must 404, not quietly return their sensor history.
  if (params.labelId) {
    const owned = await prisma.label.findFirst({
      where: { id: params.labelId, storeId: store.id },
      select: { id: true },
    });
    if (!owned) throw notFound("Label not found");
  }
  const labelId = params.labelId ?? null;

  const [rows, totals, latest] = await Promise.all([
    prisma.$queryRaw`
      SELECT to_char(
               date_trunc(${granularity}, "recordedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}),
               ${BUCKET_FORMAT[granularity]}
             ) AS bucket,
             count(*) AS readings,
             min(temperature) AS temp_min,
             max(temperature) AS temp_max,
             avg(temperature) AS temp_avg,
             min(humidity) AS hum_min,
             max(humidity) AS hum_max,
             avg(humidity) AS hum_avg
        FROM "SensorReading"
       WHERE "storeId" = ${store.id}
         AND "recordedAt" >= ${from}
         AND "recordedAt" <= ${to}
         AND (${labelId}::text IS NULL OR "labelId" = ${labelId}::text)
       GROUP BY 1
       ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT count(*) AS readings,
             count(DISTINCT "labelId") AS labels,
             min(temperature) AS temp_min,
             max(temperature) AS temp_max,
             avg(temperature) AS temp_avg,
             min(humidity) AS hum_min,
             max(humidity) AS hum_max,
             avg(humidity) AS hum_avg
        FROM "SensorReading"
       WHERE "storeId" = ${store.id}
         AND "recordedAt" >= ${from}
         AND "recordedAt" <= ${to}
         AND (${labelId}::text IS NULL OR "labelId" = ${labelId}::text)
    `,
    // DISTINCT ON is the cheap way to get "newest row per label" in Postgres.
    prisma.$queryRaw`
      SELECT DISTINCT ON (s."labelId")
             s."labelId", s.temperature, s.humidity, s."recordedAt", l.mac
        FROM "SensorReading" s
        JOIN "Label" l ON l.id = s."labelId" AND l."storeId" = ${store.id}
       WHERE s."storeId" = ${store.id}
         AND (${labelId}::text IS NULL OR s."labelId" = ${labelId}::text)
       ORDER BY s."labelId", s."recordedAt" DESC
    `,
  ]);

  const keys = bucketKeys(from, to, granularity, tz);
  const series = fillBuckets(keys, rows, (bucket, row) => ({
    bucket,
    readings: num(row?.readings) ?? 0,
    temperature: {
      min: dec(row?.temp_min),
      max: dec(row?.temp_max),
      avg: dec(row?.temp_avg),
    },
    humidity: {
      min: dec(row?.hum_min),
      max: dec(row?.hum_max),
      avg: dec(row?.hum_avg),
    },
  }));

  const t = totals[0] ?? {};

  return ok({
    window: { from, to, granularity, timezone: tz, labelId },
    totals: {
      readings: num(t.readings) ?? 0,
      labels: num(t.labels) ?? 0,
      temperature: { min: dec(t.temp_min), max: dec(t.temp_max), avg: dec(t.temp_avg) },
      humidity: { min: dec(t.hum_min), max: dec(t.hum_max), avg: dec(t.hum_avg) },
    },
    series,
    latest: latest.map((r) => ({
      labelId: r.labelId,
      mac: r.mac,
      temperature: dec(r.temperature),
      humidity: dec(r.humidity),
      recordedAt: r.recordedAt,
    })),
  });
});
