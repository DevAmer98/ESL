// -----------------------------------------------------------------------------
// lib/minew.js — THE ONLY HARDWARE-FACING MODULE.
//
// Everything else in the backend is CRUD; this is the boundary where we talk to
// MinewTag ESL Cloud. Three things matter here and nowhere else:
//
//   1. The API token never leaves the server (it is decrypted per call).
//   2. Every failure is classified retryable / permanent, because the push queue
//      decides whether to back off or give up based on that answer alone.
//   3. Endpoint paths are configuration, not code — self-hosted ESL Cloud
//      deployments differ by version, so they are overridable per store.
//
// >>> To finish wiring: set the store's Integration mode to CLOUD, its cloud URL
// >>> and token, then confirm the four paths in DEFAULT_PATHS against your
// >>> deployment's API docs. Nothing else in the app needs to change.
// -----------------------------------------------------------------------------
import { decrypt } from "@/lib/crypto";

const DEFAULT_TIMEOUT_MS = 15_000;

/** Overridable per store via settings.parameters.minewPaths. */
const DEFAULT_PATHS = {
  refresh: "/apis/esl/label/refresh",
  labels: "/apis/esl/label/list",
  gateways: "/apis/esl/gateway/list",
  led: "/apis/esl/label/led",
};

/** Thrown by every call in this module so the queue has one shape to inspect. */
export class MinewError extends Error {
  constructor(message, { retryable = false, status = null, body = null } = {}) {
    super(message);
    this.name = "MinewError";
    this.retryable = retryable;
    this.status = status;
    this.body = body;
  }
}

/**
 * HTTP status → retry decision. 408/429 and 5xx are transient; other 4xx means
 * we sent something the vendor will reject again no matter how often we ask.
 */
function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

async function call(config, pathKey, payload) {
  const paths = { ...DEFAULT_PATHS, ...(config.paths ?? {}) };
  const url = `${config.cloudUrl.replace(/\/+$/, "")}${paths[pathKey]}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: ac.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Connection refused, DNS, TLS, or our own timeout — all worth retrying.
    const timedOut = err.name === "AbortError";
    throw new MinewError(timedOut ? "Request timed out" : `Network error: ${err.message}`, {
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body — keep the raw text for the error detail */
  }

  if (!res.ok) {
    throw new MinewError(`HTTP ${res.status}: ${parsed?.message ?? text.slice(0, 200)}`, {
      retryable: retryableStatus(res.status),
      status: res.status,
      body: parsed ?? text.slice(0, 500),
    });
  }

  // ESL Cloud returns 200 with an application-level code on business failures.
  if (parsed && parsed.code != null && Number(parsed.code) !== 0) {
    throw new MinewError(parsed.message ?? `API code ${parsed.code}`, {
      retryable: false,
      body: parsed,
    });
  }

  return parsed;
}

/**
 * Build per-call config from a StoreSettings row, decrypting the token.
 * Returns null when the store is not usable in cloud mode.
 */
export function configFromSettings(settings) {
  if (!settings || settings.mode !== "CLOUD") return null;
  const token = decrypt(settings.tokenCipher);
  if (!settings.cloudUrl || !token) return null;
  return {
    cloudUrl: settings.cloudUrl,
    token,
    paths: settings.parameters?.minewPaths,
    timeoutMs: settings.parameters?.timeoutMs,
  };
}

/** Flatten a label + its bound product into the vendor's data payload. */
function renderPayload(label, product, template) {
  return {
    mac: label.mac,
    templateId: template?.id ?? null,
    templateName: template?.name ?? null,
    data: {
      code: product?.code ?? null,
      name: product?.name ?? null,
      specification: product?.specification ?? null,
      unit: product?.unit ?? null,
      price: ((product?.priceCents ?? 0) / 100).toFixed(2),
      memberPrice:
        product?.memberPriceCents != null
          ? (product.memberPriceCents / 100).toFixed(2)
          : null,
      brand: product?.brand ?? null,
      weight: product?.weight ?? null,
      origin: product?.origin ?? null,
      barcode: product?.sku ?? null,
      ...(product?.attributes ?? {}),
    },
  };
}

/**
 * Push a rendered label to a physical tag.
 * @returns {Promise<{ok: true, detail: string, raw: any}>}
 * @throws  {MinewError} carrying a retryable flag for the queue
 */
export async function pushToLabel(settings, { label, product, template }) {
  const config = configFromSettings(settings);

  if (config) {
    const raw = await call(config, "refresh", renderPayload(label, product, template));
    return { ok: true, detail: "Cloud refresh accepted", raw };
  }

  if (settings?.mode === "GATEWAY") {
    // The e-ink downlink protocol is proprietary; direct-to-gateway needs
    // Minew's SDK. Permanent by design — retrying cannot help.
    throw new MinewError("Gateway mode requires the Minew SDK (not wired)", {
      retryable: false,
    });
  }

  if (settings?.mode === "CLOUD") {
    throw new MinewError("Cloud mode selected but URL or token is missing", {
      retryable: false,
    });
  }

  // DEMO — no credentials configured. Mimics the tag's fast-broadcast latency
  // so the queue, the UI states and the statistics all exercise real timings.
  await new Promise((r) => setTimeout(r, 600));
  return { ok: true, detail: "Demo push (no API configured)", raw: null };
}

/** Flash a label's LED — used by Store Data → LED Config. */
export async function flashLed(settings, { mac, color = "red", seconds = 5 }) {
  const config = configFromSettings(settings);
  if (!config) {
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true, detail: "Demo LED flash" };
  }
  const raw = await call(config, "led", { mac, color, duration: seconds });
  return { ok: true, detail: "LED command accepted", raw };
}

/** Poll the vendor for device state — drives status + battery reconciliation. */
export async function fetchLabelStates(settings) {
  const config = configFromSettings(settings);
  if (!config) return null;
  return call(config, "labels", {});
}

export async function fetchGatewayStates(settings) {
  const config = configFromSettings(settings);
  if (!config) return null;
  return call(config, "gateways", {});
}

/** Connectivity check for the Integration settings panel. */
export async function testConnection(settings) {
  const config = configFromSettings(settings);
  if (!config) return { ok: false, detail: "Cloud URL and token are required" };
  try {
    await call(config, "gateways", {});
    return { ok: true, detail: "Connected" };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}
