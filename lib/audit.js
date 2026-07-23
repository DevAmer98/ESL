// -----------------------------------------------------------------------------
// lib/audit.js — feeds the Data Changes and Deletion Log tabs.
//
// Auditing is best-effort by design: a failure to write history must never fail
// the user's actual operation, so every writer here swallows its errors after
// logging them.
// -----------------------------------------------------------------------------
import prisma from "@/lib/prisma";

/** Values we can meaningfully diff and store as text. */
function printable(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Record a field-level diff between two versions of a row.
 * Only changed, scalar-comparable fields are written.
 */
export async function recordChanges({ storeId, entity, entityId, before, after, userId }) {
  try {
    const rows = [];
    for (const field of Object.keys(after ?? {})) {
      if (field === "updatedAt") continue;
      const oldValue = printable(before?.[field]);
      const newValue = printable(after[field]);
      if (oldValue === newValue) continue;
      rows.push({ storeId, entity, entityId, field, oldValue, newValue, userId });
    }
    if (rows.length) await prisma.dataChange.createMany({ data: rows });
    return rows.length;
  } catch (err) {
    console.error("[audit] recordChanges failed", err);
    return 0;
  }
}

/** Snapshot a row on the way out so a deletion is recoverable in principle. */
export async function recordDeletion({ storeId, entity, entityId, snapshot, userId }) {
  try {
    await prisma.deletionLog.create({
      data: { storeId, entity, entityId, snapshot: snapshot ?? {}, userId },
    });
  } catch (err) {
    console.error("[audit] recordDeletion failed", err);
  }
}

/** Append to the Operation Record feed. */
export async function recordOperation({
  storeId,
  labelId,
  mac,
  groupName,
  operationType,
  result,
  detail,
  durationMs,
  snapshot,
  operatorId,
}) {
  try {
    return await prisma.operationRecord.create({
      data: {
        storeId,
        labelId,
        mac,
        groupName,
        operationType,
        result,
        detail,
        durationMs,
        snapshot: snapshot ?? {},
        operatorId,
      },
    });
  } catch (err) {
    console.error("[audit] recordOperation failed", err);
    return null;
  }
}
