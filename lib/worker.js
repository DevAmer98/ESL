// -----------------------------------------------------------------------------
// lib/worker.js — in-process background ticker.
//
// Good enough for a single-server deployment: one interval per instance drains
// the push queue and runs due scheduled updates. If you scale to several
// instances, set WORKER_ENABLED=false everywhere and drive /api/jobs/tick from
// an external cron instead — the queue's SKIP LOCKED claiming makes either
// topology correct.
// -----------------------------------------------------------------------------
import { drain } from "@/lib/queue";
import { runDueSchedules } from "@/lib/services/schedules";
import { reconcileAllStores } from "@/lib/services/monitor";

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 5_000);

async function tick() {
  try {
    await drain({ limit: 20 });
  } catch (err) {
    console.error("[worker] drain failed", err);
  }
  try {
    await runDueSchedules();
  } catch (err) {
    console.error("[worker] schedules failed", err);
  }
  // Nothing notifies us when a tag stops broadcasting, so liveness is only ever
  // as fresh as the last reconciliation pass.
  try {
    await reconcileAllStores();
  } catch (err) {
    console.error("[worker] reconcile failed", err);
  }
}

export function startWorker() {
  const g = globalThis;
  if (g.__esl_worker) return; // survive hot-reload

  const timer = setInterval(() => {
    // Never let an unhandled rejection take the process down.
    tick().catch((err) => console.error("[worker] tick", err));
  }, TICK_MS);
  timer.unref?.();

  g.__esl_worker = timer;
  console.log(`[worker] started, tick=${TICK_MS}ms`);
}
