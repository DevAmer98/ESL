// Next.js calls this once per server start — the right place to bring up the
// background worker. Guarded so it never runs in the edge runtime or during a
// build, and opt-out via WORKER_ENABLED=false when running an external cron.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.WORKER_ENABLED === "false") return;

  const { startWorker } = await import("@/lib/worker");
  startWorker();
}
