"use client";
// A Minew store's live hardware — gateways and tags — read straight from the
// backend via /api/minew/stores/:sid/{gateways,tags}. No local mirror.
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Btn, Card, Dot, Spinner, Tabs, dateTime, timeAgo } from "@/components/ui";

export default function MinewStoreDetail({ params }) {
  const { sid } = use(params);
  const router = useRouter();
  const [tab, setTab] = useState("gateways");
  const [gw, setGw] = useState({ loading: true, data: null, error: null });
  const [tags, setTags] = useState({ loading: true, data: null, error: null });

  async function loadGw() {
    setGw((s) => ({ ...s, loading: true }));
    try {
      setGw({ loading: false, data: await api.get(`/minew/stores/${sid}/gateways`), error: null });
    } catch (e) {
      setGw({ loading: false, data: null, error: e.message });
    }
  }
  async function loadTags() {
    setTags((s) => ({ ...s, loading: true }));
    try {
      setTags({ loading: false, data: await api.get(`/minew/stores/${sid}/tags`), error: null });
    } catch (e) {
      setTags({ loading: false, data: null, error: e.message });
    }
  }
  useEffect(() => { loadGw(); loadTags(); }, [sid]);

  return (
    <div className="page" style={{ maxWidth: 1100, margin: "0 auto", paddingTop: 40 }}>
      <div className="page-head">
        <div>
          <Btn sm onClick={() => router.push("/minew")}>← Stores</Btn>
          <h1 style={{ marginTop: 8 }}>Store hardware</h1>
          <div className="sub mono">{sid}</div>
        </div>
        <Btn onClick={() => { loadGw(); loadTags(); }}>↻ Reload</Btn>
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

function StatusCell({ online }) {
  return (
    <span className="inline" style={{ gap: 6 }}>
      <Dot tone={online ? "ok" : "bad"} />
      <span>{online ? "online" : "offline"}</span>
    </span>
  );
}

function GatewaysTable({ state }) {
  if (state.loading) return <div className="center-screen"><Spinner /></div>;
  if (state.error) return <Card><div className="empty" style={{ color: "var(--bad)" }}>{state.error}</div></Card>;
  const rows = state.data?.gateways ?? [];
  if (!rows.length) return <Card><div className="empty">No gateways.</div></Card>;
  return (
    <Card flush>
      <table className="table">
        <thead>
          <tr>
            <th>Status</th><th>Name</th><th>MAC</th><th>Model</th>
            <th>IP</th><th>WiFi FW</th><th>BLE FW</th><th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.mac}>
              <td><StatusCell online={g.online} /></td>
              <td>{g.name}</td>
              <td className="mono">{g.mac}</td>
              <td>{g.model ?? "—"}</td>
              <td className="mono">{g.ip ?? "—"}</td>
              <td className="mono">{g.wifiFirmware ?? "—"}</td>
              <td className="mono">{g.bleFirmware ?? "—"}</td>
              <td title={dateTime(g.lastSeenAt)}>{g.lastSeenAt ? timeAgo(g.lastSeenAt) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function TagsTable({ state }) {
  if (state.loading) return <div className="center-screen"><Spinner /></div>;
  if (state.error) return <Card><div className="empty" style={{ color: "var(--bad)" }}>{state.error}</div></Card>;
  const rows = state.data?.tags ?? [];
  if (!rows.length) return <Card><div className="empty">No tags.</div></Card>;
  return (
    <Card flush>
      <table className="table">
        <thead>
          <tr>
            <th>Status</th><th>MAC</th><th>Size</th><th>Color</th>
            <th>Battery</th><th>RSSI</th><th>Bound to</th><th>Last update</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.mac}>
              <td><StatusCell online={t.online} /></td>
              <td className="mono">{t.mac}</td>
              <td>{t.sizeInches ? `${t.sizeInches}"` : "—"}</td>
              <td>{t.color ?? "—"}</td>
              <td>{t.battery != null ? `${t.battery}%` : "—"}</td>
              <td className="mono">{t.rssi ?? "—"}</td>
              <td className="mono">{t.goodsId ?? "—"}</td>
              <td>{t.lastUpdate ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
