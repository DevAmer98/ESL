// -----------------------------------------------------------------------------
// lib/render/context.js — the flat world a template's bindings resolve against.
//
// Bindings are authored by hand in the template editor, so the context has to
// be forgiving: an unbound label, a product without a SKU, a store with no
// currency all have to render *something* rather than throw. Every miss
// resolves to "" and the label simply shows a gap.
//
// Money arrives as integer minor units and leaves as a display string. That
// conversion happens here and nowhere else — the renderer never sees cents.
// -----------------------------------------------------------------------------

/** Minor units per major unit. Everything we ship is 2 except the JPY family. */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "XOF", "XAF"]);
const THREE_DECIMAL = new Set(["KWD", "BHD", "OMR", "JOD", "TND"]);

function decimalsFor(currency) {
  if (ZERO_DECIMAL.has(currency)) return 0;
  if (THREE_DECIMAL.has(currency)) return 3;
  return 2;
}

/**
 * Format integer minor units for display. Intl gives us the right symbol and
 * separators per currency; if the currency code is junk we fall back to the
 * bare number rather than blowing up a render.
 */
export function formatMoney(minorUnits, currency = "USD", locale = "en-US") {
  if (minorUnits == null || Number.isNaN(Number(minorUnits))) return "";
  const decimals = decimalsFor(currency);
  const major = Number(minorUnits) / 10 ** decimals;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(major);
  } catch {
    return major.toFixed(decimals);
  }
}

/** The integer and fractional halves, for templates that style them apart. */
function moneyParts(minorUnits, currency) {
  if (minorUnits == null) return { major: "", minor: "" };
  const decimals = decimalsFor(currency);
  const abs = Math.abs(Number(minorUnits));
  const div = 10 ** decimals;
  return {
    major: String(Math.floor(abs / div)),
    minor: decimals ? String(abs % div).padStart(decimals, "0") : "",
  };
}

function str(v) {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Build the binding context for one render.
 *
 * Anything may be null — previews routinely have no label and no product — and
 * the shape stays identical either way so a template never has to branch.
 */
export function buildContext({ label, product, store, template } = {}) {
  const currency = store?.currency || "USD";
  const price = product?.priceCents ?? null;
  const memberPrice = product?.memberPriceCents ?? null;
  const parts = moneyParts(price, currency);

  return {
    product: {
      id: str(product?.id),
      code: str(product?.code),
      name: str(product?.name),
      specification: str(product?.specification),
      unit: str(product?.unit),
      brand: str(product?.brand),
      weight: str(product?.weight),
      origin: str(product?.origin),
      sku: str(product?.sku),
      glyph: str(product?.glyph),
      price: formatMoney(price, currency),
      priceMajor: parts.major,
      priceMinor: parts.minor,
      priceCents: price == null ? "" : String(price),
      memberPrice: memberPrice == null ? "" : formatMoney(memberPrice, currency),
      // Tenant-defined extra columns are addressable as product.attributes.foo.
      attributes: product?.attributes ?? {},
    },
    label: {
      id: str(label?.id),
      mac: str(label?.mac),
      model: str(label?.model),
      battery: label?.battery == null ? "" : `${label.battery}%`,
      status: str(label?.status),
      sizeInches: str(label?.sizeInches),
      lastUpdateAt: str(label?.lastUpdateAt),
    },
    store: {
      id: str(store?.id),
      name: str(store?.name),
      currency,
      timezone: str(store?.timezone),
    },
    template: {
      id: str(template?.id),
      name: str(template?.name),
      kind: str(template?.kind),
      sizeInches: str(template?.sizeInches),
      colorMode: str(template?.colorMode),
    },
    now: new Date().toISOString(),
  };
}

/**
 * Walk a dotted path and stringify what's there. Missing anywhere along the
 * path is "" — a template that references a field a product does not have is a
 * blank, never an exception mid-render.
 */
export function resolve(path, context) {
  if (!path || typeof path !== "string") return "";
  let cur = context;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return "";
    // Own properties only; a binding must not be able to reach the prototype.
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return "";
    cur = cur[key];
  }
  if (cur == null) return "";
  if (typeof cur === "object") return "";
  return String(cur);
}

/**
 * Stand-in data for previewing a template that is not bound to anything. Chosen
 * to be representative rather than short — a name that fits everywhere hides
 * the overflow bugs a preview exists to catch.
 */
export function placeholderContext({ store, template } = {}) {
  return buildContext({
    store,
    template,
    product: {
      id: "preview",
      code: "10081",
      name: "Organic Whole Milk 2L",
      specification: "2 L carton",
      unit: "ea",
      brand: "Meadowfield",
      weight: "2.06 kg",
      origin: "Netherlands",
      sku: "5901234123457",
      glyph: "🥛",
      priceCents: 1899,
      memberPriceCents: 1649,
      attributes: {},
    },
    label: {
      id: "preview",
      mac: "AC233FA1B2C3",
      model: "DS026F",
      battery: 92,
      status: "ONLINE",
      sizeInches: template?.sizeInches ?? null,
      lastUpdateAt: null,
    },
  });
}
