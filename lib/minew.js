// -----------------------------------------------------------------------------
// lib/minew.js — THE ONLY HARDWARE-FACING MODULE.
//
// Talks to a (self-hosted) MinewTag ESL Cloud v3 backend via its Open API. Minew
// renders the e-paper bitmap, drives the MQTT gateway and the BLE downlink; this
// module is Frostline's translation layer on top of that.
//
// What is specific to the v3 API and lives nowhere else:
//   1. Auth is login-based. POST /apis/action/login with an MD5 password returns
//      a token valid ~24h. It travels in a header literally named `token`
//      (NOT `Authorization: Bearer`). We cache it in-process and refresh lazily.
//   2. Success is `code === 200` (not 0). Any other code is an application error.
//   3. There is no "send data to a MAC". The model is goods + template + bind:
//        - a tag is BOUND once to a data record (goods) + a template (demoId)
//          via /apis/esl/label/update,
//        - thereafter changing the data via /apis/esl/goods/updateToStore
//          auto-refreshes ("brushes") the bound tag.
//      So pushToLabel() == updateToStore(); bindLabel() is the one-time setup.
//   4. Data fields are per-merchant and dynamic. Sending a field the merchant's
//      schema does not define makes the backend throw `code 5000`. We therefore
//      send only mapped, non-empty fields and never invent field names.
//
// >>> CLOUD-mode configuration lives on StoreSettings:
// >>>   cloudUrl                     -> API base, e.g. https://esl.smartvisionss.com:9443
// >>>   tokenCipher                  -> the Minew *password*, encrypted at rest
// >>>   parameters.minewUsername     -> the Minew login username
// >>>   parameters.minewStoreId      -> the Minew store id (NOT Frostline's store id)
// >>>   parameters.minewFieldMap     -> optional { minewField: productProperty } overrides
// >>>   parameters.minewPaths        -> optional endpoint-path overrides
// -----------------------------------------------------------------------------
import crypto from "crypto";
import { decrypt } from "@/lib/crypto";

const DEFAULT_TIMEOUT_MS = 15_000;
// Refresh comfortably before Minew's 24h expiry so a push never races the clock.
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

/** Overridable per store via settings.parameters.minewPaths. */
const DEFAULT_PATHS = {
  login: "/apis/action/login",
  storeList: "/apis/esl/store/list",
  storeAdd: "/apis/esl/store/add",
  updateGoods: "/apis/esl/goods/updateToStore",
  bind: "/apis/esl/label/update",
  labels: "/apis/esl/label/cascadQuery",
  gateways: "/apis/esl/gateway/listPage",
  led: "/apis/esl/label/led",
};

/**
 * Default field mapping: Minew field name -> (product) => value.
 * These match the SVS merchant's schema (price, specification, memberPrice,
 * origin, unit, Barcode). Any resolving to null/"" are dropped so we never trip
 * the code:5000 "undefined field" crash. Override per store with
 * parameters.minewFieldMap = { "minewFieldName": "productProperty" }.
 */
const DEFAULT_FIELD_MAP = {
  price: (p) => centsToStr(p.priceCents),
  memberPrice: (p) => centsToStr(p.memberPriceCents),
  specification: (p) => p.specification ?? p.name,
  unit: (p) => p.unit,
  origin: (p) => p.origin,
  Barcode: (p) => p.sku,
};

const LED_COLORS = { off: 0, blue: 1, green: 2, red: 3, yellow: 4, white: 5, magenta: 6, cyan: 7 };

/** Thrown by every call so the queue has one shape to inspect. */
export class MinewError extends Error {
  constructor(message, { retryable = false, status = null, body = null } = {}) {
    super(message);
    this.name = "MinewError";
    this.retryable = retryable;
    this.status = status;
    this.body = body;
  }
}

const md5 = (s) => crypto.createHash("md5").update(String(s)).digest("hex");
const centsToStr = (cents) => (cents == null ? undefined : (cents / 100).toFixed(2));

/** Strip whitespace and trailing slashes/backslashes a mis-pasted URL may carry. */
const cleanBaseUrl = (url) => String(url ?? "").trim().replace(/[\s\\/]+$/, "");

// ----------------------------------- config ----------------------------------

/**
 * Build a per-call config from a StoreSettings row. Returns null when the store
 * is not fully configured for CLOUD mode (callers then fall back to DEMO).
 */
export function configFromSettings(settings) {
  if (!settings || settings.mode !== "CLOUD") return null;
  const p = settings.parameters ?? {};
  const password = decrypt(settings.tokenCipher);
  const username = p.minewUsername;
  const storeId = p.minewStoreId;
  if (!settings.cloudUrl || !username || !password || !storeId) return null;
  return {
    baseUrl: cleanBaseUrl(settings.cloudUrl),
    username: username.trim(),
    password,
    storeId: String(storeId).trim(),
    paths: { ...DEFAULT_PATHS, ...(p.minewPaths ?? {}) },
    fieldMap: p.minewFieldMap ?? null,
    timeoutMs: p.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

// ------------------------------- token cache ---------------------------------
// In-process, keyed by base+user. The worker is long-lived, so this is enough;
// a multi-instance deploy simply logs in once per instance.
const tokenCache = new Map();
const cacheKey = (config) => `${config.baseUrl}|${config.username}`;

async function login(config) {
  const url = `${config.baseUrl}${config.paths.login}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), config.timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: ac.signal,
      headers: { "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify({ username: config.username, password: md5(config.password) }),
    });
  } catch (err) {
    throw new MinewError(
      err.name === "AbortError" ? "Login timed out" : `Login network error: ${err.message}`,
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
  }

  const parsed = await parseBody(res);
  if (!res.ok || Number(parsed?.code) !== 200) {
    throw new MinewError(`Login failed: ${parsed?.msg ?? `HTTP ${res.status}`}`, {
      retryable: retryableStatus(res.status),
      status: res.status,
      body: parsed,
    });
  }
  const token = parsed?.data?.token;
  if (!token) throw new MinewError("Login succeeded but no token returned", { body: parsed });

  tokenCache.set(cacheKey(config), { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

async function getToken(config, { force = false } = {}) {
  const hit = tokenCache.get(cacheKey(config));
  if (!force && hit && hit.expiresAt > Date.now()) return hit.token;
  return login(config);
}

// --------------------------------- request -----------------------------------

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

async function parseBody(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

/**
 * One authenticated call. `pathKey` indexes config.paths. Handles the `token`
 * header, the code:200 contract, and a single transparent re-login when the
 * backend reports an expired/invalid token (14002/14003).
 */
async function call(config, pathKey, { method = "POST", body, query, rawQuery, _retriedAuth = false } = {}) {
  const token = await getToken(config);
  // rawQuery is appended verbatim (e.g. eqstatus=1,2,8,9 — Minew wants literal
  // commas, which URLSearchParams would percent-encode and the backend ignores).
  const qs = rawQuery ? `?${rawQuery}` : query ? `?${new URLSearchParams(query).toString()}` : "";
  const url = `${config.baseUrl}${config.paths[pathKey]}${qs}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), config.timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      signal: ac.signal,
      headers: {
        token,
        ...(body ? { "Content-Type": "application/json;charset=utf-8" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw new MinewError(
      err.name === "AbortError" ? "Request timed out" : `Network error: ${err.message}`,
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
  }

  const parsed = await parseBody(res);

  if (!res.ok) {
    throw new MinewError(`HTTP ${res.status}: ${parsed?.msg ?? ""}`.trim(), {
      retryable: retryableStatus(res.status),
      status: res.status,
      body: parsed,
    });
  }

  const code = Number(parsed?.code);
  // Token expired/invalid: drop the cached token and retry the call once.
  if ((code === 14002 || code === 14003) && !_retriedAuth) {
    tokenCache.delete(cacheKey(config));
    await getToken(config, { force: true });
    return call(config, pathKey, { method, body, query, _retriedAuth: true });
  }

  if (code !== 200) {
    // Business errors (bad data, offline gateway, missing bind) will fail again
    // if replayed unchanged, so they are non-retryable by default.
    throw new MinewError(`API ${code}: ${parsed?.msg ?? "error"}`, {
      retryable: false,
      status: code,
      body: parsed,
    });
  }
  return parsed;
}

// -------------------------------- payloads -----------------------------------

/** Flatten a Frostline product into the merchant's Minew data fields. */
function buildGoodsPayload(config, product, goodsId) {
  const out = { id: goodsId, storeId: config.storeId };

  // Built-in defaults first.
  for (const [field, fn] of Object.entries(DEFAULT_FIELD_MAP)) {
    const v = fn(product);
    if (v != null && v !== "") out[field] = String(v);
  }
  // Operator overrides (minewField -> product property name) win.
  if (config.fieldMap && typeof config.fieldMap === "object") {
    for (const [field, prop] of Object.entries(config.fieldMap)) {
      const v = prop === "price" ? centsToStr(product.priceCents) : product[prop];
      if (v != null && v !== "") out[field] = String(v);
      else delete out[field]; // an explicit empty mapping clears the default
    }
  }
  return out;
}

// -------------------------------- operations ---------------------------------

/**
 * Push a product's data to its bound tag. In CLOUD mode this is updateToStore,
 * which auto-refreshes any tag already bound to `product.code`. Bind the tag
 * once (see bindLabel) before the first push, or in the Minew console.
 * @returns {Promise<{ok: true, detail: string, raw: any}>}
 * @throws  {MinewError} carrying a retryable flag for the queue
 */
export async function pushToLabel(settings, { label, product, template }) {
  const config = configFromSettings(settings);

  if (config) {
    if (!product) {
      throw new MinewError("Cloud push needs a product bound to the label", { retryable: false });
    }
    const goodsId = product.code;
    const raw = await call(config, "updateGoods", {
      body: buildGoodsPayload(config, product, goodsId),
    });
    return { ok: true, detail: `Cloud update accepted for goods ${goodsId}`, raw };
  }

  if (settings?.mode === "GATEWAY") {
    throw new MinewError("Gateway mode requires the Minew SDK (not wired)", { retryable: false });
  }
  if (settings?.mode === "CLOUD") {
    throw new MinewError(
      "Cloud mode selected but cloud URL, username, password, or Minew store id is missing",
      { retryable: false },
    );
  }

  // DEMO — mimic the tag's fast-broadcast latency so queue/UI/stats stay honest.
  await new Promise((r) => setTimeout(r, 600));
  return { ok: true, detail: "Demo push (no API configured)", raw: null };
}

/**
 * Bind a tag to a data record and a template (one-time setup). After this,
 * pushToLabel/updateToStore auto-refreshes the tag.
 * @param demoId  Minew template id (from template.findAll)
 * @param side    "A" (front) or "B" (back)
 */
export async function bindLabel(settings, { mac, goodsId, demoId, side = "A" }) {
  const config = configFromSettings(settings);
  if (!config) {
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true, detail: "Demo bind (no API configured)" };
  }
  const raw = await call(config, "bind", {
    body: { labelMac: mac, goodsId, storeId: config.storeId, demoIdMap: { [side]: demoId } },
  });
  return { ok: true, detail: `Bound ${mac} -> goods ${goodsId}`, raw };
}

/** Flash a tag's RGB light — used by Store Data → LED Config. */
export async function flashLed(settings, { mac, color = "red", seconds = 5 }) {
  const config = configFromSettings(settings);
  if (!config) {
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true, detail: "Demo LED flash" };
  }
  const raw = await call(config, "led", {
    method: "GET",
    query: {
      mac,
      storeId: config.storeId,
      color: String(LED_COLORS[color] ?? 3),
      total: String(seconds),
      period: "500",
      interval: "900",
      brightness: "100",
    },
  });
  return { ok: true, detail: "LED command accepted", raw };
}

/** Poll the vendor for tag state — drives status + battery reconciliation. */
export async function fetchLabelStates(settings) {
  const config = configFromSettings(settings);
  if (!config) return null;
  const raw = await call(config, "labels", {
    method: "GET",
    rawQuery: `page=1&size=500&storeId=${encodeURIComponent(config.storeId)}&eqstatus=1,2,8,9&type=1`,
  });
  return raw?.items ?? [];
}

export async function fetchGatewayStates(settings) {
  const config = configFromSettings(settings);
  if (!config) return null;
  const raw = await call(config, "gateways", {
    method: "GET",
    query: { page: "1", size: "100", storeId: config.storeId },
  });
  return raw?.items ?? [];
}

/** Connectivity check for the Integration settings panel: can we get a token? */
export async function testConnection(settings) {
  const config = configFromSettings(settings);
  if (!config) {
    return { ok: false, detail: "Cloud URL, username, password, and Minew store id are required" };
  }
  try {
    await getToken(config, { force: true });
    return { ok: true, detail: "Connected — Minew token acquired" };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

// ============================ account-level client ===========================
// Minew stores/gateways/tags all live under ONE merchant account. These read
// the merchant credentials from the environment so Frostline can list every
// Minew store (and add stores) without being scoped to a single Frostline store.
//
//   MINEW_URL       API base (default https://esl.smartvisionss.com:9443)
//   MINEW_USERNAME  merchant login
//   MINEW_PASSWORD  merchant password (plain; MD5'd at login)

/** Build an account config from env, or null when credentials are absent. */
export function accountConfig() {
  const username = process.env.MINEW_USERNAME;
  const password = process.env.MINEW_PASSWORD;
  if (!username || !password) return null;
  return {
    baseUrl: cleanBaseUrl(process.env.MINEW_URL ?? "https://esl.smartvisionss.com:9443"),
    username: username.trim(),
    password,
    paths: { ...DEFAULT_PATHS },
    timeoutMs: Number(process.env.MINEW_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  };
}

export function hasAccountConfig() {
  return accountConfig() != null;
}

/** All stores under the merchant. `active` 1=open, 0=closed, undefined=open. */
export async function listStores(config, { active = 1 } = {}) {
  const raw = await call(config, "storeList", { method: "GET", query: { active: String(active) } });
  return (raw?.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    number: s.number ?? null,
    address: s.address ?? null,
    active: Number(s.active) === 1,
    serverIp: s.serverIp ?? null,
    createTime: s.createTime ?? null,
  }));
}

/** Create a Minew store. Returns { storeId }. */
export async function addStore(config, { number, name, address }) {
  const raw = await call(config, "storeAdd", { body: { number, name, address } });
  return { storeId: raw?.data?.storeId ?? null };
}

/** Gateways for a given Minew store id, normalized. */
export async function listGatewaysFor(config, minewStoreId) {
  const raw = await call(config, "gateways", {
    method: "GET",
    query: { page: "1", size: "200", storeId: minewStoreId },
  });
  return (raw?.items ?? []).map((g) => ({
    mac: (g.mac ?? "").toUpperCase(),
    name: g.name ?? g.mac ?? null,
    online: Number(g.mode) === 1,
    model: g.subModel ?? g.model ?? null,
    ip: g.ip ?? null,
    wifiFirmware: g.wifiVersion ?? null,
    bleFirmware: g.bleVersion ?? null,
    lastSeenAt: g.updateTime ?? null,
  }));
}

/** Tags for a given Minew store id, normalized. */
export async function listTagsFor(config, minewStoreId) {
  const raw = await call(config, "labels", {
    method: "GET",
    rawQuery: `page=1&size=500&storeId=${encodeURIComponent(minewStoreId)}&eqstatus=1,2,8,9&type=1`,
  });
  return (raw?.items ?? []).map((t) => ({
    mac: (t.mac ?? "").toLowerCase(),
    online: String(t.isOnline) === "2",
    battery: t.battery ?? null,
    rssi: t.rssi ?? null,
    sizeInches: t.screenInfo?.inch ?? null,
    color: t.screenInfo?.color ?? null,
    goodsId: t.goodsId ?? null,
    firmware: t.firmware ?? null,
    lastUpdate: t.lastupdate ?? t.updateTime ?? null,
  }));
}
