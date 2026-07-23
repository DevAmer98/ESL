// -----------------------------------------------------------------------------
// lib/schemas/schedules.js — shared by the schedules collection and item routes.
//
// Lives here rather than beside one route because both need the same target
// shape, and a route file must not import another route file.
// -----------------------------------------------------------------------------
import { z } from "zod";
import prisma from "@/lib/prisma";
import { badRequest } from "@/lib/http";

/** Which labels a schedule touches: everything, whole groups, or a hand-picked list. */
export const targetSchema = z.object({
  allLabels: z.boolean().default(false),
  groupIds: z.array(z.string().min(1)).max(500).default([]),
  labelIds: z.array(z.string().min(1)).max(5000).default([]),
});

const FIELDS = {
  name: z.string().trim().min(1).max(120),
  cron: z.string().trim().min(1).max(200),
  timezone: z.string().trim().min(1).max(64),
  enabled: z.boolean(),
  target: targetSchema,
  templateId: z.string().min(1).nullable(),
};

export const scheduleCreateSchema = z.object({
  ...FIELDS,
  timezone: FIELDS.timezone.default("UTC"),
  enabled: FIELDS.enabled.default(true),
  target: FIELDS.target.default({}),
  templateId: FIELDS.templateId.nullish(),
});

/**
 * Built from the bare fields, not `scheduleCreateSchema.partial()`: an
 * optional-wrapped default still resolves to its default, so a PATCH that only
 * touched `enabled` would quietly reset the timezone and blank the target.
 */
export const schedulePatchSchema = z.object(
  Object.fromEntries(Object.entries(FIELDS).map(([n, s]) => [n, s.optional()])),
);

/**
 * Prove every id in the payload belongs to this store. Without this, a schedule
 * could be pointed at another tenant's labels and would fire hours later with
 * nobody watching — the worker resolves targets by id, not by request context.
 */
export async function assertOwnedRefs(storeId, { templateId, target } = {}) {
  if (templateId) {
    const template = await prisma.template.findFirst({
      where: { id: templateId, storeId },
      select: { id: true },
    });
    if (!template) throw badRequest("templateId does not belong to this store");
  }

  const groupIds = [...new Set(target?.groupIds ?? [])];
  if (groupIds.length) {
    const n = await prisma.labelGroup.count({ where: { id: { in: groupIds }, storeId } });
    if (n !== groupIds.length) throw badRequest("target.groupIds contains unknown groups");
  }

  const labelIds = [...new Set(target?.labelIds ?? [])];
  if (labelIds.length) {
    const n = await prisma.label.count({ where: { id: { in: labelIds }, storeId } });
    if (n !== labelIds.length) throw badRequest("target.labelIds contains unknown labels");
  }
}
