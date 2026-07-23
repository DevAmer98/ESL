// -----------------------------------------------------------------------------
// lib/render/svg.js — layout + context → an SVG string.
//
// Dependency-free on purpose: this runs in the request path for previews and in
// the push worker for the image we hand the gateway, and both want a pure
// string with no headless browser and no native canvas.
//
// The load-bearing behaviour here is palette clamping. An e-paper panel has a
// fixed set of cartridges; asking a BW panel for red does not produce red, it
// produces whatever the driver decides — usually a muddy dither or nothing.
// Rendering a colour the hardware cannot lay down means the preview and the
// shelf disagree, which is the one thing a preview exists to prevent. So every
// colour is snapped to the template's own palette before it is drawn.
// -----------------------------------------------------------------------------
import { PALETTE, INK_HEX, parseLayout } from "@/lib/render/schema";
import { resolve } from "@/lib/render/context";

// --------------------------------- escaping ----------------------------------

/**
 * Product names come from CSV imports and vendor feeds. `&`, `<` and quotes all
 * appear in real catalogues ("Ben & Jerry's 500ml"), so every value that
 * reaches the document — text nodes and attributes alike — goes through here.
 */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// --------------------------------- palette -----------------------------------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Snap an ink name to the nearest ink the panel actually has, by squared RGB
 * distance. Nearest-colour rather than "everything unknown becomes black" so a
 * yellow accent on a BWR panel degrades to red instead of disappearing into the
 * text — but red on a BW panel still lands on black, which is what the driver
 * would have done anyway.
 *
 * White is excluded as a substitute: yellow is nearer white than black by raw
 * distance, but clamping an author's yellow price to the background ink deletes
 * it from the label. Only an explicit `white` stays white.
 */
export function clampColor(name, colorMode) {
  const allowed = PALETTE[colorMode] ?? PALETTE.BW;
  if (!name) return null;
  if (allowed.includes(name)) return name;

  const target = INK_HEX[name];
  if (!target) return "black";

  const candidates = allowed.filter((c) => c !== "white");
  if (!candidates.length) return allowed[0];

  const [r, g, b] = hexToRgb(target);
  let best = candidates[0];
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const [cr, cg, cb] = hexToRgb(INK_HEX[candidate]);
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/** Clamped ink as a hex string ready for a `fill=`/`stroke=` attribute. */
function ink(name, colorMode) {
  const clamped = clampColor(name, colorMode);
  return clamped ? INK_HEX[clamped] : null;
}

// --------------------------------- barcode -----------------------------------

/**
 * Generalised from the hardcoded preview renderer in app/page.jsx. This is a
 * deterministic *representation* of the value, not a spec-conformant symbology
 * encoding — the gateway firmware encodes the real symbol from the value we
 * send it. Determinism is what matters here: the same SKU must always draw the
 * same bars, or every preview looks like a pending change.
 */
export function barsFromValue(value, barCount = 42) {
  let seed = 7;
  for (const ch of String(value || "0")) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;

  const bars = [];
  let x = 0;
  for (let i = 0; i < barCount; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const w = 1 + (seed % 3);
    if (i % 2 === 0) bars.push([x, w]);
    x += w;
  }
  return { bars, total: x || 1 };
}

/**
 * Same caveat as the barcode: a deterministic module matrix with correct finder
 * patterns, sized like a real symbol so layout decisions made against a preview
 * hold on the panel. Not a scannable encoding.
 */
function qrModules(value, size = 25) {
  let seed = 11;
  for (const ch of String(value || "0")) seed = (seed * 131 + ch.charCodeAt(0)) >>> 0;

  const grid = Array.from({ length: size }, () => new Array(size).fill(false));
  const inFinder = (r, c) =>
    (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (inFinder(r, c)) continue;
      seed = (seed * 1103515245 + 12345) >>> 0;
      grid[r][c] = ((seed >>> 16) & 1) === 1;
    }
  }

  // The three position-detection squares, drawn at their true proportions.
  const finder = (r0, c0) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const edge = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[r0 + r][c0 + c] = edge || core;
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  return grid;
}

// ---------------------------------- text -------------------------------------

/** Rough advance width. Enough to decide line breaks; nothing depends on exactness. */
const AVG_CHAR_RATIO = 0.55;

function wrap(text, widthPx, fontSize, maxLines) {
  if (maxLines <= 1) return [text];
  const perLine = Math.max(1, Math.floor(widthPx / (fontSize * AVG_CHAR_RATIO)));

  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= perLine || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

const ANCHOR = { left: "start", center: "middle", right: "end" };

// -------------------------------- elements -----------------------------------

/** Value for an element: binding first, literal `text` as the fallback. */
function valueOf(el, context) {
  if (el.binding) {
    const bound = resolve(el.binding, context);
    if (bound !== "") return bound;
  }
  return el.text ?? "";
}

/** Rotate an element about its own centre, so `x`/`y` stay the design anchor. */
function rotation(el) {
  if (!el.rotate) return "";
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  return ` transform="rotate(${round(el.rotate)} ${round(cx)} ${round(cy)})"`;
}

const round = (n) => Math.round(Number(n) * 100) / 100;

function renderText(el, context, mode) {
  const fill = ink(el.color, mode) ?? INK_HEX.black;
  const value = valueOf(el, context);
  if (!value) return "";

  const lines = wrap(value, el.w, el.fontSize, el.maxLines);
  const lineHeight = el.fontSize * 1.15;
  const anchor = ANCHOR[el.align] ?? "start";
  const x = el.align === "center" ? el.x + el.w / 2 : el.align === "right" ? el.x + el.w : el.x;

  // Baseline of the first line: vertically centre the block inside the box.
  const blockHeight = lines.length * lineHeight;
  const first = el.y + (el.h - blockHeight) / 2 + el.fontSize * 0.85;

  const tspans = lines
    .map((line, i) => `<tspan x="${round(x)}" y="${round(first + i * lineHeight)}">${esc(line)}</tspan>`)
    .join("");

  return (
    `<text font-family="ui-sans-serif, system-ui, sans-serif" font-size="${round(el.fontSize)}"` +
    ` font-weight="${el.fontWeight}" fill="${fill}" text-anchor="${anchor}"${rotation(el)}>` +
    `${tspans}</text>`
  );
}

function renderBarcode(el, context, mode) {
  const fill = ink(el.color, mode) ?? INK_HEX.black;
  const value = valueOf(el, context);
  if (!value) return "";

  const captionH = el.showText ? Math.min(14, el.h * 0.3) : 0;
  const barsH = Math.max(1, el.h - captionH);
  const { bars, total } = barsFromValue(value);

  const rects = bars
    .map(([bx, bw]) => {
      const x = el.x + (bx / total) * el.w;
      const w = Math.max(1, (bw / total) * el.w);
      return `<rect x="${round(x)}" y="${round(el.y)}" width="${round(w)}" height="${round(barsH)}" fill="${fill}"/>`;
    })
    .join("");

  const caption = el.showText
    ? `<text x="${round(el.x + el.w / 2)}" y="${round(el.y + el.h - 1)}" text-anchor="middle"` +
      ` font-family="ui-monospace, monospace" font-size="${round(Math.max(6, captionH * 0.8))}"` +
      ` fill="${fill}">${esc(value)}</text>`
    : "";

  return `<g${rotation(el)}>${rects}${caption}</g>`;
}

function renderQrcode(el, context, mode) {
  const fill = ink(el.color, mode) ?? INK_HEX.black;
  const value = valueOf(el, context);
  if (!value) return "";

  const side = Math.min(el.w, el.h);
  const modules = qrModules(value);
  const step = side / modules.length;
  const x0 = el.x + (el.w - side) / 2;
  const y0 = el.y + (el.h - side) / 2;

  let out = "";
  for (let r = 0; r < modules.length; r++) {
    for (let c = 0; c < modules.length; c++) {
      if (!modules[r][c]) continue;
      out +=
        `<rect x="${round(x0 + c * step)}" y="${round(y0 + r * step)}"` +
        ` width="${round(step)}" height="${round(step)}" fill="${fill}"/>`;
    }
  }
  return `<g${rotation(el)}>${out}</g>`;
}

function renderImage(el, mode) {
  // Assets resolve to a served URL; the id form is the stable one because the
  // storage key can move underneath us.
  const href = el.src ?? `/api/media/${el.assetId}`;
  const preserve =
    el.fit === "fill" ? "none" : el.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet";

  return (
    `<image href="${esc(href)}" x="${round(el.x)}" y="${round(el.y)}"` +
    ` width="${round(el.w)}" height="${round(el.h)}"` +
    ` preserveAspectRatio="${preserve}"${rotation(el)}/>`
  );
}

function renderRect(el, mode) {
  const fill = ink(el.fill, mode);
  const stroke = ink(el.stroke, mode);
  if (!fill && !stroke) return "";

  return (
    `<rect x="${round(el.x)}" y="${round(el.y)}" width="${round(el.w)}" height="${round(el.h)}"` +
    (el.radius ? ` rx="${round(el.radius)}"` : "") +
    ` fill="${fill ?? "none"}"` +
    (stroke ? ` stroke="${stroke}" stroke-width="${round(el.thickness)}"` : "") +
    `${rotation(el)}/>`
  );
}

function renderLine(el, mode) {
  const stroke = ink(el.stroke, mode) ?? INK_HEX.black;
  // A zero-height box means a horizontal rule; zero-width means a vertical one.
  return (
    `<line x1="${round(el.x)}" y1="${round(el.y)}" x2="${round(el.x + el.w)}"` +
    ` y2="${round(el.y + el.h)}" stroke="${stroke}" stroke-width="${round(el.thickness)}"` +
    ` stroke-linecap="square"${rotation(el)}/>`
  );
}

// --------------------------------- render ------------------------------------

const RENDERERS = {
  text: (el, ctx, mode) => renderText(el, ctx, mode),
  barcode: (el, ctx, mode) => renderBarcode(el, ctx, mode),
  qrcode: (el, ctx, mode) => renderQrcode(el, ctx, mode),
  image: (el, _ctx, mode) => renderImage(el, mode),
  rect: (el, _ctx, mode) => renderRect(el, mode),
  line: (el, _ctx, mode) => renderLine(el, mode),
};

/**
 * Panel rotation, applied to the whole design. The SVG is always emitted at the
 * panel's true pixel dimensions — a 296x128 template is a 296x128 image no
 * matter how it is mounted — so at 90/270 the design coordinate space is the
 * transposed one and the transform maps it back onto the panel.
 */
function panelTransform(rotation, w, h) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { transform: `translate(${w} 0) rotate(90)`, designW: h, designH: w };
    case 180:
      return { transform: `translate(${w} ${h}) rotate(180)`, designW: w, designH: h };
    case 270:
      return { transform: `translate(0 ${h}) rotate(270)`, designW: h, designH: w };
    default:
      return { transform: null, designW: w, designH: h };
  }
}

/**
 * Render a template against a context.
 *
 * @param template a Template row (or any object with widthPx/heightPx/colorMode/
 *                 rotation/layout)
 * @param context  output of buildContext()
 * @returns SVG document as a string
 */
export function renderSvg(template, context = {}) {
  const w = Number(template?.widthPx) || 0;
  const h = Number(template?.heightPx) || 0;
  if (!w || !h) throw new Error("Template has no pixel dimensions");

  const mode = PALETTE[template?.colorMode] ? template.colorMode : "BW";
  const layout = parseLayout(template?.layout);
  const { transform, designW, designH } = panelTransform(template?.rotation ?? 0, w, h);

  const background = ink(layout.background, mode) ?? INK_HEX.white;

  const elements = layout.elements
    .map((el) => RENDERERS[el.type]?.(el, context, mode) ?? "")
    .join("");

  const inner = transform ? `<g transform="${transform}">${elements}</g>` : elements;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"` +
    ` viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${background}"/>` +
    `${inner}</svg>`
  );
}

/** Dimensions the design grid should use for this template, honouring rotation. */
export function designSize(template) {
  const { designW, designH } = panelTransform(
    template?.rotation ?? 0,
    Number(template?.widthPx) || 0,
    Number(template?.heightPx) || 0,
  );
  return { width: designW, height: designH };
}
