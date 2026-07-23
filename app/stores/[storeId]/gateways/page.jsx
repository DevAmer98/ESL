"use client";
// Gateways — the BLE bridges that actually reach the shelf tags.
// Same table pattern as Store Data. The only unusual control is Reboot, which
// is queued rather than performed: see RebootModal.
import { use, useState } from "react";
import { api } from "@/lib/client/api";
import { useList } from "@/lib/client/useList";
import { DataTable } from "@/components/DataTable";
import { useSession } from "@/components/Session";
import {
  Btn, Card, Confirm, DebouncedSearch, Dot, Field, Modal, Select, Spinner,
  useToast, dateTime, timeAgo,
} from "@/components/ui";

const STATUSES = ["ONLINE", "OFFLINE", "UNKNOWN"];
const STATUS_TONE = { ONLINE: "ok", OFFLINE: "bad", UNKNOWN: "warn" };

const COLUMNS = (edit, remove, reboot, canEdit, canOperate) => [
  { key: "name", header: "Name", sortable: true, required: true },
  { key: "mac", header: "MAC", sortable: true, required: true,
    render: (r) => <span className="mono">{r.mac}</span> },
  { key: "status", header: "Status", sortable: true, required: true,
    render: (r) => (
      <span className="inline" style={{ gap: 6 }}>
        <Dot tone={STATUS_TONE[r.status] ?? "faint"} />
        <span>{r.status}</span>
      </span>
    ) },
  { key: "lastSeenAt", header: "Last seen", sortable: true,
    render: (r) => <span title={dateTime(r.lastSeenAt)}>{timeAgo(r.lastSeenAt)}</span> },
  { key: "model", header: "Model", sortable: true },
  { key: "wifiFirmware", header: "WiFi firmware",
    render: (r) => <span className="mono">{r.wifiFirmware ?? "—"}</span> },
  { key: "bleFirmware", header: "BLE firmware",
    render: (r) => <span className="mono">{r.bleFirmware ?? "—"}</span> },
  { key: "bleModules", header: "BLE modules", align: "right" },
  { key: "ip", header: "IP / host", sortable: true,
    render: (r) => <span className="mono">{r.ip || "—"}</span> },
  { key: "labels", header: "Labels", align: "right",
    render: (r) => <span className="mono">{r._count?.labels ?? 0}</span> },
  { key: "actions", header: "", required: true,
    render: (r) => (
      <span className="inline" onClick={(e) => e.stopPropagation()}>
        <Btn sm onClick={() => edit(r)}>{canEdit ? "Edit" : "View"}</Btn>
        {canOperate && <Btn sm onClick={() => reboot(r)}>Reboot</Btn>}
        {canEdit && <Btn sm kind="danger" onClick={() => remove(r)}>Delete</Btn>}
      </span>
    ) },
];

/* ------------------------------- edit modal ------------------------------- */

function GatewayModal({ storeId, gateway, readOnly, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    name: gateway?.name ?? "", mac: gateway?.mac ?? "", ip: gateway?.ip ?? "",
    model: gateway?.model ?? "", wifiFirmware: gateway?.wifiFirmware ?? "",
    bleFirmware: gateway?.bleFirmware ?? "", bleModules: String(gateway?.bleModules ?? 1),
    status: gateway?.status ?? "UNKNOWN",
  }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setErrors({});
    const payload = {
      name: form.name,
      mac: form.mac,
      // Nullable columns: a cleared box must clear the record, not store "".
      ip: form.ip === "" ? null : form.ip,
      model: form.model || undefined,
      wifiFirmware: form.wifiFirmware === "" ? null : form.wifiFirmware,
      bleFirmware: form.bleFirmware === "" ? null : form.bleFirmware,
      bleModules: form.bleModules === "" ? undefined : form.bleModules,
      status: form.status,
    };
    try {
      if (gateway) await api.patch(`/stores/${storeId}/gateways/${gateway.id}`, payload);
      else await api.post(`/stores/${storeId}/gateways`, payload);
      toast.ok(gateway ? "Gateway updated" : "Gateway created");
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
    <Modal wide title={gateway ? `Edit ${gateway.name}` : "New gateway"} onClose={onClose}
      footer={!readOnly && (
        <>
          <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn kind="primary" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : null} Save
          </Btn>
        </>
      )}>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
        <Field label="Name *" value={form.name} onChange={set("name")}
          disabled={readOnly} error={errors.name} />
        <Field label="MAC *" value={form.mac} onChange={set("mac")}
          disabled={readOnly} error={errors.mac} placeholder="AC233FAABB01"
          hint="Separators are stripped — 12 hex digits either way." />
        <Field label="IP or hostname" value={form.ip} onChange={set("ip")}
          disabled={readOnly} error={errors.ip} />
        <Field label="Model" value={form.model} onChange={set("model")}
          disabled={readOnly} error={errors.model} />
        <Field label="WiFi firmware" value={form.wifiFirmware} onChange={set("wifiFirmware")}
          disabled={readOnly} error={errors.wifiFirmware} />
        <Field label="BLE firmware" value={form.bleFirmware} onChange={set("bleFirmware")}
          disabled={readOnly} error={errors.bleFirmware} />
        <Field label="BLE modules" value={form.bleModules} onChange={set("bleModules")}
          disabled={readOnly} error={errors.bleModules} />
        <Select label="Status" value={form.status} onChange={set("status")}
          disabled={readOnly} error={errors.status} options={STATUSES} />
      </div>
    </Modal>
  );
}

/* ------------------------------ reboot modal ------------------------------ */

/**
 * The endpoint answers 202 and writes a PENDING operation — no vendor SDK call
 * exists yet. The wording here is deliberate: claiming the gateway rebooted
 * would send an installer hunting for a fault that never happened.
 */
function RebootModal({ storeId, gateway, onClose, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(null);

  async function run() {
    setBusy(true);
    try {
      const res = await api.post(`/stores/${storeId}/gateways/${gateway.id}/reboot`);
      setQueued(res);
      toast.warn("Reboot queued — not yet executed");
      onDone();
    } catch (err) {
      toast.bad(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Reboot ${gateway.name}`} onClose={onClose} footer={
      <>
        <Btn onClick={onClose} disabled={busy}>{queued ? "Close" : "Cancel"}</Btn>
        {!queued && (
          <Btn kind="primary" onClick={run} disabled={busy}>
            {busy ? <Spinner /> : null} Queue reboot
          </Btn>
        )}
      </>
    }>
      {queued ? (
        <Card style={{ background: "var(--panel2)" }}>
          <div className="kv"><span className="k">Status</span><b>PENDING</b></div>
          <div className="kv"><span className="k">Operation</span>
            <b className="mono">{queued.operationId?.slice(-8) ?? "—"}</b></div>
          <div className="hint" style={{ marginTop: 10 }}>{queued.detail}</div>
        </Card>
      ) : (
        <div className="muted">
          This records a <b>PENDING</b> reboot request against{" "}
          <span className="mono">{gateway.mac}</span>. It does <b>not</b> reboot the
          hardware: no vendor reboot call is wired up yet, so the request waits in the
          operation record until a Minew SDK adapter can execute it. You will find it
          under Statistical Analysis → Operation Record.
        </div>
      )}
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
      const res = await api.upload(`/stores/${storeId}/gateways/import`, form);
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
    <Modal title="Import gateways" onClose={onClose} footer={
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
        Requires <span className="mono">name</span> and <span className="mono">mac</span>.
        Optional: <span className="mono">ip</span>, <span className="mono">model</span>,{" "}
        <span className="mono">bleModules</span>. Rows are matched on the MAC.
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

/* -------------------------------- screen ---------------------------------- */

export default function GatewaysPage({ params }) {
  const { storeId } = use(params);
  const toast = useToast();
  const { can } = useSession();
  const canEdit = can("ADMIN");
  const canOperate = can("OPERATOR");

  const list = useList(`/stores/${storeId}/gateways`, { sort: "updatedAt" });
  const [editing, setEditing] = useState(null);
  const [rebooting, setRebooting] = useState(null);
  const [importing, setImporting] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  async function destroy(gateway) {
    setBusy(true);
    try {
      await api.del(`/stores/${storeId}/gateways/${gateway.id}`);
      toast.ok("Gateway deleted");
      list.refresh();
      setConfirming(null);
    } catch (err) {
      toast.bad(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Gateways</h1>
          <div className="sub">The bridges between the console and the shelf</div>
        </div>
      </div>

      <DataTable
        list={list}
        storeId={storeId}
        tableKey="gateways"
        columns={COLUMNS(
          (g) => setEditing({ gateway: g }),
          (g) => setConfirming(g),
          (g) => setRebooting(g),
          canEdit,
          canOperate,
        )}
        emptyMessage="No gateways yet. Add one, or import a CSV."
        toolbar={
          <>
            <DebouncedSearch value={list.params.q}
              onChange={(q) => list.setFilter({ q })}
              placeholder="Search name, MAC, IP…" />
            <select className="select" style={{ width: "auto" }}
              value={list.params.status ?? ""}
              onChange={(e) => list.setFilter({ status: e.target.value })}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <Btn onClick={list.refresh} disabled={list.loading}>
              {list.loading ? <Spinner /> : "↻"} Reload
            </Btn>
            {canEdit && (
              <Btn kind="primary" onClick={() => setEditing({ gateway: null })}>+ Add</Btn>
            )}
            {canOperate && <Btn onClick={() => setImporting(true)}>↥ Import</Btn>}
          </>
        }
      />

      {editing && (
        <GatewayModal storeId={storeId} gateway={editing.gateway} readOnly={!canEdit}
          onClose={() => setEditing(null)} onSaved={list.refresh} />
      )}
      {rebooting && (
        <RebootModal storeId={storeId} gateway={rebooting}
          onClose={() => setRebooting(null)} onDone={list.refresh} />
      )}
      {importing && (
        <ImportModal storeId={storeId} onClose={() => setImporting(false)}
          onDone={list.refresh} />
      )}
      {confirming && (
        <Confirm
          title="Delete gateway"
          message={`Delete ${confirming.name}? Its ${confirming._count?.labels ?? 0} label(s) stay, but become unassigned until another gateway picks them up.`}
          busy={busy}
          onConfirm={() => destroy(confirming)}
          onClose={() => setConfirming(null)} />
      )}
    </div>
  );
}
