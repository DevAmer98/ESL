"use client";
// Store Data — the product catalogue that feeds every shelf label.
// This screen is the reference implementation for the console's table pattern:
// useList + DataTable + a create/edit modal + CSV import/export + bulk actions.
import { use, useState } from "react";
import { api, download } from "@/lib/client/api";
import { useList } from "@/lib/client/useList";
import { DataTable } from "@/components/DataTable";
import { useSession } from "@/components/Session";
import {
  Btn, Card, Confirm, DebouncedSearch, Field, Modal, Spinner, useToast, dateTime,
} from "@/components/ui";

const COLUMNS = (edit, remove, canEdit) => [
  { key: "code", header: "ID", sortable: true, required: true,
    render: (r) => <span className="mono">{r.code}</span> },
  { key: "name", header: "Name", sortable: true, required: true },
  { key: "specification", header: "Specification" },
  { key: "unit", header: "Unit" },
  { key: "priceCents", header: "Price", sortable: true, align: "right",
    render: (r) => <span className="mono">{r.price}</span> },
  { key: "memberPriceCents", header: "Member price", align: "right",
    render: (r) => <span className="mono">{r.memberPrice ?? "—"}</span> },
  { key: "brand", header: "Brand", sortable: true },
  { key: "weight", header: "Weight" },
  { key: "origin", header: "Origin" },
  { key: "sku", header: "Barcode", sortable: true,
    render: (r) => <span className="mono">{r.sku ?? "—"}</span> },
  { key: "updatedAt", header: "Updated", sortable: true,
    render: (r) => dateTime(r.updatedAt) },
  { key: "actions", header: "", required: true,
    render: (r) => (
      <span className="inline" onClick={(e) => e.stopPropagation()}>
        <Btn sm onClick={() => edit(r)}>{canEdit ? "Edit" : "View"}</Btn>
        {canEdit && <Btn sm kind="danger" onClick={() => remove(r)}>Delete</Btn>}
      </span>
    ) },
];

/* ------------------------------ edit modal -------------------------------- */

const FIELDS = [
  ["code", "Product ID", true], ["name", "Name", true],
  ["specification", "Specification"], ["unit", "Unit"],
  ["price", "Price"], ["memberPrice", "Member price"],
  ["brand", "Brand"], ["weight", "Weight"],
  ["origin", "Origin"], ["sku", "Barcode"], ["glyph", "Glyph"],
];

function ProductModal({ storeId, product, onClose, onSaved, readOnly }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    code: product?.code ?? "", name: product?.name ?? "",
    specification: product?.specification ?? "", unit: product?.unit ?? "",
    price: product?.price ?? "0.00", memberPrice: product?.memberPrice ?? "",
    brand: product?.brand ?? "", weight: product?.weight ?? "",
    origin: product?.origin ?? "", sku: product?.sku ?? "", glyph: product?.glyph ?? "📦",
  }));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setErrors({});
    // Empty optional strings must go as null, not "" — otherwise a cleared
    // field round-trips as an empty string and prints on the tag.
    const payload = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v === "" ? null : v]),
    );
    if (payload.memberPrice == null) delete payload.memberPrice;

    try {
      if (product) await api.patch(`/stores/${storeId}/products/${product.id}`, payload);
      else await api.post(`/stores/${storeId}/products`, payload);
      toast.ok(product ? "Product updated" : "Product created");
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
    <Modal wide title={product ? `Edit ${product.code}` : "New product"} onClose={onClose}
      footer={!readOnly && (
        <>
          <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn kind="primary" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : null} Save
          </Btn>
        </>
      )}>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
        {FIELDS.map(([key, label, required]) => (
          <Field key={key} label={label + (required ? " *" : "")} value={form[key]}
            onChange={set(key)} disabled={readOnly} error={errors[key]} />
        ))}
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
      const res = await api.upload(`/stores/${storeId}/products/import`, form);
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
    <Modal title="Import products" onClose={onClose} footer={
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
        Requires <span className="mono">code</span> and <span className="mono">name</span>{" "}
        columns. Rows are matched on <span className="mono">code</span> — existing products are
        updated, new ones created. Unrecognised columns are kept as custom attributes.
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
              {result.errors.map((e, i) => (
                <div key={i}>Line {e.line}: {e.message}</div>
              ))}
            </div>
          )}
        </Card>
      )}
    </Modal>
  );
}

/* -------------------------------- screen ---------------------------------- */

export default function StoreDataPage({ params }) {
  const { storeId } = use(params);
  const toast = useToast();
  const { can } = useSession();
  const canEdit = can("ADMIN");

  const list = useList(`/stores/${storeId}/products`, { sort: "updatedAt" });
  const [editing, setEditing] = useState(null);   // { product } | { product: null }
  const [importing, setImporting] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  async function destroy(ids, clear) {
    setBusy(true);
    try {
      if (ids.length === 1) await api.del(`/stores/${storeId}/products/${ids[0]}`);
      else await api.post(`/stores/${storeId}/products/bulk`, { action: "delete", ids });
      toast.ok(`Deleted ${ids.length} product${ids.length === 1 ? "" : "s"}`);
      clear?.();
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
          <h1>Store Data</h1>
          <div className="sub">Product catalogue bound to the shelf edge</div>
        </div>
      </div>

      <DataTable
        list={list}
        storeId={storeId}
        tableKey="products"
        selectable={canEdit}
        columns={COLUMNS(
          (p) => setEditing({ product: p }),
          (p) => setConfirming({ ids: [p.id], label: p.code }),
          canEdit,
        )}
        emptyMessage="No products yet. Add one, or import a CSV."
        bulkActions={canEdit ? [{
          label: "Delete", kind: "danger",
          onRun: (ids, clear) => setConfirming({ ids, label: `${ids.length} products`, clear }),
        }] : []}
        toolbar={
          <>
            <DebouncedSearch value={list.params.q}
              onChange={(q) => list.setFilter({ q })}
              placeholder="Search id, name, barcode…" />
            {canEdit && (
              <Btn kind="primary" onClick={() => setEditing({ product: null })}>+ Add</Btn>
            )}
            {can("OPERATOR") && <Btn onClick={() => setImporting(true)}>↥ Import</Btn>}
            <Btn onClick={() =>
              download(`/stores/${storeId}/products/export${list.exportQuery}`)}>
              ↧ Export
            </Btn>
          </>
        }
      />

      {editing && (
        <ProductModal storeId={storeId} product={editing.product} readOnly={!canEdit}
          onClose={() => setEditing(null)} onSaved={list.refresh} />
      )}
      {importing && (
        <ImportModal storeId={storeId} onClose={() => setImporting(false)}
          onDone={list.refresh} />
      )}
      {confirming && (
        <Confirm
          title="Delete products"
          message={`Delete ${confirming.label}? Labels bound to them will be left unbound. This is recorded in the deletion log.`}
          busy={busy}
          onConfirm={() => destroy(confirming.ids, confirming.clear)}
          onClose={() => setConfirming(null)} />
      )}
    </div>
  );
}
