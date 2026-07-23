// -----------------------------------------------------------------------------
// lib/render/schema.js — the canonical shape of a template layout.
//
// The layout is stored as JSON in Template.layout, so it is the one part of the
// system with no database-level guarantees. Everything that reads a layout
// (renderer, editor, push payload builder) parses it through here first, which
// means a hand-edited or legacy row fails loudly at one place instead of
// producing a subtly wrong label on a shelf.
//
// The device tables below are the physical truth about the panels we ship: a
// template whose pixel size or ink set does not match a real panel cannot be
// rendered faithfully, so both are validated against these lists.
// -----------------------------------------------------------------------------
import { z } from "zod";

/**
 * The ink a panel can physically lay down. Anything else must be clamped to the
 * nearest member before it reaches the renderer — see lib/render/svg.js.
 */
export const PALETTE = {
  BW: ["black", "white"],
  BWR: ["black", "white", "red"],
  BWRY: ["black", "white", "red", "yellow"],
  SEVEN_COLOR: ["black", "white", "red", "yellow", "blue", "green", "orange"],
};

/** Named ink → the sRGB value we draw with. Approximations of the real dyes. */
export const INK_HEX = {
  black: "#000000",
  white: "#ffffff",
  red: "#d0021b",
  yellow: "#f5c518",
  blue: "#1d4ed8",
  green: "#15803d",
  orange: "#ea7317",
};

/**
 * Real panel sizes. `sizeInches` is the diagonal as printed on the datasheet
 * and is what the label reports, so it doubles as the join key between a Label
 * and the templates that will fit it.
 */
export const DEVICE_PRESETS = [
  {
    sizeInches: 2.13,
    label: '2.13"',
    widthPx: 250,
    heightPx: 122,
    colorModes: ["BW", "BWR"],
  },
  {
    sizeInches: 2.66,
    label: '2.66"',
    widthPx: 296,
    heightPx: 152,
    colorModes: ["BW", "BWR", "BWRY"],
  },
  {
    sizeInches: 2.9,
    label: '2.9"',
    widthPx: 296,
    heightPx: 128,
    colorModes: ["BW", "BWR", "BWRY"],
  },
  {
    sizeInches: 3.5,
    label: '3.5"',
    widthPx: 384,
    heightPx: 184,
    colorModes: ["BW", "BWR", "BWRY"],
  },
  {
    sizeInches: 7.3,
    label: '7.3"',
    widthPx: 800,
    heightPx: 480,
    colorModes: ["BW", "BWR", "BWRY", "SEVEN_COLOR"],
  },
  {
    sizeInches: 11.6,
    label: '11.6"',
    widthPx: 960,
    heightPx: 640,
    colorModes: ["BW", "BWR", "SEVEN_COLOR"],
  },
];

/** Prisma hands back `sizeInches` as a Decimal; compare on the number. */
export function findPreset(sizeInches) {
  const n = Number(sizeInches);
  return DEVICE_PRESETS.find((p) => p.sizeInches === n) ?? null;
}

export const COLOR_MODES = ["BW", "BWR", "BWRY", "SEVEN_COLOR"];
export const TEMPLATE_KINDS = ["LABEL", "STORE"];

// ------------------------------- elements -----------------------------------

/**
 * A dotted path into the render context ("product.name"). Kept deliberately
 * narrow: only word characters and dots, so a binding can never be used to walk
 * into a prototype or index an array with a crafted key.
 */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const binding = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/, "Invalid binding path")
  .max(120)
  .refine((p) => !p.split(".").some((k) => DANGEROUS_KEYS.has(k)), {
    message: "Binding path may not traverse the prototype chain",
  });

/**
 * Colours are named inks, not free-form CSS. The panel only has so many
 * cartridges, and a name is what we can meaningfully clamp against a palette.
 */
const ink = z.enum(Object.keys(INK_HEX));

const base = {
  id: z.string().min(1).max(64),
  x: z.number(),
  y: z.number(),
  w: z.number().min(0),
  h: z.number().min(0),
};

const textElement = z.object({
  ...base,
  type: z.literal("text"),
  binding: binding.optional(),
  text: z.string().max(2000).optional(),
  fontSize: z.number().min(1).max(400).default(16),
  fontWeight: z.number().int().min(100).max(900).default(400),
  align: z.enum(["left", "center", "right"]).default("left"),
  color: ink.default("black"),
  rotate: z.number().min(-360).max(360).default(0),
  maxLines: z.number().int().min(1).max(12).default(1),
});

const barcodeElement = z.object({
  ...base,
  type: z.literal("barcode"),
  binding: binding.optional(),
  text: z.string().max(200).optional(),
  symbology: z.enum(["CODE128", "EAN13", "UPCA", "CODE39"]).default("CODE128"),
  showText: z.boolean().default(true),
  color: ink.default("black"),
  rotate: z.number().min(-360).max(360).default(0),
});

const qrcodeElement = z.object({
  ...base,
  type: z.literal("qrcode"),
  binding: binding.optional(),
  text: z.string().max(2000).optional(),
  color: ink.default("black"),
  rotate: z.number().min(-360).max(360).default(0),
});

const imageElement = z
  .object({
    ...base,
    type: z.literal("image"),
    assetId: z.string().min(1).max(64).optional(),
    src: z.string().max(2000).optional(),
    fit: z.enum(["contain", "cover", "fill"]).default("contain"),
    rotate: z.number().min(-360).max(360).default(0),
  })
  .refine((el) => Boolean(el.assetId || el.src), {
    message: "image requires assetId or src",
  });

const rectElement = z.object({
  ...base,
  type: z.literal("rect"),
  fill: ink.nullable().default(null),
  stroke: ink.nullable().default(null),
  thickness: z.number().min(0).max(40).default(1),
  radius: z.number().min(0).max(200).default(0),
  rotate: z.number().min(-360).max(360).default(0),
});

const lineElement = z.object({
  ...base,
  type: z.literal("line"),
  stroke: ink.default("black"),
  thickness: z.number().min(0.5).max(40).default(1),
  rotate: z.number().min(-360).max(360).default(0),
});

export const elementSchema = z.discriminatedUnion("type", [
  textElement,
  barcodeElement,
  qrcodeElement,
  imageElement,
  rectElement,
  lineElement,
]);

export const layoutSchema = z.object({
  elements: z.array(elementSchema).max(200).default([]),
  background: ink.default("white"),
});

/**
 * Parse a layout that came out of the database. Legacy rows predate some
 * defaults, so this tolerates `undefined` and empty objects rather than
 * throwing and blanking a shelf.
 */
export function parseLayout(raw) {
  return layoutSchema.parse(raw ?? { elements: [] });
}
