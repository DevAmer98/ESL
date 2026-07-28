"use client";
// A Minew store's overview — reuses the app's dashboard design (SplitStat cards,
// weekly bar chart, success donut) fed by live Minew data, plus the gateway and
// tag tables. Everything reads through /api/minew/stores/:sid/*.
import { use, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Btn, Card, Chip, Dot, Spinner, Tabs, dateTime, timeAgo } from "@/components/ui";
import { BarChart, Donut, Legend } from "@/components/charts";

const LOW_BATTERY = 20;
const WEEKLY_SERIES = [
  { key: "succeeded", label: "Succeeded", color: "var(--accent)" },
  { key: "failed", label: "Failed", color: "var(--bad)" },
];

/** Two-sided tile — the split matters more than either number alone. */
function SplitStat({ title, left, right, leftTone = "var(--ok)", rightTone = "var(--bad)" }) {
  const total = (left.value ?? 0) + (right.value ?? 0);
  const pct = total > 0 ? ((left.value ?? 0) / total) * 100 : 0;
  return (
    <Card>
      <div className="stat-label" style={{ marginBottom: 12, marginTop: 0 }}>{title}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <span className="stat" style={{ color: leftTone, fontSize: 26 }}>{left.value ?? 0}</span>
          <span className="faint" style={{ fontSize: 11, marginLeft: 5 }}>{left.label}</span>
        </div>
        <div className="right">
          <span className="stat" style={{ color: rightTone, fontSize: 26 }}>{right.value ?? 0}</span>
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

export default function MinewStoreDetail({ params }) {
  const { sid } = use(params);
  const [tab, setTab] = useState("gateways");
  const [ov, setOv] = useState({ loading: true, data: null, error: null });
  const [gw, setGw] = useState({ loading: true, data: null, error: null });
  const [tags, setTags] = useState({ loading: true, data: null, error: null });

  const loadOv = useCallback(async () => {
    setOv((s) => ({ ...s, loading: true }));
    try { setOv({ loading: false, data: await api.get(`/minew/stores/${sid}/overview`), error: null }); }
    catch (e) { setOv({ loading: false, data: null, error: e.message }); }
  }, [sid]);
  const loadGw = useCallback(async () => {
    setGw((s) => ({ ...s, loading: true }));
    try { setGw({ loading: false, data: await api.get(`/minew/stores/${sid}/gateways`), error: null }); }
    catch (e) { setGw({ loading: false, data: null, error: e.message }); }
  }, [sid]);
  const loadTags = useCallback(async () => {
    setTags((s) => ({ ...s, loading: true }));
    try { setTags({ loading: false, data: await api.get(`/minew/stores/${sid}/tags`), error: null }); }
    catch (e) { setTags({ loading: false, data: null, error: e.message }); }
  }, [sid]);

  const reload = useCallback(() => { loadOv(); loadGw(); loadTags(); }, [loadOv, loadGw, loadTags]);
  useEffect(() => { reload(); }, [reload]);

  const d = ov.data;
  const weekly = (d?.weekly ?? []).map((x) => ({
    ...x,
    label: new Date(x.date).toLocaleDateString(undefined, { month: "numeric", day: "numeric" }),
  }));
  const success = d?.refresh?.success ?? 0;
  const failure = d?.refresh?.failure ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Store Overview</h1>
          <div className="sub mono">{sid}</div>
        </div>
        <Btn onClick={reload}>↻ Reload</Btn>
      </div>

      {ov.error && <Card><div className="empty" style={{ color: "var(--bad)" }}>{ov.error}</div></Card>}

      <div className="grid" style={{
        gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", marginBottom: 18,
      }}>
        <SplitStat title="Gateway"
          left={{ value: d?.gateway?.online, label: "online" }}
          right={{ value: d?.gateway?.offline, label: "offline" }} />
        <SplitStat title="ESL"
          left={{ value: d?.label?.online, label: "online" }}
          right={{ value: d?.label?.offline, label: "offline" }} />
        <SplitStat title="Refresh · 24h"
          left={{ value: success, label: "success" }}
          right={{ value: failure, label: "failure" }} />
        <SplitStat title="Battery health"
          left={{ value: d?.battery?.normal, label: "normal" }}
          right={{ value: d?.battery?.low, label: "low" }}
          rightTone="var(--warn)" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) auto",
        alignItems: "start", marginBottom: 18 }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", marginBottom: 14 }}>
            <b style={{ fontSize: 14 }}>Weekly update status</b>
            <Legend series={WEEKLY_SERIES} />
          </div>
          {weekly.every((w) => !w.succeeded && !w.failed)
            ? <div className="empty">No updates recorded this week.</div>
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

      <Tabs
        tabs={[
          { id: "gateways", label: gw.data ? `Gateways (${gw.data.online}/${gw.data.total})` : "Gateways" },
          { id: "tags", label: tags.data ? `Tags (${tags.data.online}/${tags.data.total})` : "Tags" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "gateways" && <GatewaysTable state={gw} />}
      {tab === "tags" && <TagsTable state={tags} />}
    </div>
  );
}

function StatusPill({ online }) {
  return (
    <Chip tone={online ? "ok" : "bad"}>
      <Dot tone={online ? "ok" : "bad"} pulse={online} />{online ? "online" : "offline"}
    </Chip>
  );
}

function Battery({ v }) {
  if (v == null) return <span className="faint">—</span>;
  const tone = v <= 20 ? "var(--bad)" : v <= 50 ? "var(--warn)" : "var(--ok)";
  return (
    <span className="inline" style={{ gap: 8 }}>
      <span style={{ width: 34, height: 6, borderRadius: 4, background: "var(--line)",
        overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(100, v))}%`,
          background: tone }} />
      </span>
      <span style={{ color: tone, fontSize: 12 }}>{v}%</span>
    </span>
  );
}

function Rssi({ v }) {
  if (v == null) return <span className="faint">—</span>;
  const tone = v >= -60 ? "var(--ok)" : v >= -80 ? "var(--warn)" : "var(--bad)";
  return <span className="mono" style={{ color: tone }}>{v}</span>;
}

function TableState({ state, children, empty }) {
  if (state.loading) return <Card><div className="empty"><Spinner /> Loading…</div></Card>;
  if (state.error) return <Card><div className="empty" style={{ color: "var(--bad)" }}>{state.error}</div></Card>;
  if (!children) return <Card><div className="empty">{empty}</div></Card>;
  return <div className="table-wrap">{children}</div>;
}

function GatewaysTable({ state }) {
  const rows = state.data?.gateways ?? [];
  return (
    <TableState state={state} empty="No gateways in this store.">
      {rows.length ? (
        <table className="data">
          <thead><tr>
            <th>Status</th><th>Name</th><th>MAC</th><th>Model</th>
            <th>IP</th><th>WiFi FW</th><th>BLE FW</th><th>Last seen</th>
          </tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.mac}>
                <td><StatusPill online={g.online} /></td>
                <td style={{ fontWeight: 600 }}>{g.name}</td>
                <td className="mono">{g.mac}</td>
                <td>{g.model ? <Chip>{g.model}</Chip> : "—"}</td>
                <td className="mono">{g.ip ?? "—"}</td>
                <td className="mono faint">{g.wifiFirmware ?? "—"}</td>
                <td className="mono faint">{g.bleFirmware ?? "—"}</td>
                <td className="faint" title={dateTime(g.lastSeenAt)}>
                  {g.lastSeenAt ? timeAgo(g.lastSeenAt) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </TableState>
  );
}

function TagsTable({ state }) {
  const rows = state.data?.tags ?? [];
  return (
    <TableState state={state} empty="No tags in this store.">
      {rows.length ? (
        <table className="data">
          <thead><tr>
            <th>Status</th><th>MAC</th><th>Size</th><th>Color</th>
            <th>Battery</th><th>RSSI</th><th>Bound to</th><th>Last update</th>
          </tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.mac}>
                <td><StatusPill online={t.online} /></td>
                <td className="mono" style={{ fontWeight: 600 }}>{t.mac}</td>
                <td>{t.sizeInches ? `${t.sizeInches}"` : "—"}</td>
                <td>{t.color ? <Chip>{t.color}</Chip> : "—"}</td>
                <td><Battery v={t.battery} /></td>
                <td><Rssi v={t.rssi} /></td>
                <td>{t.goodsId ? <span className="mono">{t.goodsId}</span> : <span className="faint">unbound</span>}</td>
                <td className="faint">{t.lastUpdate ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </TableState>
  );
}
