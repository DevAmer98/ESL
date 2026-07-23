"use client";
// Overview — the dashboard. Fleet health, refresh outcomes and queue depth.
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { Card, Chip, Dot, Spinner, timeAgo } from "@/components/ui";
import { BarChart, Donut, Legend } from "@/components/charts";

const WEEKLY_SERIES = [
  { key: "succeeded", label: "Succeeded", color: "var(--accent)" },
  { key: "failed", label: "Failed", color: "var(--bad)" },
];

/** Two-sided tile: the split matters more than either number alone. */
function SplitStat({ title, left, right, leftTone = "var(--ok)", rightTone = "var(--bad)" }) {
  const total = (left.value ?? 0) + (right.value ?? 0);
  const pct = total > 0 ? ((left.value ?? 0) / total) * 100 : 0;
  return (
    <Card>
      <div className="stat-label" style={{ marginBottom: 12, marginTop: 0 }}>{title}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <span className="stat" style={{ color: leftTone, fontSize: 26 }}>
            {left.value ?? 0}
          </span>
          <span className="faint" style={{ fontSize: 11, marginLeft: 5 }}>{left.label}</span>
        </div>
        <div className="right">
          <span className="stat" style={{ color: rightTone, fontSize: 26 }}>
            {right.value ?? 0}
          </span>
          <span className="faint" style={{ fontSize: 11, marginLeft: 5 }}>{right.label}</span>
        </div>
      </div>
      <div style={{ height: 4, background: rightTone, borderRadius: 4, marginTop: 10,
        overflow: "hidden", opacity: total ? 1 : 0.25 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: leftTone }} />
      </div>
    </Card>
  );
}

export default function OverviewPage({ params }) {
  const { storeId } = use(params);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.get(`/stores/${storeId}/overview`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [storeId]);

  useEffect(() => {
    load();
    // The queue drains in the background; without a poll the dashboard would
    // sit stale while pushes are visibly in flight.
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <div className="page"><Card><div className="empty">{error}</div></Card></div>;
  if (!data) return <div className="page"><Spinner /> Loading…</div>;

  const weekly = (data.weekly ?? []).map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString(undefined, { month: "numeric", day: "numeric" }),
  }));
  const success = data.refresh?.success ?? 0;
  const failure = data.refresh?.failure ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <div className="sub">Shelf-edge fleet at a glance</div>
        </div>
        <div className="inline">
          {data.queue?.queued > 0 && (
            <Chip tone="blue"><Dot tone="blue" pulse /> {data.queue.queued} queued</Chip>
          )}
          {data.queue?.dead > 0 && (
            <Link href={`/stores/${storeId}/statistics`}>
              <Chip tone="bad">{data.queue.dead} failed</Chip>
            </Link>
          )}
        </div>
      </div>

      <div className="grid" style={{
        gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", marginBottom: 18,
      }}>
        <SplitStat title="Gateway"
          left={{ value: data.gateway?.online, label: "online" }}
          right={{ value: data.gateway?.offline, label: "offline" }} />
        <SplitStat title="Labels"
          left={{ value: data.label?.online, label: "online" }}
          right={{ value: data.label?.offline, label: "offline" }} />
        <SplitStat title="Refresh · 24h"
          left={{ value: success, label: "success" }}
          right={{ value: failure, label: "failure" }} />
        <SplitStat title="Battery health"
          left={{ value: data.battery?.normal, label: "normal" }}
          right={{ value: data.battery?.low, label: "low" }}
          rightTone="var(--warn)" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) auto",
        alignItems: "start" }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", marginBottom: 14 }}>
            <b style={{ fontSize: 14 }}>Weekly update status</b>
            <Legend series={WEEKLY_SERIES} />
          </div>
          {weekly.length === 0
            ? <div className="empty">No updates recorded yet.</div>
            : <BarChart data={weekly} series={WEEKLY_SERIES} />}
        </Card>

        <Card style={{ textAlign: "center", minWidth: 240 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Success rate</div>
          <Donut value={success} total={success + failure} label="last 24h" />
          <div className="kv" style={{ marginTop: 12, fontSize: 12 }}>
            <span className="k">Succeeded</span><span style={{ color: "var(--ok)" }}>{success}</span>
          </div>
          <div className="kv" style={{ fontSize: 12 }}>
            <span className="k">Failed</span><span style={{ color: "var(--bad)" }}>{failure}</span>
          </div>
        </Card>
      </div>

      <div className="faint" style={{ fontSize: 11.5, marginTop: 14 }}>
        Updated {timeAgo(Date.now())} · refreshes every 15s
      </div>
    </div>
  );
}
