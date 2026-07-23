"use client";
// Templates — the artwork each shelf tag paints.
// A grid rather than a table: these are pictures, and the server-rendered
// preview is the only honest way to show one. There is no layout editor here;
// the layout is edited as JSON and validated by the same Zod schema the
// renderer parses, so a bad hand-edit fails in the modal, not on a shelf.
import { use, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { useList } from "@/lib/client/useList";
import { useSession } from "@/components/Session";
import {
  Btn, Card, Chip, Confirm, DebouncedSearch, Field, Modal, Select, Spinner,
  useToast, dateTime,
} from "@/components/ui";

const KINDS = ["LABEL", "STORE"];
const COLOR_LABEL = {
  BW: "Black / white", BWR: "Black / white / red",
  BWRY: "Black / white / red / yellow", SEVEN_COLOR: "Seven colour",
};

/** Presets come from the server so the picker can never offer a combination
    templateCreateSchema would reject. */
function usePresets(storeId) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    api.get(`/stores/${storeId}/templates/presets`)
      .then((res) => live && setData(res))
      .catch(() => {});
    return () => { live = false; };
  }, [storeId]);
  return data;
}

/* --------------------------------- card ----------------------------------- */

function TemplateCard({ storeId, template, nonce, canEdit, onEdit, onDuplicate, onDelete }) {
  return (
    <Card>
      <div style={{ background: "#fff", borderRadius: 8, border: "1px solid var(--line)",
        padding: 8, display: "grid", placeItems: "center", minHeight: 120 }}>
        <img alt={`${template.name} preview`}
          src={`/api/stores/${storeId}/templates/${template.id}/preview?_=${nonce}`}
          style={{ maxWidth: "100%", display: "block" }} />
      </div>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between",
        alignItems: "baseline", gap: 10 }}>
        <b style={{ fontSize: 14 }}>{template.name}</b>
        <Chip>{template.kind}</Chip>
      </div>

      <div className="inline" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <Chip tone="blue">{template.sizeInches}&quot;</Chip>
        <Chip>{COLOR_LABEL[template.colorMode] ?? template.colorMode}</Chip>
        <span className="faint mono" style={{ fontSize: 11.5 }}>
          {template.widthPx}×{template.heightPx}px
        </span>
        {template.rotation ? <Chip tone="warn">{template.rotation}°</Chip> : null}
      </div>

      <div className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>
        Updated {dateTime(template.updatedAt)}
      </div>

      <div className="inline" style={{ marginTop: 12 }}>
        <Btn sm onClick={() => onEdit(template)}>{canEdit ? "Edit" : "View"}</Btn>
        {canEdit && <Btn sm onClick={() => onDuplicate(template)}>Duplicate</Btn>}
        {canEdit && <Btn sm kind="danger" onClick={() => onDelete(template)}>Delete</Btn>}
      </div>
    </Card>
  );
}

/* ------------------------------ create modal ------------------------------ */

function CreateModal({ storeId, presets, onClose, onSaved }) {
  const toast = useToast();
  const list = presets?.presets ?? [];
  const [form, setForm] = useState({ name: "", kind: "LABEL", size: "", colorMode: "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const preset = list.find((p) => String(p.sizeInches) === form.size) ?? null;

  // Picking a panel decides the pixels outright, and can invalidate the colour
  // mode chosen for the previous one — so reset it with the size.
  const pickSize = (e) => {
    const size = e.target.value;
    const next = list.find((p) => String(p.sizeInches) === size);
    setForm((f) => ({ ...f, size, colorMode: next?.colorModes[0] ?? "" }));
  };

  async function save() {
    if (!preset) return;
    setBusy(true);
    setErrors({});
    try {
      const created = await api.post(`/stores/${storeId}/templates`, {
        name: form.name,
        kind: form.kind,
        sizeInches: preset.sizeInches,
        widthPx: preset.widthPx,
        heightPx: preset.heightPx,
        colorMode: form.colorMode,
        layout: { elements: [], background: "white" },
      });
      toast.ok(`Created ${created.name}`);
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
    <Modal title="New template" onClose={onClose} footer={
      <>
        <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn kind="primary" onClick={save} disabled={busy || !preset || !form.name}>
          {busy ? <Spinner /> : null} Create
        </Btn>
      </>
    }>
      {!presets ? <div className="empty"><Spinner /> Loading panels…</div> : (
        <>
          <Field label="Name *" value={form.name} error={errors.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Select label="Kind" value={form.kind} options={KINDS}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} />
          <Select label="Panel *" value={form.size} onChange={pickSize}
            error={errors.sizeInches}
            options={[{ value: "", label: "— choose a device —" },
              ...list.map((p) => ({
                value: String(p.sizeInches),
                label: `${p.label} — ${p.widthPx}×${p.heightPx}px`,
              }))]} />
          <Select label="Colour mode" value={form.colorMode} disabled={!preset}
            error={errors.colorMode}
            onChange={(e) => setForm((f) => ({ ...f, colorMode: e.target.value }))}
            hint={preset ? `Inks this panel can lay down: ${(presets.palettes[form.colorMode] ?? []).join(", ")}` : "Choose a panel first."}
            options={(preset?.colorModes ?? []).map((c) => ({
              value: c, label: COLOR_LABEL[c] ?? c,
            }))} />
          {preset && (
            <Card style={{ background: "var(--panel2)" }}>
              <div className="kv"><span className="k">Pixels</span>
                <b className="mono">{preset.widthPx}×{preset.heightPx}</b></div>
              <div className="kv"><span className="k">Diagonal</span>
                <b className="mono">{preset.label}</b></div>
              <div className="hint" style={{ marginTop: 8 }}>
                Pixel dimensions follow the panel and cannot be typed in — a template
                that does not match a real panel lands cropped on the shelf.
              </div>
            </Card>
          )}
        </>
      )}
    </Modal>
  );
}

/* ------------------------------- edit modal ------------------------------- */

function EditModal({ storeId, template, presets, readOnly, onClose, onSaved }) {
  const toast = useToast();
  const list = presets?.presets ?? [];
  const [form, setForm] = useState(() => ({
    name: template.name, kind: template.kind,
    size: String(template.sizeInches), colorMode: template.colorMode,
    rotation: String(template.rotation ?? 0),
    layout: JSON.stringify(template.layout ?? { elements: [], background: "white" }, null, 2),
  }));
  const [errors, setErrors] = useState({});
  const [layoutError, setLayoutError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const preset = list.find((p) => String(p.sizeInches) === form.size) ?? null;

  const pickSize = (e) => {
    const size = e.target.value;
    const next = list.find((p) => String(p.sizeInches) === size);
    setForm((f) => ({
      ...f, size,
      colorMode: next?.colorModes.includes(f.colorMode) ? f.colorMode : (next?.colorModes[0] ?? ""),
    }));
  };

  async function save() {
    setErrors({});
    setLayoutError(null);

    // Catch malformed JSON here so the user gets a parse position rather than a
    // 422 about a field they cannot see.
    let layout;
    try {
      layout = JSON.parse(form.layout);
    } catch (err) {
      setLayoutError(err.message);
      return;
    }

    setBusy(true);
    try {
      await api.patch(`/stores/${storeId}/templates/${template.id}`, {
        name: form.name,
        kind: form.kind,
        ...(preset && {
          sizeInches: preset.sizeInches,
          widthPx: preset.widthPx,
          heightPx: preset.heightPx,
        }),
        colorMode: form.colorMode,
        rotation: Number(form.rotation),
        layout,
      });
      toast.ok("Template saved");
      setNonce((n) => n + 1);
      onSaved();
      onClose();
    } catch (err) {
      // The layout is a nested object, so its issues arrive as
      // "layout.elements.0.fontSize" — show them verbatim, one per line.
      if (err.details?.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
        setLayoutError(err.details
          .filter((d) => d.path.startsWith("layout"))
          .map((d) => `${d.path}: ${d.message}`)
          .join("\n") || null);
      }
      toast.bad(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal wide title={readOnly ? template.name : `Edit ${template.name}`} onClose={onClose}
      footer={!readOnly && (
        <>
          <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn kind="primary" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : null} Save
          </Btn>
        </>
      )}>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
        <div>
          <Field label="Name *" value={form.name} error={errors.name} disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Select label="Kind" value={form.kind} options={KINDS} disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} />
          <Select label="Panel" value={form.size} onChange={pickSize} disabled={readOnly}
            error={errors.sizeInches ?? errors.widthPx}
            options={list.map((p) => ({
              value: String(p.sizeInches),
              label: `${p.label} — ${p.widthPx}×${p.heightPx}px`,
            }))} />
          <Select label="Colour mode" value={form.colorMode} disabled={readOnly || !preset}
            error={errors.colorMode}
            onChange={(e) => setForm((f) => ({ ...f, colorMode: e.target.value }))}
            options={(preset?.colorModes ?? [template.colorMode]).map((c) => ({
              value: c, label: COLOR_LABEL[c] ?? c,
            }))} />
          <Select label="Rotation" value={form.rotation} disabled={readOnly}
            error={errors.rotation}
            onChange={(e) => setForm((f) => ({ ...f, rotation: e.target.value }))}
            options={[0, 90, 180, 270].map((r) => ({ value: String(r), label: `${r}°` }))} />

          <div className="label" style={{ fontSize: 11, color: "var(--dim)", marginBottom: 6 }}>
            PREVIEW
          </div>
          <div style={{ background: "#fff", borderRadius: 8, border: "1px solid var(--line)",
            padding: 8 }}>
            <img alt="Template preview"
              src={`/api/stores/${storeId}/templates/${template.id}/preview?_=${nonce}`}
              style={{ maxWidth: "100%", display: "block", margin: "0 auto" }} />
          </div>
        </div>

        <div>
          <Field label="Layout JSON" error={layoutError}
            hint="Elements are text, barcode, qrcode, image, rect or line. Validated against the renderer's schema on save.">
            <textarea className="textarea" spellCheck={false} rows={24}
              readOnly={readOnly} value={form.layout}
              style={{ fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12 }}
              onChange={(e) => setForm((f) => ({ ...f, layout: e.target.value }))} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------- screen ---------------------------------- */

export default function TemplatesPage({ params }) {
  const { storeId } = use(params);
  const toast = useToast();
  const { can } = useSession();
  const canEdit = can("ADMIN");

  const list = useList(`/stores/${storeId}/templates`, { pageSize: 12, sort: "updatedAt" });
  const presets = usePresets(storeId);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  // Previews are server-rendered and uncached; bump this to force a refetch
  // after anything that could change the artwork.
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    list.refresh();
    setNonce((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.refresh]);

  async function duplicate(template) {
    try {
      const copy = await api.post(`/stores/${storeId}/templates/${template.id}/duplicate`);
      toast.ok(`Created ${copy.name}`);
      reload();
    } catch (err) {
      toast.bad(err.message);
    }
  }

  async function destroy(template) {
    setBusy(true);
    try {
      await api.del(`/stores/${storeId}/templates/${template.id}`);
      toast.ok("Template deleted");
      setConfirming(null);
      reload();
    } catch (err) {
      // 409 carries the count of labels or strategies still pointing here.
      // Generic "delete failed" would leave the operator with nowhere to go.
      if (err.status === 409) {
        const used = err.details?.labels ?? err.details?.strategies;
        setConfirming((c) => c && { ...c, blocked: err.message, used });
      }
      toast.bad(err.message);
    } finally {
      setBusy(false);
    }
  }

  const sizes = [...new Set((presets?.presets ?? []).map((p) => p.sizeInches))];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Templates</h1>
          <div className="sub">Artwork bound to labels, rendered exactly as the tag paints it</div>
        </div>
      </div>

      <div className="toolbar">
        <DebouncedSearch value={list.params.q}
          onChange={(q) => list.setFilter({ q })} placeholder="Search name…" />
        <select className="select" style={{ width: "auto" }}
          value={list.params.kind ?? ""}
          onChange={(e) => list.setFilter({ kind: e.target.value })}>
          <option value="">All kinds</option>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select className="select" style={{ width: "auto" }}
          value={list.params.sizeInches ?? ""}
          onChange={(e) => list.setFilter({ sizeInches: e.target.value })}>
          <option value="">All sizes</option>
          {sizes.map((s) => <option key={s} value={s}>{s}&quot;</option>)}
        </select>
        <select className="select" style={{ width: "auto" }}
          value={list.params.colorMode ?? ""}
          onChange={(e) => list.setFilter({ colorMode: e.target.value })}>
          <option value="">All colour modes</option>
          {Object.entries(COLOR_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="spacer" />
        {canEdit && <Btn kind="primary" onClick={() => setCreating(true)}>+ New template</Btn>}
      </div>

      {list.loading && list.items.length === 0 && (
        <Card><div className="empty"><Spinner /> Loading…</div></Card>
      )}
      {!list.loading && list.items.length === 0 && (
        <Card><div className="empty">
          {list.error ? list.error.message : "No templates match these filters."}
        </div></Card>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
        {list.items.map((t) => (
          <TemplateCard key={t.id} storeId={storeId} template={t} nonce={nonce}
            canEdit={canEdit}
            onEdit={(x) => setEditing(x)}
            onDuplicate={duplicate}
            onDelete={(x) => setConfirming({ template: x })} />
        ))}
      </div>

      <div className="pager">
        <Btn sm disabled={list.params.page <= 1}
          onClick={() => list.setPage(list.params.page - 1)}>Prev</Btn>
        <span className="faint">Page {list.params.page} of {list.totalPages}</span>
        <Btn sm disabled={list.params.page >= list.totalPages}
          onClick={() => list.setPage(list.params.page + 1)}>Next</Btn>
        <span className="spacer" />
        <span>{list.total.toLocaleString()} template{list.total === 1 ? "" : "s"}</span>
      </div>

      {creating && (
        <CreateModal storeId={storeId} presets={presets}
          onClose={() => setCreating(false)} onSaved={reload} />
      )}
      {editing && (
        <EditModal storeId={storeId} template={editing} presets={presets} readOnly={!canEdit}
          onClose={() => setEditing(null)} onSaved={reload} />
      )}
      {confirming && (
        <Confirm
          title="Delete template"
          busy={busy}
          confirmLabel={confirming.blocked ? "Try again" : "Delete"}
          message={confirming.blocked
            ? `${confirming.blocked}. Point them at another template first — the API refuses rather than silently unbinding live shelf tags.`
            : `Delete ${confirming.template.name}? This is recorded in the deletion log.`}
          onConfirm={() => destroy(confirming.template)}
          onClose={() => setConfirming(null)} />
      )}
    </div>
  );
}
