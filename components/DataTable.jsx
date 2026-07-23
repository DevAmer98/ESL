"use client";
// -----------------------------------------------------------------------------
// components/DataTable.jsx — the table every list screen renders.
//
// Sorting, paging and searching are all server-side (see lib/client/useList);
// this component only presents them. Column visibility is per user, persisted
// through the ColumnPreference API, so an operator's layout follows them
// between machines.
// -----------------------------------------------------------------------------
import React, { useEffect, useMemo, useState } from "react";
import { Btn, Modal, Spinner } from "@/components/ui";
import { api } from "@/lib/client/api";

/* ------------------------------ pagination -------------------------------- */

/** 1 … 4 5 [6] 7 8 … 20 — never more than ~9 buttons however deep the list. */
function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) out.push("…");
  for (let i = from; i <= to; i++) out.push(i);
  if (to < total - 1) out.push("…");
  out.push(total);
  return out;
}

function Pager({ page, totalPages, total, pageSize, onPage, onPageSize }) {
  return (
    <div className="pager">
      <Btn sm disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</Btn>
      {pageWindow(page, totalPages).map((p, i) =>
        p === "…"
          ? <span key={`gap${i}`} className="faint">…</span>
          : <Btn key={p} sm className={p === page ? "current" : ""}
              onClick={() => onPage(p)}>{p}</Btn>,
      )}
      <Btn sm disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</Btn>
      <select className="select" style={{ width: "auto" }} value={pageSize}
        onChange={(e) => onPageSize(Number(e.target.value))}>
        {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
      </select>
      <span className="spacer" />
      <span>{total.toLocaleString()} item{total === 1 ? "" : "s"}</span>
    </div>
  );
}

/* --------------------------- column customization ------------------------- */

function ColumnPicker({ columns, visible, onChange, onClose }) {
  const [local, setLocal] = useState(visible);
  const toggle = (key) =>
    setLocal((v) => (v.includes(key) ? v.filter((k) => k !== key) : [...v, key]));

  return (
    <Modal title="Customize columns" onClose={onClose} footer={
      <>
        <Btn onClick={() => setLocal(columns.map((c) => c.key))}>Show all</Btn>
        <span className="spacer" />
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" onClick={() => { onChange(local); onClose(); }}>Apply</Btn>
      </>
    }>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))" }}>
        {columns.map((c) => (
          <label key={c.key} className="inline" style={{ cursor: "pointer" }}>
            <input type="checkbox" className="checkbox"
              checked={local.includes(c.key)}
              disabled={c.required}
              onChange={() => toggle(c.key)} />
            <span className={c.required ? "faint" : ""}>{c.header}</span>
          </label>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 14 }}>
        Saved to your account for this store.
      </div>
    </Modal>
  );
}

/* -------------------------------- table ---------------------------------- */

/**
 * @param columns  [{ key, header, render?, sortable?, required?, align? }]
 * @param list     the object returned by useList()
 * @param rowKey   fn(row) → stable key
 * @param selectable enables checkboxes + the bulk bar
 * @param bulkActions [{ label, kind?, onRun(selectedIds, clear) }]
 * @param tableKey  persists column prefs under this name; omit to skip
 */
export function DataTable({
  columns,
  list,
  rowKey = (r) => r.id,
  selectable = false,
  bulkActions = [],
  tableKey,
  storeId,
  toolbar,
  onRowClick,
  emptyMessage = "Nothing here yet.",
}) {
  const [selected, setSelected] = useState([]);
  const [picking, setPicking] = useState(false);
  const [visible, setVisible] = useState(() => columns.map((c) => c.key));

  // Load this user's saved column layout once per table.
  useEffect(() => {
    if (!tableKey || !storeId) return;
    let live = true;
    api.get(`/stores/${storeId}/column-preferences?tableKey=${tableKey}`)
      .then((res) => {
        const saved = res?.config?.visible;
        if (live && Array.isArray(saved) && saved.length) {
          // Intersect with the current column set so a renamed or removed
          // column in a new release cannot blank someone's table.
          const valid = saved.filter((k) => columns.some((c) => c.key === k));
          if (valid.length) setVisible(valid);
        }
      })
      .catch(() => {});
    return () => { live = false; };
  }, [tableKey, storeId, columns]);

  const saveColumns = (next) => {
    setVisible(next);
    if (!tableKey || !storeId) return;
    api.put(`/stores/${storeId}/column-preferences`, {
      tableKey, config: { visible: next },
    }).catch(() => {});
  };

  const shown = useMemo(
    () => columns.filter((c) => visible.includes(c.key)),
    [columns, visible],
  );

  const ids = list.items.map(rowKey);
  const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id));
  const clear = () => setSelected([]);

  // Drop selections for rows that are no longer on screen (page/filter change).
  useEffect(() => {
    setSelected((s) => s.filter((id) => ids.includes(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.params.page, list.params.q, list.params.pageSize]);

  const sortGlyph = (key) =>
    list.params.sort === key ? (list.params.order === "asc" ? " ▲" : " ▼") : "";

  return (
    <>
      <div className="toolbar">
        {toolbar}
        {tableKey && (
          <>
            <span className="spacer" />
            <Btn sm onClick={() => setPicking(true)}>▦ Columns</Btn>
          </>
        )}
      </div>

      {selectable && selected.length > 0 && (
        <div className="toolbar" style={{
          background: "var(--panel2)", border: "1px solid var(--line)",
          borderRadius: 10, padding: "8px 12px",
        }}>
          <b>{selected.length} selected</b>
          {bulkActions.map((a) => (
            <Btn key={a.label} sm kind={a.kind}
              onClick={() => a.onRun(selected, clear)}>{a.label}</Btn>
          ))}
          <span className="spacer" />
          <Btn sm onClick={clear}>Clear</Btn>
        </div>
      )}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {selectable && (
                <th style={{ width: 36 }}>
                  <input type="checkbox" className="checkbox" checked={allSelected}
                    onChange={() => setSelected(allSelected ? [] : ids)} />
                </th>
              )}
              {shown.map((c) => (
                <th key={c.key}
                  className={c.sortable ? "sortable" : ""}
                  style={{ textAlign: c.align ?? "left" }}
                  onClick={c.sortable ? () => list.toggleSort(c.key) : undefined}>
                  {c.header}{c.sortable ? sortGlyph(c.key) : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.loading && list.items.length === 0 && (
              <tr><td colSpan={shown.length + (selectable ? 1 : 0)} className="empty">
                <Spinner /> Loading…
              </td></tr>
            )}

            {!list.loading && list.items.length === 0 && (
              <tr><td colSpan={shown.length + (selectable ? 1 : 0)} className="empty">
                {list.error ? list.error.message : emptyMessage}
              </td></tr>
            )}

            {list.items.map((row) => {
              const id = rowKey(row);
              return (
                <tr key={id} className={selected.includes(id) ? "selected" : ""}
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}>
                  {selectable && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="checkbox"
                        checked={selected.includes(id)}
                        onChange={() => setSelected((s) =>
                          s.includes(id) ? s.filter((x) => x !== id) : [...s, id])} />
                    </td>
                  )}
                  {shown.map((c) => (
                    <td key={c.key} style={{ textAlign: c.align ?? "left" }}
                      className={c.key === "actions" ? "col-actions" : ""}>
                      {c.render ? c.render(row) : (row[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager page={list.params.page} totalPages={list.totalPages} total={list.total}
        pageSize={list.params.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />

      {picking && (
        <ColumnPicker columns={columns} visible={visible}
          onChange={saveColumns} onClose={() => setPicking(false)} />
      )}
    </>
  );
}
