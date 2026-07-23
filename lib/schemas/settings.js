// -----------------------------------------------------------------------------
// lib/schemas/settings.js — Store Settings → Parameter Settings.
//
// These knobs are read by the push queue and the offline reconciler, not just
// displayed, so every one of them carries a default here rather than at the
// call site. A store row written before a knob existed still parses into a
// complete, usable object.
// -----------------------------------------------------------------------------
import { z } from "zod";

/** Self-hosted ESL Cloud builds move endpoints around; see lib/minew.js. */
export const minewPathsSchema = z
  .object({
    refresh: z.string().trim().min(1).max(200),
    labels: z.string().trim().min(1).max(200),
    gateways: z.string().trim().min(1).max(200),
    led: z.string().trim().min(1).max(200),
  })
  .partial();

/** Validation only — defaults are applied separately, see below. */
const FIELDS = {
  /** Percent below which a tag is flagged in Statistical Analysis. */
  lowBatteryThreshold: z.coerce.number().int().min(0).max(100),
  /** Silence longer than this marks a device OFFLINE. */
  offlineAfterMinutes: z.coerce.number().int().min(1).max(10_080),
  /** Ceiling on queue retries — the queue backs off exponentially between them. */
  pushMaxAttempts: z.coerce.number().int().min(1).max(10),
  /** How many jobs the worker drains per tick; the vendor API rate-limits. */
  pushConcurrency: z.coerce.number().int().min(1).max(50),
  timeoutMs: z.coerce.number().int().min(1_000).max(120_000),
  minewPaths: minewPathsSchema,
  /** Fallback template for labels no strategy matches. */
  defaultTemplateId: z.string().trim().min(1).nullable(),
};

export const PARAMETER_DEFAULTS = {
  lowBatteryThreshold: 20,
  offlineAfterMinutes: 60,
  pushMaxAttempts: 5,
  pushConcurrency: 4,
  timeoutMs: 15_000,
};

const withDefault = ([name, schema]) => [
  name,
  name in PARAMETER_DEFAULTS ? schema.default(PARAMETER_DEFAULTS[name]) : schema.optional(),
];

/** Read direction: whatever is in the column, filled out to a complete object. */
export const parametersSchema = z.object(
  Object.fromEntries(Object.entries(FIELDS).map(withDefault)),
);

/**
 * Write direction: the tab posts only the knobs it renders. Built from the
 * bare field validators rather than `parametersSchema.partial()` — partial()
 * keeps the defaults, so an absent key would parse to its default and silently
 * reset a value the merchant had tuned.
 */
export const parametersPatchSchema = z
  .object(Object.fromEntries(Object.entries(FIELDS).map(([n, s]) => [n, s.optional()])))
  .partial();

export const settingsUpdateSchema = z.object({
  mode: z.enum(["DEMO", "CLOUD", "GATEWAY"]).optional(),
  cloudUrl: z.string().trim().max(500).optional(),
  gatewayIp: z.string().trim().max(100).optional(),
  /** Write-only. Absent or "" means "keep whatever is already stored". */
  token: z.string().max(500).optional(),
  parameters: parametersPatchSchema.optional(),
});

/**
 * Apply defaults to whatever JSON is in the column. Unknown keys are dropped —
 * a knob removed from the product should stop being echoed back to the UI.
 */
export function withDefaults(parameters) {
  return parametersSchema.parse(parameters ?? {});
}

/** Merge a patch over the stored object, ignoring keys the client omitted. */
export function mergeParameters(stored, patch) {
  const merged = { ...(stored ?? {}) };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v !== undefined) merged[k] = v;
  }
  return withDefaults(merged);
}
