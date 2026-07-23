// -----------------------------------------------------------------------------
// lib/schemas/template.js — request shapes for the template endpoints.
//
// The interesting validation is not per-field, it is the triple
// (sizeInches, widthPx, heightPx, colorMode). A template whose pixels don't
// match a real panel renders fine in the browser and lands cropped or stretched
// on the shelf, and a colour mode the panel doesn't have degrades silently. Both
// are cheap to reject here and expensive to notice in a store.
// -----------------------------------------------------------------------------
import { z } from "zod";
import { COLOR_MODES, TEMPLATE_KINDS, DEVICE_PRESETS, findPreset, layoutSchema } from "@/lib/render/schema";

const name = z.string().trim().min(1).max(120);
const rotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);

/**
 * Cross-field check, shared by create and update. Update calls it against the
 * stored row merged with the patch, because a PATCH that only moves colorMode
 * still has to be legal for the size already on the record.
 */
export function validateDevice({ sizeInches, widthPx, heightPx, colorMode }, ctx) {
  const preset = findPreset(sizeInches);
  if (!preset) {
    ctx.addIssue({
      code: "custom",
      path: ["sizeInches"],
      message: `Unknown panel size ${sizeInches}"`,
      params: { sizes: DEVICE_PRESETS.map((p) => p.sizeInches) },
    });
    return;
  }
  if (widthPx !== preset.widthPx || heightPx !== preset.heightPx) {
    ctx.addIssue({
      code: "custom",
      path: ["widthPx"],
      message: `A ${preset.label} panel is ${preset.widthPx}x${preset.heightPx}px, not ${widthPx}x${heightPx}px`,
    });
  }
  if (!preset.colorModes.includes(colorMode)) {
    ctx.addIssue({
      code: "custom",
      path: ["colorMode"],
      message: `A ${preset.label} panel does not support ${colorMode}`,
      params: { supported: preset.colorModes },
    });
  }
}

export const templateCreateSchema = z
  .object({
    name,
    kind: z.enum(TEMPLATE_KINDS).default("LABEL"),
    sizeInches: z.coerce.number().positive(),
    widthPx: z.coerce.number().int().positive(),
    heightPx: z.coerce.number().int().positive(),
    colorMode: z.enum(COLOR_MODES).default("BW"),
    rotation: rotation.default(0),
    layout: layoutSchema.default({ elements: [], background: "white" }),
    thumbnail: z.string().max(200_000).nullish(),
  })
  .superRefine((data, ctx) => validateDevice(data, ctx));

/**
 * Every field optional; the device triple is re-checked in the route against the
 * merged row, so this only enforces per-field shape.
 */
export const templateUpdateSchema = z
  .object({
    name: name.optional(),
    kind: z.enum(TEMPLATE_KINDS).optional(),
    sizeInches: z.coerce.number().positive().optional(),
    widthPx: z.coerce.number().int().positive().optional(),
    heightPx: z.coerce.number().int().positive().optional(),
    colorMode: z.enum(COLOR_MODES).optional(),
    rotation: rotation.optional(),
    layout: layoutSchema.optional(),
    thumbnail: z.string().max(200_000).nullish(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const templateListSchema = z.object({
  kind: z.enum(TEMPLATE_KINDS).optional(),
  sizeInches: z.coerce.number().positive().optional(),
  colorMode: z.enum(COLOR_MODES).optional(),
});

/**
 * Prisma hands back `sizeInches` as a Decimal, which JSON-serialises to a
 * string ("2.13"). Clients compare it against DEVICE_PRESETS, so normalise it to
 * a number on the way out rather than making every caller remember.
 */
export function serializeTemplate(t) {
  if (!t) return t;
  return { ...t, sizeInches: Number(t.sizeInches) };
}

export const TEMPLATE_SORTABLE = [
  "name",
  "kind",
  "sizeInches",
  "colorMode",
  "createdAt",
  "updatedAt",
];
