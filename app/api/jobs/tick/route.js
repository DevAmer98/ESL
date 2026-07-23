// -----------------------------------------------------------------------------
// POST /api/jobs/tick — the external-cron equivalent of one worker tick.
//
// Used when WORKER_ENABLED=false (several app instances, or a platform that
// freezes idle processes). It does exactly what lib/worker.js does per tick,
// with the same error isolation: one failing section must not deny the others
// their turn.
//
// If CRON_SECRET is unset we refuse rather than run open: an unauthenticated
// endpoint that drains the push queue is a free way for anyone to hammer the
// vendor API on the tenant's behalf. Failing closed makes the misconfiguration
// loud instead of exploitable.
// -----------------------------------------------------------------------------
import { route, ok, ApiError, unauthorized } from "@/lib/http";
import { drain } from "@/lib/queue";
import { runDueSchedules } from "@/lib/services/schedules";
import { reconcileAllStores } from "@/lib/services/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorize(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new ApiError(503, "not_configured", "CRON_SECRET is not set; tick endpoint disabled");
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== secret) throw unauthorized("Invalid cron credentials");
}

export const POST = route(async (req) => {
  authorize(req);

  const started = Date.now();
  const results = {};
  const errors = [];

  const section = async (name, fn) => {
    try {
      results[name] = await fn();
    } catch (err) {
      console.error(`[tick] ${name} failed`, err);
      errors.push({ section: name, message: err.message });
      results[name] = null;
    }
  };

  await section("drained", () => drain({ limit: 20 }));
  await section("schedulesFired", () => runDueSchedules());
  await section("reconciled", () => reconcileAllStores());

  return ok({ ...results, errors, ms: Date.now() - started });
});
