"use client";
// -----------------------------------------------------------------------------
// lib/client/api.js — the browser's only way to reach the API.
//
// Centralised so that the error envelope is unwrapped in exactly one place and
// a 401 anywhere in the app lands the user back on the login screen instead of
// rendering a broken table.
// -----------------------------------------------------------------------------

export class ApiClientError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, { method = "GET", json, form, signal } = {}) {
  const init = { method, signal, headers: {} };

  if (json !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(json);
  } else if (form) {
    init.body = form; // let the browser set the multipart boundary
  }

  const res = await fetch(`/api${path}`, init);

  if (res.status === 401 && typeof window !== "undefined") {
    const here = window.location.pathname + window.location.search;
    if (!here.startsWith("/login")) {
      window.location.href = `/login?next=${encodeURIComponent(here)}`;
    }
    throw new ApiClientError(401, "unauthorized", "Session expired");
  }

  if (res.status === 204) return null;

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (!res.ok) throw new ApiClientError(res.status, "http_error", await res.text());
    return res;
  }

  const payload = await res.json();
  if (!res.ok) {
    const e = payload?.error ?? {};
    throw new ApiClientError(res.status, e.code ?? "error", e.message ?? "Request failed", e.details);
  }
  return payload;
}

export const api = {
  get: (p, opt) => request(p, opt),
  post: (p, json, opt) => request(p, { ...opt, method: "POST", json }),
  patch: (p, json, opt) => request(p, { ...opt, method: "PATCH", json }),
  put: (p, json, opt) => request(p, { ...opt, method: "PUT", json }),
  del: (p, opt) => request(p, { ...opt, method: "DELETE" }),
  upload: (p, form, opt) => request(p, { ...opt, method: "POST", form }),
};

/** Build a query string, dropping empty values so URLs stay readable. */
export function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, v instanceof Date ? v.toISOString() : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Trigger a browser download for an export endpoint. */
export function download(path) {
  window.location.href = `/api${path}`;
}
