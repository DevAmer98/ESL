// -----------------------------------------------------------------------------
// GET /api/minew/stores/:sid/overview — dashboard stats for a Minew store.
// Returns the same shape as the local /stores/:id/overview so the UI can reuse
// its cards + charts: gateway/label/battery splits, 24h refresh, weekly buckets.
// -----------------------------------------------------------------------------
import { withAuth, ok, ApiError } from "@/lib/http";
import { accountConfig, listGatewaysFor, listTagsFor, listOperationLogs } from "@/lib/minew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOW_BATTERY = 20;
const DAY_MS = 86_400_000;
const dayKey = (d) => d.toISOString().slice(0, 10);

export const GET = withAuth(async (_req, { params }) => {
  const config = accountConfig();
  if (!config) throw new ApiError(503, "not_configured", "Minew account credentials are not set.");

  const [gateways, tags, logs] = await Promise.all([
    listGatewaysFor(config, params.sid),
    listTagsFor(config, params.sid),
    listOperationLogs(config, params.sid, { pageSize: 500 }).catch(() => []),
  ]);

  const gwOnline = gateways.filter((g) => g.online).length;
  const tagOnline = tags.filter((t) => t.online).length;
  const low = tags.filter((t) => t.battery != null && t.battery <= LOW_BATTERY).length;

  // Refresh stats from operation logs (actionType "1" = refresh; result "1" = success).
  const now = Date.now();
  const weekly = {};
  for (let i = 6; i >= 0; i--) {
    const k = dayKey(new Date(now - i * DAY_MS));
    weekly[k] = { date: k, succeeded: 0, failed: 0 };
  }
  let success = 0;
  let failure = 0;
  for (const l of logs) {
    if (String(l.actionType) !== "1") continue;
    const t = new Date(String(l.createTime ?? "").replace(" ", "T"));
    if (Number.isNaN(t.getTime())) continue;
    const good = String(l.result) === "1";
    const k = dayKey(t);
    if (weekly[k]) good ? weekly[k].succeeded++ : weekly[k].failed++;
    if (now - t.getTime() <= DAY_MS) good ? success++ : failure++;
  }

  return ok({
    gateway: { online: gwOnline, offline: gateways.length - gwOnline },
    label: { online: tagOnline, offline: tags.length - tagOnline },
    battery: { normal: tags.length - low, low },
    refresh: { success, failure },
    weekly: Object.values(weekly),
  });
});
