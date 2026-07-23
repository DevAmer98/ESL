"use client";
// Store Settings — five tabs: label groups, tunable parameters + hardware
// integration, scheduled updates, template strategies, and the media library.
import { use, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { useList } from "@/lib/client/useList";
import { DataTable } from "@/components/DataTable";
import { useSession } from "@/components/Session";
import {
  Btn, Card, Chip, Confirm, DebouncedSearch, Field, Modal, Select, Spinner, Tabs,
  useToast, dateTime,
} from "@/components/ui";

const TABS = [
  { id: "groups", label: "Label Groups" },
  { id: "parameters", label: "Parameters & Integration" },
  { id: "schedules", label: "Scheduled Updates" },
  { id: "strategies", label: "Template Strategy" },
  { id: "media", label: "Media Library" },
];

/** Small helper: fetch a whole list once, for populating <select>s. */
function useOptions(path, map) {
  const [options, setOptions] = useState([]);
  useEffect(() => {
    let live = true;
    api.get(`${path}?pageSize=200`)
      .then((r) => live && setOptions((r.items ?? []).map(map)))
      .catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return options;
}

/* ------------------------------- groups ----------------------------------- */

function GroupModal({ storeId, group, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: group?.name ?? "", description: group?.description ?? "",
    sortOrder: group?.sortOrder ?? 0,
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const payload = { ...form, sortOrder: Number(form.sortOrder) || 0 };
      if (group) await api.patch(`/stores/${storeId}/groups/${group.id}`, payload);
      else await api.post(`/stores/${storeId}/groups`, payload);
      toast.ok("Group saved");
      onSaved();
      onClose();
    } catch (err) {
      toast.bad(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={group ? `Edit ${group.name}` : "New label group"} onClose={onClose} footer={
      <>
        <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn kind="primary" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : null} Save
        </Btn>
      </>
    }>
      <Field label="Name *" value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      <Field label="Description" value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      <Field label="Sort order" type="number" value={form.sortOrder}
        onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
    </Modal>
  );
}

function Groups({ storeId }) {
  const toast = useToast();
  const { can } = useSession();
  const admin = can("ADMIN");
  const list = useList(`/stores/${storeId}/groups`, { sort: "sortOrder", order: "asc" });
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  async function destroy(group) {
    setBusy(true);
    try {
      const res = await api.del(`/stores/${storeId}/groups/${group.id}`);
      toast.ok(res?.labelsUngrouped
        ? `Group deleted · ${res.labelsUngrouped} label(s) ungrouped`
        : "Group deleted");
      list.refresh();
      setConfirming(null);
    } catch (err) {
      toast.bad(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DataTable
        list={list} storeId={storeId} tableKey="groups"
        emptyMessage="No label groups yet."
        columns={[
          { key: "sortOrder", header: "Order", sortable: true, align: "right", required: true },
          { key: "name", header: "Name", sortable: true, required: true },
          { key: "description", header: "Description" },
          { key: "labelCount", header: "Labels", align: "right",
            render: (r) => <Chip>{r.labelCount ?? 0}</Chip> },
          { key: "actions", header: "", required: true,
            render: (r) => admin && (
              <span className="inline">
                <Btn sm onClick={() => setEditing(r)}>Edit</Btn>
                <Btn sm kind="danger" onClick={() => setConfirming(r)}>Delete</Btn>
              </span>
            ) },
        ]}
        toolbar={
          <>
            <DebouncedSearch value={list.params.q} onChange={(q) => list.setFilter({ q })} />
            {admin && <Btn kind="primary" onClick={() => setEditing({})}>+ Add group</Btn>}
          </>
        }
      />
      {editing && (
        <GroupModal storeId={storeId} group={editing.id ? editing : null}
          onClose={() => setEditing(null)} onSaved={list.refresh} />
      )}
      {confirming && (
        <Confirm title="Delete group" busy={busy}
          message={`Delete "${confirming.name}"? Its ${confirming.labelCount ?? 0} label(s) will be ungrouped, not deleted.`}
          onConfirm={() => destroy(confirming)} onClose={() => setConfirming(null)} />
      )}
    </>
  );
}

/* ----------------------- parameters & integration -------------------------- */

const PARAMS = [
  ["lowBatteryThreshold", "Low battery threshold (%)",
    "Labels at or below this are counted as low on the dashboard."],
  ["offlineAfterMinutes", "Mark offline after (minutes)",
    "How long without a broadcast before a device is considered offline."],
  ["pushMaxAttempts", "Max push attempts",
    "Retries before a push is abandoned. Backoff is exponential."],
  ["pushConcurrency", "Push concurrency", "Parallel pushes per worker tick."],
  ["timeoutMs", "Vendor API timeout (ms)", "How long to wait on the Minew API."],
];

function Parameters({ storeId }) {
  const toast = useToast();
  const { can } = useSession();
  const admin = can("ADMIN");

  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(null);

  const templates = useOptions(`/stores/${storeId}/templates`,
    (t) => ({ value: t.id, label: t.name }));

  const load = useCallback(() => {
    api.get(`/stores/${storeId}/settings`).then((s) => {
      setData(s);
      setForm({
        mode: s.mode, cloudUrl: s.cloudUrl ?? "", gatewayIp: s.gatewayIp ?? "",
        ...s.parameters,
      });
    }).catch((e) => toast.bad(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  useEffect(load, [load]);

  if (!form) return <Card><div className="empty"><Spinner /> Loading…</div></Card>;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    try {
      const payload = {
        mode: form.mode,
        cloudUrl: form.cloudUrl,
        gatewayIp: form.gatewayIp,
        parameters: Object.fromEntries(
          PARAMS.map(([k]) => [k, Number(form[k])]).filter(([, v]) => Number.isFinite(v)),
        ),
      };
      if (form.defaultTemplateId) payload.parameters.defaultTemplateId = form.defaultTemplateId;
      // Empty means "keep the stored token" — the API treats it that way too.
      if (token) payload.token = token;

      const res = await api.put(`/stores/${storeId}/settings`, payload);
      setData(res);
      setToken("");
      toast.ok("Settings saved");
    } catch (err) {
      toast.bad(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting({ pending: true });
    try {
      const res = await api.post(`/stores/${storeId}/settings/test-connection`, {});
      setTesting(res);
      res.ok ? toast.ok(res.detail) : toast.bad(res.detail);
    } catch (err) {
      setTesting({ ok: false, detail: err.message });
      toast.bad(err.message);
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
      <Card>
        <b style={{ fontSize: 14 }}>Hardware integration</b>
        <div className="hint" style={{ marginBottom: 14, marginTop: 4 }}>
          In demo mode pushes run through the full queue without reaching hardware.
        </div>

        <Select label="Mode" value={form.mode} disabled={!admin} onChange={set("mode")}
          options={[
            { value: "DEMO", label: "Demo — no hardware" },
            { value: "CLOUD", label: "Minew ESL Cloud" },
            { value: "GATEWAY", label: "Direct gateway (needs SDK)" },
          ]} />

        {form.mode === "CLOUD" && (
          <>
            <Field label="Cloud URL" value={form.cloudUrl} disabled={!admin}
              placeholder="https://esl.example.com:9443" onChange={set("cloudUrl")} />
            <Field label="API token" type="password" value={token} disabled={!admin}
              placeholder={data?.tokenSet ? "•••••••• (stored — leave blank to keep)" : "Paste token"}
              hint="Encrypted at rest and never sent back to the browser."
              onChange={(e) => setToken(e.target.value)} />
          </>
        )}

        {form.mode === "GATEWAY" && (
          <Field label="Gateway IP" value={form.gatewayIp} disabled={!admin}
            onChange={set("gatewayIp")}
            hint="Direct downlink needs Minew's SDK — pushes will fail until it is wired." />
        )}

        <div className="inline" style={{ marginTop: 6 }}>
          <Chip tone={data?.tokenSet ? "ok" : "warn"}>
            {data?.tokenSet ? "token stored" : "no token"}
          </Chip>
          {admin && form.mode === "CLOUD" && (
            <Btn sm onClick={test} disabled={testing?.pending}>
              {testing?.pending ? <Spinner /> : null} Test connection
            </Btn>
          )}
        </div>

        {testing && !testing.pending && (
          <div style={{ marginTop: 10, fontSize: 12.5,
            color: testing.ok ? "var(--ok)" : "var(--bad)" }}>
            {testing.detail}
          </div>
        )}
      </Card>

      <Card>
        <b style={{ fontSize: 14 }}>Parameters</b>
        <div style={{ marginTop: 12 }}>
          {PARAMS.map(([key, label, hint]) => (
            <Field key={key} label={label} type="number" value={form[key] ?? ""}
              disabled={!admin} hint={hint} onChange={set(key)} />
          ))}
          <Select label="Default template" value={form.defaultTemplateId ?? ""}
            disabled={!admin} onChange={set("defaultTemplateId")}
            options={[{ value: "", label: "— none —" }, ...templates]} />
        </div>
      </Card>

      {admin && (
        <div style={{ gridColumn: "1/-1" }}>
          <Btn kind="primary" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : null} Save settings
          </Btn>
        </div>
      )}
    </div>
  );
}

/* --------------------------- scheduled updates ----------------------------- */

const CRON_PRESETS = [
  { value: "0 * * * *", label: "Hourly" },
  { value: "0 3 * * *", label: "Daily at 03:00" },
  { value: "0 6 * * 1", label: "Weekly, Monday 06:00" },
  { value: "*/15 * * * *", label: "Every 15 minutes" },
];

function ScheduleModal({ storeId, schedule, onClose, onSaved }) {
  const toast = useToast();
  const groups = useOptions(`/stores/${storeId}/groups`, (g) => ({ value: g.id, label: g.name }));
  const templates = useOptions(`/stores/${storeId}/templates`,
    (t) => ({ value: t.id, label: t.name }));

  const [form, setForm] = useState({
    name: schedule?.name ?? "",
    cron: schedule?.cron ?? "0 3 * * *",
    timezone: schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    enabled: schedule?.enabled ?? true,
    templateId: schedule?.templateId ?? "",
    scope: schedule?.target?.allLabels ? "all" : "groups",
    groupIds: schedule?.target?.groupIds ?? [],
  });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});

  async function save() {
    setBusy(true);
    setErrors({});
    const payload = {
      name: form.name,
      cron: form.cron,
      timezone: form.timezone,
      enabled: form.enabled,
      templateId: form.templateId || null,
      target: form.scope === "all"
        ? { allLabels: true }
        : { allLabels: false, groupIds: form.groupIds },
    };
    try {
      if (schedule) await api.patch(`/stores/${storeId}/schedules/${schedule.id}`, payload);
      else await api.post(`/stores/${storeId}/schedules`, payload);
      toast.ok("Schedule saved");
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
    <Modal title={schedule ? `Edit ${schedule.name}` : "New scheduled update"} onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn kind="primary" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : null} Save
          </Btn>
        </>
      }>
      <Field label="Name *" value={form.name} error={errors.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />

      <Select label="Frequency" value={form.cron}
        onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
        options={[...CRON_PRESETS,
          ...(CRON_PRESETS.some((p) => p.value === form.cron)
            ? [] : [{ value: form.cron, label: `Custom: ${form.cron}` }])]} />

      <Field label="Cron expression *" value={form.cron} error={errors.cron}
        hint="Standard 5-field cron. Validated on save."
        onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))} />

      <Field label="Timezone" value={form.timezone} error={errors.timezone}
        onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} />

      <Select label="Applies to" value={form.scope}
        onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
        options={[
          { value: "all", label: "All labels in this store" },
          { value: "groups", label: "Selected groups" },
        ]} />

      {form.scope === "groups" && (
        <div className="field">
          <div className="label">Groups</div>
          {groups.length === 0 && <div className="faint">No groups defined.</div>}
          {groups.map((g) => (
            <label key={g.value} className="inline" style={{ cursor: "pointer", padding: "3px 0" }}>
              <input type="checkbox" className="checkbox"
                checked={form.groupIds.includes(g.value)}
                onChange={() => setForm((f) => ({
                  ...f,
                  groupIds: f.groupIds.includes(g.value)
                    ? f.groupIds.filter((x) => x !== g.value)
                    : [...f.groupIds, g.value],
                }))} />
              {g.label}
            </label>
          ))}
        </div>
      )}

      <Select label="Switch template (optional)" value={form.templateId}
        onChange={(e) => setForm((f) => ({ ...f, templateId: e.target.value }))}
        options={[{ value: "", label: "— keep each label's template —" }, ...templates]} />

      <label className="inline" style={{ cursor: "pointer", marginTop: 8 }}>
        <input type="checkbox" className="checkbox" checked={form.enabled}
          onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
        Enabled
      </label>
    </Modal>
  );
}

function Schedules({ storeId }) {
  const toast = useToast();
  const { can } = useSession();
  const admin = can("ADMIN");
  const list = useList(`/stores/${storeId}/schedules`, { sort: "nextRunAt", order: "asc" });
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  async function runNow(s) {
    try {
      const res = await api.post(`/stores/${storeId}/schedules/${s.id}/run`, {});
      toast.ok(res?.queued != null ? `Queued ${res.queued} label(s)` : "Schedule fired");
      list.refresh();
    } catch (err) {
      toast.bad(err.message);
    }
  }

  async function destroy(s) {
    setBusy(true);
    try {
      await api.del(`/stores/${storeId}/schedules/${s.id}`);
      toast.ok("Schedule deleted");
      list.refresh();
      setConfirming(null);
    } catch (err) {
      toast.bad(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DataTable
        list={list} storeId={storeId} tableKey="schedules"
        emptyMessage="No scheduled updates. Labels only refresh when pushed manually."
        columns={[
          { key: "name", header: "Name", sortable: true, required: true },
          { key: "cron", header: "Cron", render: (r) => <span className="mono">{r.cron}</span> },
          { key: "timezone", header: "Timezone", render: (r) => <span className="faint">{r.timezone}</span> },
          { key: "enabled", header: "Status", required: true,
            render: (r) => <Chip tone={r.enabled ? "ok" : ""}>
              {r.enabled ? "enabled" : "paused"}</Chip> },
          { key: "nextRunAt", header: "Next run", sortable: true,
            render: (r) => r.enabled ? dateTime(r.nextRunAt) : "—" },
          { key: "lastRunAt", header: "Last run", sortable: true,
            render: (r) => dateTime(r.lastRunAt) },
          { key: "lastResult", header: "Result",
            render: (r) => <span className="faint">{r.lastResult ?? "—"}</span> },
          { key: "actions", header: "", required: true,
            render: (r) => (
              <span className="inline">
                {can("OPERATOR") && <Btn sm onClick={() => runNow(r)}>Run now</Btn>}
                {admin && <Btn sm onClick={() => setEditing(r)}>Edit</Btn>}
                {admin && <Btn sm kind="danger" onClick={() => setConfirming(r)}>Delete</Btn>}
              </span>
            ) },
        ]}
        toolbar={admin && <Btn kind="primary" onClick={() => setEditing({})}>+ Add schedule</Btn>}
      />
      {editing && (
        <ScheduleModal storeId={storeId} schedule={editing.id ? editing : null}
          onClose={() => setEditing(null)} onSaved={list.refresh} />
      )}
      {confirming && (
        <Confirm title="Delete schedule" busy={busy}
          message={`Delete "${confirming.name}"? Labels will no longer refresh automatically.`}
          onConfirm={() => destroy(confirming)} onClose={() => setConfirming(null)} />
      )}
    </>
  );
}

/* --------------------------- template strategy ----------------------------- */

const OPS = ["eq", "neq", "contains", "startsWith", "gt", "gte", "lt", "lte", "in", "between"];
const FIELDS = ["code", "name", "specification", "unit", "brand", "origin", "sku", "priceCents"];

function StrategyModal({ storeId, strategy, onClose, onSaved }) {
  const toast = useToast();
  const templates = useOptions(`/stores/${storeId}/templates`,
    (t) => ({ value: t.id, label: t.name }));

  const [form, setForm] = useState({
    name: strategy?.name ?? "",
    priority: strategy?.priority ?? 0,
    enabled: strategy?.enabled ?? true,
    templateId: strategy?.templateId ?? "",
    field: strategy?.condition?.field ?? "brand",
    op: strategy?.condition?.op ?? "eq",
    value: strategy?.condition?.value ?? "",
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const payload = {
      name: form.name,
      priority: Number(form.priority) || 0,
      enabled: form.enabled,
      templateId: form.templateId,
      condition: {
        field: form.field,
        op: form.op,
        // `in` and `between` take lists; everything else a scalar.
        value: ["in", "between"].includes(form.op)
          ? String(form.value).split(",").map((s) => s.trim()).filter(Boolean)
          : form.value,
      },
    };
    try {
      if (strategy) await api.patch(`/stores/${storeId}/strategies/${strategy.id}`, payload);
      else await api.post(`/stores/${storeId}/strategies`, payload);
      toast.ok("Strategy saved");
      onSaved();
      onClose();
    } catch (err) {
      toast.bad(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={strategy ? `Edit ${strategy.name}` : "New template strategy"} onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn kind="primary" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : null} Save
          </Btn>
        </>
      }>
      <Field label="Name *" value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />

      <div className="hint" style={{ marginBottom: 10 }}>
        When a label's bound product matches this condition, it is assigned the template below.
        The highest-priority matching strategy wins.
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <Select label="Field" value={form.field}
          onChange={(e) => setForm((f) => ({ ...f, field: e.target.value }))}
          options={FIELDS} />
        <Select label="Operator" value={form.op}
          onChange={(e) => setForm((f) => ({ ...f, op: e.target.value }))}
          options={OPS} />
        <Field label={["in", "between"].includes(form.op) ? "Values (comma separated)" : "Value"}
          value={form.value}
          onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} />
      </div>

      <Select label="Assign template *" value={form.templateId}
        onChange={(e) => setForm((f) => ({ ...f, templateId: e.target.value }))}
        options={[{ value: "", label: "— choose —" }, ...templates]} />

      <Field label="Priority" type="number" value={form.priority}
        hint="Higher wins when several strategies match."
        onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} />

      <label className="inline" style={{ cursor: "pointer" }}>
        <input type="checkbox" className="checkbox" checked={form.enabled}
          onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
        Enabled
      </label>
    </Modal>
  );
}

function Strategies({ storeId }) {
  const toast = useToast();
  const { can } = useSession();
  const admin = can("ADMIN");
  const list = useList(`/stores/${storeId}/strategies`, { sort: "priority", order: "desc" });
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  async function applyAll() {
    try {
      const res = await api.post(`/stores/${storeId}/strategies/apply`, {});
      toast.ok(`Applied — ${res?.assigned ?? 0} label(s) reassigned`);
      list.refresh();
    } catch (err) {
      toast.bad(err.message);
    }
  }

  async function destroy(s) {
    setBusy(true);
    try {
      await api.del(`/stores/${storeId}/strategies/${s.id}`);
      toast.ok("Strategy deleted");
      list.refresh();
      setConfirming(null);
    } catch (err) {
      toast.bad(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DataTable
        list={list} storeId={storeId} tableKey="strategies"
        emptyMessage="No strategies. Labels keep whatever template they are bound to."
        columns={[
          { key: "priority", header: "Priority", sortable: true, align: "right", required: true },
          { key: "name", header: "Name", sortable: true, required: true },
          { key: "condition", header: "Condition", required: true,
            render: (r) => (
              <span className="mono" style={{ fontSize: 12 }}>
                {r.condition?.field} {r.condition?.op}{" "}
                {Array.isArray(r.condition?.value)
                  ? r.condition.value.join(", ")
                  : String(r.condition?.value ?? "")}
              </span>
            ) },
          { key: "template", header: "Template",
            render: (r) => r.template?.name ?? r.templateId?.slice(-8) ?? "—" },
          { key: "enabled", header: "Status",
            render: (r) => <Chip tone={r.enabled ? "ok" : ""}>
              {r.enabled ? "enabled" : "paused"}</Chip> },
          { key: "actions", header: "", required: true,
            render: (r) => admin && (
              <span className="inline">
                <Btn sm onClick={() => setEditing(r)}>Edit</Btn>
                <Btn sm kind="danger" onClick={() => setConfirming(r)}>Delete</Btn>
              </span>
            ) },
        ]}
        toolbar={
          <>
            {admin && <Btn kind="primary" onClick={() => setEditing({})}>+ Add strategy</Btn>}
            {can("OPERATOR") && <Btn onClick={applyAll}>Apply to all labels</Btn>}
          </>
        }
      />
      {editing && (
        <StrategyModal storeId={storeId} strategy={editing.id ? editing : null}
          onClose={() => setEditing(null)} onSaved={list.refresh} />
      )}
      {confirming && (
        <Confirm title="Delete strategy" busy={busy}
          message={`Delete "${confirming.name}"? Labels already assigned keep their template.`}
          onConfirm={() => destroy(confirming)} onClose={() => setConfirming(null)} />
      )}
    </>
  );
}

/* ----------------------------- media library ------------------------------- */

function Media({ storeId }) {
  const toast = useToast();
  const { can } = useSession();
  const admin = can("ADMIN");
  const list = useList(`/stores/${storeId}/media`, { sort: "createdAt" });
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  async function upload(file) {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      await api.upload(`/stores/${storeId}/media`, form);
      toast.ok("Uploaded");
      list.refresh();
    } catch (err) {
      toast.bad(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function destroy(m) {
    setBusy(true);
    try {
      await api.del(`/stores/${storeId}/media/${m.id}`);
      toast.ok("Deleted");
      list.refresh();
      setConfirming(null);
    } catch (err) {
      toast.bad(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        {admin && (
          <label className="btn primary" style={{ cursor: uploading ? "wait" : "pointer" }}>
            {uploading ? <Spinner /> : null} ↥ Upload image
            <input type="file" accept="image/*" hidden disabled={uploading}
              onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        )}
        <span className="faint" style={{ fontSize: 12 }}>
          Images up to 5 MB. Referenced from template layouts by asset id.
        </span>
      </div>

      {list.loading && <Card><div className="empty"><Spinner /></div></Card>}

      {!list.loading && list.items.length === 0 && (
        <Card><div className="empty">No media yet.</div></Card>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))" }}>
        {list.items.map((m) => (
          <Card key={m.id} style={{ padding: 10 }}>
            <div style={{ background: "var(--bg)", borderRadius: 8, overflow: "hidden",
              aspectRatio: "4/3", display: "grid", placeItems: "center" }}>
              {/* Served through the API so tenancy is checked on every read. */}
              <img src={`/api/stores/${storeId}/media/${m.id}`} alt={m.name}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            </div>
            <div style={{ fontSize: 12.5, marginTop: 8, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.name}>{m.name}</div>
            <div className="faint" style={{ fontSize: 11 }}>
              {m.width && m.height ? `${m.width}×${m.height} · ` : ""}
              {Math.round((m.bytes ?? 0) / 1024)} KB
            </div>
            <div className="inline" style={{ marginTop: 8, justifyContent: "space-between" }}>
              <span className="faint mono" style={{ fontSize: 10 }}>{m.id.slice(-8)}</span>
              {admin && <Btn sm kind="danger" onClick={() => setConfirming(m)}>Delete</Btn>}
            </div>
          </Card>
        ))}
      </div>

      {list.totalPages > 1 && (
        <div className="pager">
          <Btn sm disabled={list.params.page <= 1}
            onClick={() => list.setPage(list.params.page - 1)}>Prev</Btn>
          <span>{list.params.page} / {list.totalPages}</span>
          <Btn sm disabled={list.params.page >= list.totalPages}
            onClick={() => list.setPage(list.params.page + 1)}>Next</Btn>
        </div>
      )}

      {confirming && (
        <Confirm title="Delete image" busy={busy}
          message={`Delete "${confirming.name}"? Templates referencing it will render a gap.`}
          onConfirm={() => destroy(confirming)} onClose={() => setConfirming(null)} />
      )}
    </>
  );
}

/* -------------------------------- screen ---------------------------------- */

export default function SettingsPage({ params }) {
  const { storeId } = use(params);
  const [tab, setTab] = useState("groups");

  const Panel = {
    groups: Groups, parameters: Parameters, schedules: Schedules,
    strategies: Strategies, media: Media,
  }[tab];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Store Settings</h1>
          <div className="sub">Grouping, tuning, automation and assets</div>
        </div>
      </div>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <Panel storeId={storeId} />
    </div>
  );
}
