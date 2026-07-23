// -----------------------------------------------------------------------------
// lib/stats.js — shared plumbing for the Statistical Analysis tabs.
//
// Two things every analytics route needs and must agree on:
//
//  1. A window. If the list tab and the chart above it resolve "last 30 days"
//     differently the page contradicts itself, so resolution happens once here.
//  2. Time-zone-correct bucketing. Timestamps are stored naive-UTC, but a "day"
//     on a merchandiser's chart is a day in the *store's* zone. Bucketing in UTC
//     silently shifts every Riyadh evening into the next day's bar — wrong in a
//     way nobody notices until they reconcile against the till.
//
// The SQL half of (2) is `("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE $tz)`:
// the first cast says "this naive timestamp is UTC", the second rotates it into
// the store zone. The JS half below must produce identical keys so zero-filling
// lines up.
// -----------------------------------------------------------------------------
import { z } from "zod";
import prisma from "@/lib/prisma";
import { listQuerySchema } from "@/lib/query";

/** to_char() formats, one per granularity. Never built from user input. */
export const BUCKET_FORMAT = {
  hour: 'YYYY-MM-DD HH24":00"',
  day: "YYYY-MM-DD",
};

export const granularitySchema = z.enum(["hour", "day"]).default("day");

/** How far back a tab looks when the caller gives no `from`. */
export const rangeSchema = z.coerce.number().int().min(1).max(365);

/**
 * Resolve `from`/`to`/`days` into a concrete window.
 * `to` defaults to now; `from` to `days` before it.
 */
export function resolveWindow({ from, to, days } = {}, defaultDays = 30) {
  const end = to ?? new Date();
  const start = from ?? new Date(end.getTime() - (days ?? defaultDays) * 86_400_000);
  return { from: start, to: end };
}

/** Wall-clock offset of `tz` at `date`, in ms (positive east of Greenwich). */
function offsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant at which the store-local day containing `date` began. */
export function startOfLocalDay(date, tz) {
  const off = offsetMs(date, tz);
  const local = new Date(date.getTime() + off);
  const midnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  let instant = new Date(midnight - off);
  // Re-check across a DST edge: the offset at midnight may differ from the
  // offset at `date`, and the second guess is always the right one.
  const off2 = offsetMs(instant, tz);
  if (off2 !== off) instant = new Date(midnight - off2);
  return instant;
}

/** The bucket key `date` falls into — must match BUCKET_FORMAT exactly. */
export function bucketKey(date, granularity, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  return granularity === "hour" ? `${day} ${p.hour}:00` : day;
}

/**
 * Every bucket key in [from, to], in order, so a chart gets zero-filled gaps
 * instead of a line that jumps over quiet nights.
 *
 * Walks hourly even for day buckets and de-dupes: that stays correct across a
 * DST transition, where a local day is 23 or 25 hours long.
 */
export function bucketKeys(from, to, granularity, tz) {
  const keys = [];
  const seen = new Set();
  const push = (d) => {
    const k = bucketKey(d, granularity, tz);
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  };

  const MAX = 20_000; // ~2 years of hourly buckets; a runaway range stops here
  let t = from.getTime();
  for (let i = 0; t <= to.getTime() && i < MAX; i++, t += 3_600_000) push(new Date(t));
  push(to);
  return keys;
}

/** Merge SQL rows keyed by `bucket` onto the full key list. */
export function fillBuckets(keys, rows, shape) {
  const byKey = new Map(rows.map((r) => [r.bucket, r]));
  return keys.map((bucket) => shape(bucket, byKey.get(bucket)));
}

/** COUNT() arrives as BigInt, which JSON.stringify refuses outright. */
export const num = (v) => (v == null ? null : Number(v));

/**
 * The store's tunables from the Parameter Settings tab, with the defaults the
 * rest of the app assumes when a store has never opened that tab.
 */
export async function storeParameters(storeId) {
  const settings = await prisma.storeSettings.findUnique({ where: { storeId } });
  const p = settings?.parameters ?? {};
  return {
    lowBatteryThreshold: Number(p.lowBatteryThreshold ?? 20),
    offlineAfterMinutes: Number(p.offlineAfterMinutes ?? 60),
    pushMaxAttempts: Number(p.pushMaxAttempts ?? 5),
  };
}

// ------------------------------ operation filters ----------------------------
// Shared by the Operation Record tab and its CSV export: if the two disagree on
// a filter, the export silently lies about what the user was looking at.

export const OPERATION_SORTABLE = ["createdAt", "operationType", "result", "durationMs", "mac"];

export const operationTypeEnum = z.enum([
  "PUSH",
  "REFRESH",
  "BIND",
  "UNBIND",
  "LED_FLASH",
  "REBOOT",
  "FIRMWARE_UPDATE",
  "IMPORT",
  "SCHEDULED_PUSH",
]);

export const operationResultEnum = z.enum(["SUCCESS", "FAILURE", "PENDING"]);

export const operationListQuerySchema = listQuerySchema.extend({
  operationType: operationTypeEnum.optional(),
  result: operationResultEnum.optional(),
  labelId: z.string().trim().max(64).optional(),
});

export function operationWhere(storeId, params) {
  return {
    storeId,
    ...(params.operationType && { operationType: params.operationType }),
    ...(params.result && { result: params.result }),
    ...(params.labelId && { labelId: params.labelId }),
    ...((params.from || params.to) && {
      createdAt: {
        ...(params.from && { gte: params.from }),
        ...(params.to && { lte: params.to }),
      },
    }),
    ...(params.q && {
      OR: [
        { mac: { contains: params.q, mode: "insensitive" } },
        { groupName: { contains: params.q, mode: "insensitive" } },
      ],
    }),
  };
}
