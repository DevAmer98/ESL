// -----------------------------------------------------------------------------
// Statistical Analysis → Offline History.
//
// The list alone answers "what happened"; the summary answers the question the
// tab is actually opened for — "which tag keeps dropping off". Worst-offender
// ranking is by cumulative downtime, not incident count: forty clean
// reconnections matter less than one shelf dark for a day.
// -----------------------------------------------------------------------------
import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, query } from "@/lib/http";
import { listQuerySchema, paginate, page } from "@/lib/query";
import { num } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTABLE = ["offlineAt", "onlineAt", "durationSec", "mac", "deviceType"];

const offlineQuerySchema = listQuerySchema.extend({
  deviceType: z.enum(["LABEL", "GATEWAY"]).optional(),
  open: z.enum(["true", "false"]).optional(),
});

export const GET = withStore(async (req, { store }) => {
  const params = query(req, offlineQuerySchema);

  const where = {
    storeId: store.id,
    ...(params.deviceType && { deviceType: params.deviceType }),
    ...(params.open === "true" && { onlineAt: null }),
    ...(params.open === "false" && { onlineAt: { not: null } }),
    ...(params.q && { mac: { contains: params.q, mode: "insensitive" } }),
    ...((params.from || params.to) && {
      offlineAt: {
        ...(params.from && { gte: params.from }),
        ...(params.to && { lte: params.to }),
      },
    }),
  };

  const [items, total, agg, open, worst] = await Promise.all([
    prisma.offlineHistory.findMany({ where, ...paginate(params, SORTABLE, "offlineAt") }),
    prisma.offlineHistory.count({ where }),
    prisma.offlineHistory.aggregate({
      where,
      _sum: { durationSec: true },
      _avg: { durationSec: true },
      _max: { durationSec: true },
    }),
    prisma.offlineHistory.count({ where: { ...where, onlineAt: null } }),
    // Closed incidents only: an incident still open has a null durationSec,
    // which Postgres sorts NULLS FIRST on DESC and would otherwise park every
    // unmeasured device at the top of a chart about measured downtime.
    prisma.offlineHistory.groupBy({
      by: ["deviceId", "mac", "deviceType"],
      where: { ...where, durationSec: { not: null } },
      _sum: { durationSec: true },
      _count: { _all: true },
      orderBy: { _sum: { durationSec: "desc" } },
      take: 10,
    }),
  ]);

  return ok({
    ...page(items, total, params),
    summary: {
      incidents: total,
      openIncidents: open,
      totalDowntimeSec: agg._sum.durationSec ?? 0,
      avgDowntimeSec: agg._avg.durationSec == null ? null : Math.round(agg._avg.durationSec),
      longestDowntimeSec: agg._max.durationSec ?? null,
      worstOffenders: worst.map((w) => ({
        deviceId: w.deviceId,
        mac: w.mac,
        deviceType: w.deviceType,
        incidents: num(w._count._all),
        downtimeSec: w._sum.durationSec ?? 0,
      })),
    },
  });
});
