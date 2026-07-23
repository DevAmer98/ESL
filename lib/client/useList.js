"use client";
// -----------------------------------------------------------------------------
// lib/client/useList.js — one hook behind every table in the console.
//
// Owns the query state (page, size, sort, search, filters), fetching, and the
// refresh-after-mutation cycle. Screens then only describe columns and actions.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { api, qs } from "@/lib/client/api";

export function useList(basePath, { pageSize = 20, sort, order = "desc", filters: initialFilters } = {}) {
  const [params, setParams] = useState({
    page: 1, pageSize, sort, order, q: "", ...initialFilters,
  });
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Guards against a slow early request landing after a newer one.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const res = await api.get(`${basePath}${qs(params)}`);
      if (mine !== seq.current) return;
      setData(res);
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [basePath, params]);

  useEffect(() => { load(); }, [load]);

  /** Change filters/search — always returns to page 1, since page 3 of a new
      filter is rarely what anyone means. */
  const setFilter = useCallback((patch) => {
    setParams((p) => ({ ...p, ...patch, page: 1 }));
  }, []);

  const setPage = useCallback((page) => setParams((p) => ({ ...p, page })), []);
  const setPageSize = useCallback((n) => setParams((p) => ({ ...p, pageSize: n, page: 1 })), []);

  /** Click a column header: same column toggles direction, new column resets. */
  const toggleSort = useCallback((column) => {
    setParams((p) => ({
      ...p,
      sort: column,
      order: p.sort === column && p.order === "desc" ? "asc" : "desc",
      page: 1,
    }));
  }, []);

  return {
    params, setFilter, setPage, setPageSize, toggleSort,
    items: data.items ?? [],
    total: data.total ?? 0,
    totalPages: data.totalPages ?? 1,
    /** The whole response — some endpoints return aggregates beside `items`
        (offline history's `summary`, data changes' `entities`). */
    raw: data,
    loading, error,
    refresh: load,
    /** Query string for export endpoints — same filters, no pagination. */
    exportQuery: qs({ ...params, page: undefined, pageSize: undefined }),
  };
}
