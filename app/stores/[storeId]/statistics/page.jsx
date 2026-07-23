"use client";
// Statistical Analysis — seven views over the audit and telemetry tables.
// Each tab owns its own useList/fetch so switching never refetches the others.
import { use, useCallback, useEffect, useState } from "react";
import { api, download, qs } from "@/lib/client/api";
import { useList } from "@/lib/client/useList";
import { DataTable } from "@/components/DataTable";
import { BarChart, LineChart, Legend } from "@/components/charts";
import {
  Btn, Card, Chip, DebouncedSearch, Select, Spinner, Tabs, dateTime,
} from "@/components/ui";

const TABS = [
  { id: "operations", label: "Operation Record" },
  { id: "performance", label: "Update Performance" },
  { id: "offline", label: "Offline History" },
  { id: "changes", label: "Data Changes" },
  { id: "deletions", label: "Deletion Log" },
  { id: "traffic", label: "Traffic Analytics" },
  { id: "environment", label: "Temperature & Humidity" },
];

const RESULT_TONE = { SUCCESS: "ok", FAILURE: "bad", PENDING: "warn" };

const ms = (v) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${v}ms`);

function duration(sec) {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Shared from/to control — every tab is a window over the same timeline. */
function RangePicker({ list, extra }) {
  return (
    <>
      <input type="date" className="input" style={{ width: "auto" }}
        value={list.params.from?.slice(0, 10) ?? ""}
        onChange={(e) => list.setFilter({
          from: e.target.value ? new Date(e.target.value).toISOString() : "",
        })} />
      <span className="faint">→</span>
      <input type="date" className="input" style={{ width: "auto" }}
        value={list.params.to?.slice(0, 10) ?? ""}
        onChange={(e) => list.setFilter({
          to: e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : "",
        })} />
      {extra}
    </>
  );
}

/** Small tile row used by the aggregate tabs. */
function Stats({ items }) {
  return (
    <div className="grid" style={{
      gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", marginBottom: 16,
    }}>
      {items.map(([label, value, tone]) => (
        <Card key={label}>
          <div className="stat" style={{ fontSize: 22, color: tone }}>{value}</div>
          <div className="stat-label">{label}</div>
        </Card>
      ))}
    </div>
  );
}

/** Aggregate tabs are plain fetches, not lists — one hook for all of them. */
function useAggregate(path, params) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const key = qs(params);

  useEffect(() => {
    let live = true;
    setData(null);
    api.get(`${path}${key}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [path, key]);

  return { data, error };
}

/* ------------------------------ operations -------------------------------- */

function Operations({ storeId }) {
  const list = useList(`/stores/${storeId}/statistics/operations`, { sort: "createdAt" });
  return (
    <DataTable
      list={list} storeId={storeId} tableKey="operations"
      emptyMessage="No operations recorded in this window."
      columns={[
        { key: "createdAt", header: "Time", sortable: true, required: true,
          render: (r) => dateTime(r.createdAt) },
        { key: "mac", header: "MAC", required: true,
          render: (r) => <span className="mono">{r.mac ?? "—"}</span> },
        { key: "groupName", header: "Group" },
        { key: "operationType", header: "Type", sortable: true,
          render: (r) => <Chip>{r.operationType}</Chip> },
        { key: "result", header: "Result", sortable: true, required: true,
          render: (r) => <Chip tone={RESULT_TONE[r.result]}>{r.result}</Chip> },
        { key: "durationMs", header: "Duration", sortable: true, align: "right",
          render: (r) => <span className="mono">{ms(r.durationMs)}</span> },
        { key: "detail", header: "Detail",
          render: (r) => <span className="faint">{r.detail ?? "—"}</span> },
        { key: "snapshot", header: "Product",
          render: (r) => r.snapshot?.name ?? "—" },
      ]}
      toolbar={
        <>
          <DebouncedSearch value={list.params.q} onChange={(q) => list.setFilter({ q })}
            placeholder="MAC or group…" />
          <select className="select" style={{ width: "auto" }}
            value={list.params.operationType ?? ""}
            onChange={(e) => list.setFilter({ operationType: e.target.value })}>
            <option value="">All types</option>
            {["PUSH", "SCHEDULED_PUSH", "REFRESH", "BIND", "UNBIND", "LED_FLASH",
              "REBOOT", "FIRMWARE_UPDATE", "IMPORT"].map((t) =>
              <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="select" style={{ width: "auto" }}
            value={list.params.result ?? ""}
            onChange={(e) => list.setFilter({ result: e.target.value })}>
            <option value="">All results</option>
            {["SUCCESS", "FAILURE", "PENDING"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <RangePicker list={list} />
          <Btn onClick={() =>
            download(`/stores/${storeId}/statistics/operations/export${list.exportQuery}`)}>
            ↧ Export
          </Btn>
        </>
      }
    />
  );
}

/* ------------------------------ performance ------------------------------- */

const PERF_SERIES = [
  { key: "succeeded", label: "Succeeded", color: "var(--accent)" },
  { key: "failed", label: "Failed", color: "var(--bad)" },
];
const LATENCY_SERIES = [
  { key: "p50Ms", label: "p50", color: "var(--blue)" },
  { key: "p95Ms", label: "p95", color: "var(--warn)" },
];

function Performance({ storeId }) {
  const [days, setDays] = useState(30);
  const { data, error } = useAggregate(`/stores/${storeId}/statistics/performance`, { days });

  if (error) return <Card><div className="empty">{error}</div></Card>;
  if (!data) return <Card><div className="empty"><Spinner /> Loading…</div></Card>;

  const t = data.totals;
  const daily = (data.daily ?? []).map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString(undefined, { month: "numeric", day: "numeric" }),
  }));

  return (
    <>
      <div className="toolbar">
        <Select label="" value={days} onChange={(e) => setDays(Number(e.target.value))}
          options={[7, 14, 30, 90].map((n) => ({ value: n, label: `Last ${n} days` }))} />
      </div>

      <Stats items={[
        ["Attempts", t.attempts.toLocaleString()],
        ["Succeeded", t.succeeded.toLocaleString(), "var(--ok)"],
        ["Failed", t.failed.toLocaleString(), "var(--bad)"],
        ["Success rate", `${t.successRate}%`,
          t.successRate >= 95 ? "var(--ok)" : t.successRate >= 80 ? "var(--warn)" : "var(--bad)"],
        ["Average", ms(t.avgMs)],
        ["p50", ms(t.p50Ms)],
        ["p95", ms(t.p95Ms), "var(--warn)"],
        ["Slowest", ms(t.maxMs)],
      ]} />

      <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
        <Card>
          <div className="inline" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <b>Outcomes per day</b><Legend series={PERF_SERIES} />
          </div>
          {daily.length ? <BarChart data={daily} series={PERF_SERIES} />
            : <div className="empty">No data.</div>}
        </Card>
        <Card>
          <div className="inline" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <b>Latency percentiles</b><Legend series={LATENCY_SERIES} />
          </div>
          {daily.length ? <LineChart data={daily} series={LATENCY_SERIES}
            valueFormat={(v) => `${Math.round(v)}ms`} />
            : <div className="empty">No data.</div>}
        </Card>
      </div>
    </>
  );
}

/* -------------------------------- offline --------------------------------- */

function Offline({ storeId }) {
  const list = useList(`/stores/${storeId}/statistics/offline`, { sort: "offlineAt" });
  const s = list.raw?.summary;

  return (
    <>
      {s && (
        <>
          <Stats items={[
            ["Incidents", s.incidents ?? 0],
            ["Still offline", s.openIncidents ?? 0,
              s.openIncidents ? "var(--bad)" : "var(--ok)"],
            ["Total downtime", duration(s.totalDowntimeSec)],
            ["Average", duration(s.avgDowntimeSec)],
            ["Longest", duration(s.longestDowntimeSec), "var(--warn)"],
          ]} />

          {s.worstOffenders?.length > 0 && (
            <Card style={{ marginBottom: 16 }}>
              <b style={{ fontSize: 13 }}>Worst offenders</b>
              <div style={{ marginTop: 10 }}>
                {s.worstOffenders.map((w) => (
                  <div key={w.deviceId} className="kv" style={{ padding: "5px 0" }}>
                    <span className="k mono">{w.mac}</span>
                    <span>
                      <span className="faint" style={{ marginRight: 10 }}>
                        {w.incidents} incident{w.incidents === 1 ? "" : "s"}
                      </span>
                      <b>{duration(w.downtimeSec)}</b>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      <DataTable
        list={list} storeId={storeId} tableKey="offline"
        emptyMessage="No offline incidents recorded."
        columns={[
          { key: "mac", header: "Device", required: true,
            render: (r) => <span className="mono">{r.mac}</span> },
          { key: "deviceType", header: "Type", render: (r) => <Chip>{r.deviceType}</Chip> },
          { key: "offlineAt", header: "Went offline", sortable: true, required: true,
            render: (r) => dateTime(r.offlineAt) },
          { key: "onlineAt", header: "Recovered",
            render: (r) => r.onlineAt
              ? dateTime(r.onlineAt)
              : <Chip tone="bad">still offline</Chip> },
          { key: "durationSec", header: "Downtime", sortable: true, align: "right",
            render: (r) => duration(r.durationSec) },
        ]}
        toolbar={
          <>
            <select className="select" style={{ width: "auto" }}
              value={list.params.deviceType ?? ""}
              onChange={(e) => list.setFilter({ deviceType: e.target.value })}>
              <option value="">All devices</option>
              <option value="LABEL">Labels</option>
              <option value="GATEWAY">Gateways</option>
            </select>
            <RangePicker list={list} />
          </>
        }
      />
    </>
  );
}

/* ---------------------------- changes / deletions ------------------------- */

function Changes({ storeId }) {
  const list = useList(`/stores/${storeId}/statistics/changes`, { sort: "createdAt" });
  return (
    <DataTable
      list={list} storeId={storeId} tableKey="changes"
      emptyMessage="No changes recorded."
      columns={[
        { key: "createdAt", header: "Time", sortable: true, required: true,
          render: (r) => dateTime(r.createdAt) },
        { key: "entity", header: "Entity", sortable: true, required: true,
          render: (r) => <Chip>{r.entity}</Chip> },
        { key: "field", header: "Field", render: (r) => <span className="mono">{r.field}</span> },
        { key: "oldValue", header: "From",
          render: (r) => <span className="faint mono">{r.oldValue ?? "∅"}</span> },
        { key: "newValue", header: "To",
          render: (r) => <span className="mono">{r.newValue ?? "∅"}</span> },
        { key: "entityId", header: "Record",
          render: (r) => <span className="faint mono">{r.entityId.slice(-8)}</span> },
      ]}
      toolbar={
        <>
          <DebouncedSearch value={list.params.q} onChange={(q) => list.setFilter({ q })}
            placeholder="Field or value…" />
          <select className="select" style={{ width: "auto" }}
            value={list.params.entity ?? ""}
            onChange={(e) => list.setFilter({ entity: e.target.value })}>
            <option value="">All entities</option>
            {["Product", "Label", "Gateway", "Template", "LabelGroup", "StoreSettings",
              "ScheduledUpdate", "TemplateStrategy"].map((x) =>
              <option key={x} value={x}>{x}</option>)}
          </select>
          <RangePicker list={list} />
        </>
      }
    />
  );
}

function Deletions({ storeId }) {
  const list = useList(`/stores/${storeId}/statistics/deletions`, { sort: "createdAt" });
  return (
    <DataTable
      list={list} storeId={storeId} tableKey="deletions"
      emptyMessage="Nothing has been deleted."
      columns={[
        { key: "createdAt", header: "Time", sortable: true, required: true,
          render: (r) => dateTime(r.createdAt) },
        { key: "entity", header: "Entity", sortable: true, required: true,
          render: (r) => <Chip>{r.entity}</Chip> },
        { key: "entityId", header: "Record",
          render: (r) => <span className="faint mono">{r.entityId.slice(-8)}</span> },
        { key: "snapshot", header: "Snapshot", required: true,
          render: (r) => (
            <span className="mono faint" style={{ fontSize: 11.5 }}>
              {r.snapshot?.name ?? r.snapshot?.code ?? r.snapshot?.mac ?? "—"}
            </span>
          ) },
      ]}
      toolbar={<RangePicker list={list} />}
    />
  );
}

/* -------------------------------- traffic --------------------------------- */

const TRAFFIC_SERIES = [
  { key: "succeeded", label: "Succeeded", color: "var(--accent)" },
  { key: "failed", label: "Failed", color: "var(--bad)" },
];

function Traffic({ storeId }) {
  const [granularity, setGranularity] = useState("day");
  const [days, setDays] = useState(7);
  const { data, error } = useAggregate(`/stores/${storeId}/statistics/traffic`,
    { granularity, days });

  if (error) return <Card><div className="empty">{error}</div></Card>;
  if (!data) return <Card><div className="empty"><Spinner /> Loading…</div></Card>;

  const series = (data.series ?? []).map((d) => ({
    ...d,
    label: granularity === "hour"
      ? new Date(d.bucket).toLocaleTimeString(undefined, { hour: "2-digit" })
      : new Date(d.bucket).toLocaleDateString(undefined, { month: "numeric", day: "numeric" }),
  }));

  return (
    <>
      <div className="toolbar">
        <Select label="" value={granularity} onChange={(e) => setGranularity(e.target.value)}
          options={[{ value: "day", label: "By day" }, { value: "hour", label: "By hour" }]} />
        <Select label="" value={days} onChange={(e) => setDays(Number(e.target.value))}
          options={[1, 7, 14, 30].map((n) => ({ value: n, label: `Last ${n} days` }))} />
      </div>

      <Stats items={[
        ["Total operations", (data.total ?? 0).toLocaleString()],
        ["Peak bucket", data.peak?.total ?? 0, "var(--blue)"],
        ["Peak at", data.peak?.bucket ?? "—"],
      ]} />

      <Card style={{ marginBottom: 14 }}>
        <div className="inline" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <b>Operation volume</b><Legend series={TRAFFIC_SERIES} />
        </div>
        {series.length ? <BarChart data={series} series={TRAFFIC_SERIES} />
          : <div className="empty">No traffic in this window.</div>}
      </Card>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
        <Card>
          <b style={{ fontSize: 13 }}>By operation type</b>
          <div style={{ marginTop: 10 }}>
            {(data.byOperationType ?? []).map((r) => (
              <div key={r.operationType} className="kv" style={{ padding: "4px 0" }}>
                <span className="k">{r.operationType}</span>
                <b className="mono">{r.count}</b>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <b style={{ fontSize: 13 }}>By hour of day</b>
          <div style={{ marginTop: 10 }}>
            <BarChart height={150}
              data={(data.byHourOfDay ?? []).map((h) => ({ ...h, label: `${h.hour}` }))}
              series={[{ key: "total", label: "Operations", color: "var(--blue)" }]} />
          </div>
        </Card>
      </div>
    </>
  );
}

/* ------------------------------ environment ------------------------------- */

const TEMP_SERIES = [
  { key: "tMin", label: "Min °C", color: "var(--blue)" },
  { key: "tAvg", label: "Avg °C", color: "var(--accent)" },
  { key: "tMax", label: "Max °C", color: "var(--bad)" },
];

function Environment({ storeId }) {
  const [granularity, setGranularity] = useState("day");
  const [days, setDays] = useState(7);
  const { data, error } = useAggregate(`/stores/${storeId}/statistics/environment`,
    { granularity, days });

  if (error) return <Card><div className="empty">{error}</div></Card>;
  if (!data) return <Card><div className="empty"><Spinner /> Loading…</div></Card>;

  const t = data.totals;
  // Flatten the nested min/max/avg so the chart can address them as plain keys.
  const series = (data.series ?? []).map((d) => ({
    label: granularity === "hour"
      ? new Date(d.bucket).toLocaleTimeString(undefined, { hour: "2-digit" })
      : new Date(d.bucket).toLocaleDateString(undefined, { month: "numeric", day: "numeric" }),
    tMin: d.temperature?.min, tAvg: d.temperature?.avg, tMax: d.temperature?.max,
    hAvg: d.humidity?.avg,
  }));

  return (
    <>
      <div className="toolbar">
        <Select label="" value={granularity} onChange={(e) => setGranularity(e.target.value)}
          options={[{ value: "day", label: "By day" }, { value: "hour", label: "By hour" }]} />
        <Select label="" value={days} onChange={(e) => setDays(Number(e.target.value))}
          options={[1, 7, 14, 30].map((n) => ({ value: n, label: `Last ${n} days` }))} />
      </div>

      {t.readings === 0 ? (
        <Card><div className="empty">
          No sensor readings. Only sensor-equipped labels report temperature and humidity.
        </div></Card>
      ) : (
        <>
          <Stats items={[
            ["Readings", t.readings.toLocaleString()],
            ["Sensors", t.labels],
            ["Min °C", t.temperature?.min ?? "—", "var(--blue)"],
            ["Avg °C", t.temperature?.avg ?? "—"],
            ["Max °C", t.temperature?.max ?? "—", "var(--bad)"],
            ["Avg RH %", t.humidity?.avg ?? "—", "var(--blue)"],
          ]} />

          <Card style={{ marginBottom: 14 }}>
            <div className="inline" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <b>Temperature</b><Legend series={TEMP_SERIES} />
            </div>
            <LineChart data={series} series={TEMP_SERIES} valueFormat={(v) => `${v}°`} />
          </Card>

          <Card>
            <b style={{ fontSize: 13 }}>Latest per sensor</b>
            <div className="table-wrap" style={{ marginTop: 10, border: "none" }}>
              <table className="data">
                <thead><tr><th>MAC</th><th className="right">Temp °C</th>
                  <th className="right">RH %</th><th>Recorded</th></tr></thead>
                <tbody>
                  {(data.latest ?? []).map((r) => (
                    <tr key={r.labelId}>
                      <td className="mono">{r.mac}</td>
                      <td className="right mono">{r.temperature ?? "—"}</td>
                      <td className="right mono">{r.humidity ?? "—"}</td>
                      <td className="faint">{dateTime(r.recordedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

/* -------------------------------- screen ---------------------------------- */

export default function StatisticsPage({ params }) {
  const { storeId } = use(params);
  const [tab, setTab] = useState("operations");

  const Panel = {
    operations: Operations, performance: Performance, offline: Offline,
    changes: Changes, deletions: Deletions, traffic: Traffic, environment: Environment,
  }[tab];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Statistical Analysis</h1>
          <div className="sub">Operational history and telemetry</div>
        </div>
      </div>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <Panel storeId={storeId} />
    </div>
  );
}
