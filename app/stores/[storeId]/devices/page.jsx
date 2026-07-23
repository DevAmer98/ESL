"use client";
// Devices — the shelf labels themselves.
// Same table pattern as Store Data, plus the two things that only labels have:
// a battery/RSSI health read, and a live SVG preview of what the tag is
// currently painting. Pushes are asynchronous, so this screen polls.
import { use, useCallback, useEffect, useState } from "react";
import { api, download } from "@/lib/client/api";
import { useList } from "@/lib/client/useList";
import { DataTable } from "@/components/DataTable";
import { useSession } from "@/components/Session";
import {
  Btn, Card, Chip, Confirm, DebouncedSearch, Dot, Field, Modal, Select, Spinner,
  useToast, dateTime, timeAgo, money, LABEL_TONE,
} from "@/components/ui";

const STATUSES = ["ONLINE", "OFFLINE", "BROADCASTING", "ERROR", "UNKNOWN"];

// Encoded as "min-max" so the whole range lives in one <select> value.
const BATTERY_RANGES = [
  { value: "", label: "Any battery" },
  { value: "0-20", label: "Critical (≤20%)" },
  { value: "21-50", label: "Low (21–50%)" },
  { value: "51-80", label: "Fair (51–80%)" },
  { value: "81-100", label: "Good (>80%)" },
];

/** Every picker on this screen is a short, store-scoped list — one page is plenty. */
function useOptions(path) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let live = true;
    api.get(`${path}?pageSize=200`)
      .then((res) => live && setItems(res.items ?? []))
      .catch(() => {});
    return () => { live = false; };
  }, [path]);
  return items;
}

/* -------------------------------- cells ----------------------------------- */

function Battery({ percent, threshold }) {
  if (percent == null) return <span className="faint">—</span>;
  const low = percent <= threshold;
  const tone = low ? "var(--bad)" : percent <= 50 ? "var(--warn)" : "var(--ok)";
  return (
    <span className="inline" style={{ gap: 7 }}
      title={low ? `Below this store's ${threshold}% low-battery threshold` : undefined}>
      <span style={{ display: "inline-block", width: 34, height: 7, borderRadius: 4,
        background: "var(--panel2)", border: "1px solid var(--line)", overflow: "hidden" }}>
        <span style={{ display: "block", width: `${percent}%`, height: "100%", background: tone }} />
      </span>
      <span className="mono" style={{ color: low ? "var(--bad)" : undefined }}>{percent}%</span>
    </span>
  );
}

/** -50 dBm is a strong tag, -90 is a tag about to drop off the mesh. */
function Rssi({ dbm }) {
  if (dbm == null) return <span className="faint">—</span>;
  const tone = dbm >= -70 ? "var(--ok)" : dbm >= -85 ? "var(--warn)" : "var(--bad)";
  return <span className="mono" style={{ color: tone }}>{dbm}</span>;
}

function Status({ status }) {
  return (
    <span className="inline" style={{ gap: 6 }}>
      <Dot tone={LABEL_TONE[status] ?? "faint"} pulse={status === "BROADCASTING"} />
      <span>{status}</span>
    </span>
  );
}

const COLUMNS = (threshold) => [
  { key: "mac", header: "MAC", sortable: true, required: true,
    render: (r) => <span className="mono">{r.mac}</span> },
  { key: "sizeInches", header: "Size", sortable: true,
    render: (r) => (r.sizeInches == null ? "—" : `${r.sizeInches}"`) },
  { key: "model", header: "Model", sortable: true },
  { key: "battery", header: "Battery", sortable: true,
    render: (r) => <Battery percent={r.battery} threshold={threshold} /> },
  { key: "rssi", header: "RSSI", sortable: true, align: "right",
    render: (r) => <Rssi dbm={r.rssi} /> },
  { key: "status", header: "Status", sortable: true, required: true,
    render: (r) => <Status status={r.status} /> },
  { key: "product", header: "Bound product",
    render: (r) => (r.product
      ? <span>{r.product.name} <span className="faint mono">{r.product.code}</span></span>
      : <Chip tone="warn">unbound</Chip>) },
  { key: "group", header: "Group", render: (r) => r.group?.name ?? "—" },
  { key: "template", header: "Template", render: (r) => r.template?.name ?? "—" },
  { key: "gateway", header: "Gateway", render: (r) => r.gateway?.name ?? "—" },
  { key: "lastBroadcastAt", header: "Last broadcast", sortable: true,
    render: (r) => <span title={dateTime(r.lastBroadcastAt)}>{timeAgo(r.lastBroadcastAt)}</span> },
];

/* ------------------------------ detail modal ------------------------------ */

/**
 * The preview is rendered server-side from the template + the label's bound
 * product, so it is the ground truth for what the tag will paint. `nonce`
 * forces the browser to refetch after a bind — the endpoint is no-store, but a
 * stable URL still gets served from memory cache within a page view.
 */
function Preview({ storeId, templateId, labelId, nonce }) {
  if (!templateId) {
    return (
      <div className="empty" style={{ padding: 28 }}>
        No template assigned — nothing to render.
      </div>
    );
  }
  return (
    <img
      alt="Label preview"
      src={`/api/stores/${storeId}/templates/${templateId}/preview?labelId=${labelId}&_=${nonce}`}
      style={{ width: "100%", maxWidth: 420, background: "#fff", borderRadius: 8,
        border: "1px solid var(--line)" }} />
  );
}

function LabelModal({ storeId, row, threshold, onClose, onSaved, canBind }) {
  const toast = useToast();
  const [label, setLabel] = useState(row);
  const [form, setForm] = useState({
    productId: row.productId ?? "", templateId: row.templateId ?? "",
    groupId: row.groupId ?? "", push: true,
  });
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const products = useOptions(`/stores/${storeId}/products`);
  const templates = useOptions(`/stores/${storeId}/templates`);
  const groups = useOptions(`/stores/${storeId}/groups`);

  // The row from the table carries trimmed relations; the detail endpoint has
  // the full product, which is what the summary panel prints.
  useEffect(() => {
    let live = true;
    api.get(`/stores/${storeId}/labels/${row.id}`)
      .then((res) => live && setLabel(res))
      .catch(() => {});
    return () => { live = false; };
  }, [storeId, row.id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function bind() {
    setBusy(true);
    try {
      const res = await api.post(`/stores/${storeId}/labels/${row.id}/bind`, {
        productId: form.productId || null,
        templateId: form.templateId || null,
        groupId: form.groupId || null,
        push: form.push,
      });
      setLabel((l) => ({ ...l, ...res.label }));
      setNonce((n) => n + 1);
      toast.ok(res.queued ? "Bound — redraw queued" : "Bound");
      onSaved();
    } catch (err) {
      toast.bad(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    try {
      const res = await api.post(`/stores/${storeId}/labels/bulk`,
        { action: "refresh", ids: [row.id] });
      toast.ok(`Queued ${res.affected} redraw`);
      onSaved();
    } catch (err) {
      toast.bad(err.message);
    } finally {
      setBusy(false);
    }
  }

  const previewTemplateId = form.templateId || label.templateId;

  return (
    <Modal wide title={label.mac} onClose={onClose} footer={
      <>
        <Btn onClick={onClose} disabled={busy}>Close</Btn>
        {canBind && (
          <>
            <Btn onClick={refresh} disabled={busy}>↻ Refresh tag</Btn>
            <Btn kind="primary" onClick={bind} disabled={busy}>
              {busy ? <Spinner /> : null} Bind
            </Btn>
          </>
        )}
      </>
    }>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
        <div>
          <Card style={{ marginBottom: 14 }}>
            <div className="kv"><span className="k">Status</span><Status status={label.status} /></div>
            <div className="kv"><span className="k">Battery</span>
              <Battery percent={label.battery} threshold={threshold} /></div>
            <div className="kv"><span className="k">RSSI</span><Rssi dbm={label.rssi} /></div>
            <div className="kv"><span className="k">Model</span><b>{label.model ?? "—"}</b></div>
            <div className="kv"><span className="k">Size</span>
              <b>{label.sizeInches == null ? "—" : `${label.sizeInches}"`}</b></div>
            <div className="kv"><span className="k">Gateway</span>
              <b>{label.gateway?.name ?? "—"}</b></div>
            <div className="kv"><span className="k">Price on tag</span>
              <b>{money(label.product?.priceCents)}</b></div>
            <div className="kv"><span className="k">Last broadcast</span>
              <b>{dateTime(label.lastBroadcastAt)}</b></div>
            <div className="kv"><span className="k">Last update</span>
              <b>{dateTime(label.lastUpdateAt)}</b></div>
          </Card>

          <Select label="Product" value={form.productId} onChange={set("productId")}
            disabled={!canBind}
            options={[{ value: "", label: "— unbound —" },
              ...products.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]} />
          <Select label="Template" value={form.templateId} onChange={set("templateId")}
            disabled={!canBind}
            hint="Only a template matching the panel size will render faithfully."
            options={[{ value: "", label: "— none —" },
              ...templates.map((t) => ({ value: t.id, label: `${t.name} (${t.sizeInches}")` }))]} />
          <Select label="Group" value={form.groupId} onChange={set("groupId")}
            disabled={!canBind}
            options={[{ value: "", label: "— none —" },
              ...groups.map((g) => ({ value: g.id, label: g.name }))]} />
          {canBind && (
            <label className="inline" style={{ cursor: "pointer" }}>
              <input type="checkbox" className="checkbox" checked={form.push}
                onChange={(e) => setForm((f) => ({ ...f, push: e.target.checked }))} />
              <span>Queue a redraw after binding</span>
            </label>
          )}
        </div>

        <div>
          <div className="label" style={{ fontSize: 11, color: "var(--dim)", marginBottom: 6 }}>
            LIVE PREVIEW
          </div>
          <Preview storeId={storeId} templateId={previewTemplateId} labelId={label.id}
            nonce={nonce} />
          <div className="hint" style={{ marginTop: 8 }}>
            Rendered from the template and the bound product. A queued redraw only
            reaches the hardware when the push queue drains.
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------- add modal -------------------------------- */

function AddModal({ storeId, onClose, onSaved }) {
  const toast = useToast();
  const gateways = useOptions(`/stores/${storeId}/gateways`);
  const groups = useOptions(`/stores/${storeId}/groups`);
  const [form, setForm] = useState({
    mac: "", model: "", sizeInches: "", battery: "", status: "UNKNOWN",
    gatewayId: "", groupId: "",
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await api.post(`/stores/${storeId}/labels`, {
        mac: form.mac,
        model: form.model || undefined,
        sizeInches: form.sizeInches === "" ? null : form.sizeInches,
        battery: form.battery === "" ? undefined : form.battery,
        status: form.status,
        gatewayId: form.gatewayId || null,
        groupId: form.groupId || null,
      });
      toast.ok("Label added");
      onSaved();
      onClose();
    } catch (err) {
      if (err.details?.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      }
      toast.bad(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Add label" onClose={onClose} footer={
      <>
        <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn kind="primary" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : null} Save
        </Btn>
      </>
    }>
      <Field label="MAC *" value={form.mac} onChange={set("mac")} error={errors.mac}
        placeholder="AC233FAABB01"
        hint="Separators are stripped — 12 hex digits either way." />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Field label="Model" value={form.model} onChange={set("model")} error={errors.model} />
        <Field label="Size (inches)" value={form.sizeInches} onChange={set("sizeInches")}
          error={errors.sizeInches} placeholder="2.13" />
        <Field label="Battery %" value={form.battery} onChange={set("battery")}
          error={errors.battery} />
        <Select label="Status" value={form.status} onChange={set("status")}
          options={STATUSES} />
        <Select label="Gateway" value={form.gatewayId} onChange={set("gatewayId")}
          options={[{ value: "", label: "— none —" },
            ...gateways.map((g) => ({ value: g.id, label: g.name }))]} />
        <Select label="Group" value={form.groupId} onChange={set("groupId")}
          options={[{ value: "", label: "— none —" },
            ...groups.map((g) => ({ value: g.id, label: g.name }))]} />
      </div>
    </Modal>
  );
}

/* ----------------------------- import modal ------------------------------- */

function ImportModal({ storeId, onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function run() {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await api.upload(`/stores/${storeId}/labels/import`, form);
      setResult(res);
      onDone();
      if (!res.failed) toast.ok(`Imported ${res.imported + (res.updated ?? 0)} rows`);
      else toast.warn(`${res.failed} row(s) rejected`);
    } catch (err) {
      toast.bad(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Import labels" onClose={onClose} footer={
      <>
        <Btn onClick={onClose}>{result ? "Done" : "Cancel"}</Btn>
        <Btn kind="primary" onClick={run} disabled={!file || busy}>
          {busy ? <Spinner /> : null} Import
        </Btn>
      </>
    }>
      <Field label="CSV file">
        <input className="input" type="file" accept=".csv,text/csv"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
      </Field>
      <div className="hint" style={{ marginBottom: 12 }}>
        Requires a <span className="mono">mac</span> column. Optional:{" "}
        <span className="mono">model</span>, <span className="mono">sizeInches</span>,{" "}
        <span className="mono">battery</span>, <span className="mono">status</span>,{" "}
        <span className="mono">productCode</span>, <span className="mono">groupName</span>,{" "}
        <span className="mono">gatewayMac</span>. Rows are matched on the MAC.
      </div>

      {result && (
        <Card style={{ background: "var(--panel2)" }}>
          <div className="kv"><span className="k">Created</span><b>{result.imported ?? 0}</b></div>
          <div className="kv"><span className="k">Updated</span><b>{result.updated ?? 0}</b></div>
          <div className="kv"><span className="k">Rejected</span>
            <b style={{ color: result.failed ? "var(--bad)" : undefined }}>
              {result.failed ?? 0}
            </b>
          </div>
          {result.errors?.length > 0 && (
            <div style={{ marginTop: 10, maxHeight: 180, overflow: "auto",
              fontSize: 12, color: "var(--bad)" }}>
              {result.errors.map((e, i) => <div key={i}>Line {e.line}: {e.message}</div>)}
            </div>
          )}
        </Card>
      )}
    </Modal>
  );
}

/* --------------------------- bulk assign modal ---------------------------- */

function AssignModal({ storeId, kind, count, onClose, onPick, busy }) {
  const isGroup = kind === "assignGroup";
  const options = useOptions(`/stores/${storeId}/${isGroup ? "groups" : "templates"}`);
  const [value, setValue] = useState("");

  return (
    <Modal title={isGroup ? "Assign group" : "Assign template"} onClose={onClose} footer={
      <>
        <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn kind="primary" onClick={() => onPick(value || null)} disabled={busy}>
          {busy ? <Spinner /> : null} Apply to {count}
        </Btn>
      </>
    }>
      <Select label={isGroup ? "Group" : "Template"} value={value}
        onChange={(e) => setValue(e.target.value)}
        hint="Leave unset to clear the assignment on every selected label."
        options={[{ value: "", label: "— clear —" },
          ...options.map((o) => ({
            value: o.id,
            label: isGroup ? o.name : `${o.name} (${o.sizeInches}")`,
          }))]} />
    </Modal>
  );
}

/* -------------------------------- screen ---------------------------------- */

export default function DevicesPage({ params }) {
  const { storeId } = use(params);
  const toast = useToast();
  const { can } = useSession();
  const canEdit = can("ADMIN");
  const canOperate = can("OPERATOR");

  const list = useList(`/stores/${storeId}/labels`, { sort: "updatedAt" });
  const groups = useOptions(`/stores/${storeId}/groups`);

  const [threshold, setThreshold] = useState(20);
  const [detail, setDetail] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  // The low-battery line is a per-store parameter, not a constant — the table
  // must warn on the same number Statistical Analysis reports against.
  useEffect(() => {
    api.get(`/stores/${storeId}/settings`)
      .then((s) => setThreshold(s.parameters?.lowBatteryThreshold ?? 20))
      .catch(() => {});
  }, [storeId]);

  // Pushes and status changes land asynchronously from the queue and the
  // monitor, so a table left open goes stale within a minute.
  const { refresh } = list;
  useEffect(() => {
    const t = setInterval(refresh, 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  const runBulk = useCallback(async (payload, done) => {
    setBusy(true);
    try {
      const res = await api.post(`/stores/${storeId}/labels/bulk`, payload);
      toast.ok(`${payload.action}: ${res.affected} label${res.affected === 1 ? "" : "s"}`
        + (res.skipped ? ` (${res.skipped} skipped)` : ""));
      done?.();
      list.refresh();
    } catch (err) {
      toast.bad(err.message);
    } finally {
      setBusy(false);
    }
  }, [storeId, list, toast]);

  const range = `${list.params.batteryMin ?? ""}-${list.params.batteryMax ?? ""}`;

  const bulkActions = [];
  if (canOperate) {
    bulkActions.push({ label: "↻ Refresh",
      onRun: (ids, clear) => runBulk({ action: "refresh", ids }, clear) });
  }
  if (canEdit) {
    bulkActions.push(
      { label: "Assign group",
        onRun: (ids, clear) => setAssigning({ kind: "assignGroup", ids, clear }) },
      { label: "Assign template",
        onRun: (ids, clear) => setAssigning({ kind: "assignTemplate", ids, clear }) },
      { label: "Delete", kind: "danger",
        onRun: (ids, clear) => setConfirming({ ids, label: `${ids.length} labels`, clear }) },
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Devices</h1>
          <div className="sub">Shelf labels, their health and what they are showing</div>
        </div>
      </div>

      <DataTable
        list={list}
        storeId={storeId}
        tableKey="labels"
        selectable={canOperate}
        columns={COLUMNS(threshold)}
        onRowClick={(r) => setDetail(r)}
        emptyMessage="No labels yet. Add one, or import a CSV of MACs."
        bulkActions={bulkActions}
        toolbar={
          <>
            <DebouncedSearch value={list.params.q}
              onChange={(q) => list.setFilter({ q })}
              placeholder="Search MAC or model…" />
            <select className="select" style={{ width: "auto" }}
              value={list.params.status ?? ""}
              onChange={(e) => list.setFilter({ status: e.target.value })}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="select" style={{ width: "auto" }}
              value={list.params.groupId ?? ""}
              onChange={(e) => list.setFilter({ groupId: e.target.value })}>
              <option value="">All groups</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select className="select" style={{ width: "auto" }}
              value={range === "-" ? "" : range}
              onChange={(e) => {
                const [min, max] = e.target.value.split("-");
                list.setFilter({ batteryMin: min ?? "", batteryMax: max ?? "" });
              }}>
              {BATTERY_RANGES.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
            <select className="select" style={{ width: "auto" }}
              value={list.params.unbound ?? ""}
              onChange={(e) => list.setFilter({ unbound: e.target.value })}>
              <option value="">Bound and unbound</option>
              <option value="true">Unbound only</option>
            </select>
            <Btn onClick={list.refresh} disabled={list.loading}>
              {list.loading ? <Spinner /> : "↻"} Reload
            </Btn>
            {canEdit && <Btn kind="primary" onClick={() => setAdding(true)}>+ Add</Btn>}
            {canOperate && <Btn onClick={() => setImporting(true)}>↥ Import</Btn>}
            <Btn onClick={() =>
              download(`/stores/${storeId}/labels/export${list.exportQuery}`)}>
              ↧ Export
            </Btn>
          </>
        }
      />

      {detail && (
        <LabelModal storeId={storeId} row={detail} threshold={threshold} canBind={canOperate}
          onClose={() => setDetail(null)} onSaved={list.refresh} />
      )}
      {adding && (
        <AddModal storeId={storeId} onClose={() => setAdding(false)} onSaved={list.refresh} />
      )}
      {importing && (
        <ImportModal storeId={storeId} onClose={() => setImporting(false)}
          onDone={list.refresh} />
      )}
      {assigning && (
        <AssignModal storeId={storeId} kind={assigning.kind} count={assigning.ids.length}
          busy={busy} onClose={() => setAssigning(null)}
          onPick={(value) => {
            const key = assigning.kind === "assignGroup" ? "groupId" : "templateId";
            runBulk({ action: assigning.kind, ids: assigning.ids, [key]: value },
              assigning.clear);
            setAssigning(null);
          }} />
      )}
      {confirming && (
        <Confirm
          title="Delete labels"
          message={`Delete ${confirming.label}? The hardware keeps whatever it last painted until it is re-provisioned. This is recorded in the deletion log.`}
          busy={busy}
          onConfirm={() => {
            runBulk({ action: "delete", ids: confirming.ids }, confirming.clear);
            setConfirming(null);
          }}
          onClose={() => setConfirming(null)} />
      )}
    </div>
  );
}
