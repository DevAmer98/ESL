// -----------------------------------------------------------------------------
// lib/services/strategy.js — Store Settings → Template Strategy.
//
// A strategy answers one question: given the product bound to this label, which
// template should it render with? Merchants express that as data, not code
// ("brand is Acme" → poster template), so the condition tree lives in JSON and
// is interpreted here.
//
// Assignment is pure bookkeeping — it sets templateId and stops. Pushing the
// new artwork is a separate, explicit act, because re-rendering every tag in a
// store is expensive and nobody should trigger it by editing a rule.
// -----------------------------------------------------------------------------
import { z } from "zod";
import prisma from "@/lib/prisma";

const OPS = ["eq", "neq", "contains", "startsWith", "gt", "gte", "lt", "lte", "in", "between"];

/** Recursive: a leaf comparison, or all/any of nested conditions. */
export const conditionSchema = z.lazy(() =>
  z.union([
    z.object({
      field: z.string().trim().min(1).max(120),
      op: z.enum(OPS),
      value: z.any(),
    }),
    z.object({ all: z.array(conditionSchema).min(1) }),
    z.object({ any: z.array(conditionSchema).min(1) }),
    z.object({ not: conditionSchema }),
    // The empty object is what the column defaults to: matches nothing.
    // Strict, so a half-written rule like { field } fails validation instead of
    // being quietly accepted as "never matches".
    z.strictObject({}),
  ]),
);

/** Dot-path lookup so `attributes.color` reaches tenant-defined columns. */
function pick(context, field) {
  return String(field)
    .split(".")
    .reduce((acc, part) => (acc == null ? undefined : acc[part]), context);
}

function asNumber(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** Numeric where both sides look numeric, lexicographic otherwise. */
function compare(a, b) {
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na === nb ? 0 : na < nb ? -1 : 1;
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

function looseEq(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "boolean" || typeof b === "boolean") {
    return String(a) === String(b);
  }
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na === nb;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function text(v) {
  return v == null ? "" : String(v).toLowerCase();
}

function leaf({ field, op, value }, context) {
  const actual = pick(context, field);

  switch (op) {
    case "eq":
      return looseEq(actual, value);
    case "neq":
      return !looseEq(actual, value);
    case "contains":
      return text(actual).includes(text(value));
    case "startsWith":
      return text(actual).startsWith(text(value));
    case "gt":
      return actual != null && compare(actual, value) > 0;
    case "gte":
      return actual != null && compare(actual, value) >= 0;
    case "lt":
      return actual != null && compare(actual, value) < 0;
    case "lte":
      return actual != null && compare(actual, value) <= 0;
    case "in":
      return Array.isArray(value) && value.some((v) => looseEq(actual, v));
    case "between": {
      if (!Array.isArray(value) || value.length !== 2 || actual == null) return false;
      const [lo, hi] = value;
      return compare(actual, lo) >= 0 && compare(actual, hi) <= 0;
    }
    default:
      return false;
  }
}

/**
 * Evaluate a condition tree against a context object.
 * Anything malformed evaluates false — a broken rule must never assign a
 * template by accident.
 */
export function evaluate(condition, context) {
  if (!condition || typeof condition !== "object") return false;
  if (Array.isArray(condition.all)) {
    return condition.all.every((c) => evaluate(c, context));
  }
  if (Array.isArray(condition.any)) {
    return condition.any.some((c) => evaluate(c, context));
  }
  if (condition.not) return !evaluate(condition.not, context);
  if (!condition.field || !condition.op) return false;
  return leaf(condition, context);
}

/**
 * The shape rules are written against. `price` is exposed alongside the stored
 * `priceCents` because merchants write "price > 9.99", not "priceCents > 999".
 */
export function contextFor(label) {
  const product = label.product ?? {};
  return {
    ...product,
    price: (product.priceCents ?? 0) / 100,
    memberPrice: product.memberPriceCents == null ? null : product.memberPriceCents / 100,
    attributes: product.attributes ?? {},
    label: {
      mac: label.mac,
      model: label.model,
      status: label.status,
      battery: label.battery,
      groupId: label.groupId,
    },
  };
}

/**
 * Re-evaluate strategies over a store's labels and assign templates.
 * Highest priority wins; ties break on the older rule so the outcome is stable.
 *
 * @param labelIds optional subset — omit to sweep the whole store
 * @returns a summary the API hands straight back to the operator
 */
export async function applyStrategies({ storeId, labelIds }) {
  const strategies = await prisma.templateStrategy.findMany({
    where: { storeId, enabled: true },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });

  const labels = await prisma.label.findMany({
    where: { storeId, ...(labelIds?.length ? { id: { in: labelIds } } : {}) },
    include: { product: true },
  });

  const assignments = [];
  let matched = 0;
  let unmatched = 0;

  for (const label of labels) {
    const context = contextFor(label);
    const hit = strategies.find((s) => evaluate(s.condition, context));

    if (!hit) {
      unmatched++;
      continue;
    }
    matched++;
    if (hit.templateId === label.templateId) continue;

    assignments.push({
      labelId: label.id,
      mac: label.mac,
      strategyId: hit.id,
      strategyName: hit.name,
      fromTemplateId: label.templateId,
      toTemplateId: hit.templateId,
    });
  }

  // Group by target template so a store-wide sweep is a handful of statements
  // rather than one per label.
  const byTemplate = new Map();
  for (const a of assignments) {
    if (!byTemplate.has(a.toTemplateId)) byTemplate.set(a.toTemplateId, []);
    byTemplate.get(a.toTemplateId).push(a.labelId);
  }
  if (byTemplate.size) {
    await prisma.$transaction(
      [...byTemplate].map(([templateId, ids]) =>
        prisma.label.updateMany({
          where: { id: { in: ids }, storeId },
          data: { templateId },
        }),
      ),
    );
  }

  return {
    strategies: strategies.length,
    evaluated: labels.length,
    matched,
    unmatched,
    changed: assignments.length,
    assignments,
  };
}
