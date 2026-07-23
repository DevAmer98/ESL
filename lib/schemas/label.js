// -----------------------------------------------------------------------------
// lib/schemas/label.js — validation for the Devices (labels) tables.
//
// MACs arrive from three places — the console, a vendor CSV, a gateway scan —
// each with its own separator habits. They are normalised to bare uppercase hex
// here so `@@unique([storeId, mac])` actually catches duplicates.
// -----------------------------------------------------------------------------
import { z } from "zod";
import prisma from "@/lib/prisma";
import { notFound } from "@/lib/http";
import { listQuerySchema, search, dateRange } from "@/lib/query";

export const LABEL_SORTABLE = [
  "mac",
  "model",
  "battery",
  "rssi",
  "status",
  "sizeInches",
  "lastUpdateAt",
  "lastBroadcastAt",
  "createdAt",
  "updatedAt",
];

export const LABEL_SEARCH_FIELDS = ["mac", "model"];

export const macSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s:.-]/g, "").toUpperCase())
  .pipe(z.string().regex(/^[0-9A-F]{12}$/, "MAC must be 12 hex digits"));

const labelStatus = z.enum(["ONLINE", "OFFLINE", "BROADCASTING", "ERROR", "UNKNOWN"]);
const cuid = z.string().trim().min(1);

const labelFields = {
  mac: macSchema,
  model: z.string().trim().max(64).optional(),
  sizeInches: z.coerce.number().min(0).max(99).nullish(),
  battery: z.coerce.number().int().min(0).max(100).optional(),
  rssi: z.coerce.number().int().min(-127).max(0).nullish(),
  status: labelStatus.optional(),
  productId: cuid.nullish(),
  templateId: cuid.nullish(),
  gatewayId: cuid.nullish(),
  groupId: cuid.nullish(),
};

export const labelCreateSchema = z.object(labelFields);
export const labelUpdateSchema = z
  .object(labelFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

/** Bind is deliberately narrow: it only ever moves a label's associations. */
export const labelBindSchema = z
  .object({
    productId: cuid.nullish(),
    templateId: cuid.nullish(),
    groupId: cuid.nullish(),
    push: z.boolean().default(true),
  })
  .refine(
    (v) => ["productId", "templateId", "groupId"].some((k) => k in v),
    "Provide at least one of productId, templateId, groupId",
  );

export const labelCsvRowSchema = z.object({
  mac: macSchema,
  model: z.string().trim().max(64).optional(),
  sizeInches: z.coerce.number().min(0).max(99).optional(),
  battery: z.coerce.number().int().min(0).max(100).optional(),
  status: labelStatus.optional(),
  // Human-friendly keys — resolved to ids by the import route, which is where
  // the store scope lives.
  productCode: z.string().trim().max(64).optional(),
  groupName: z.string().trim().max(120).optional(),
  gatewayMac: macSchema.optional(),
});

export const labelListQuerySchema = listQuerySchema.extend({
  status: labelStatus.optional(),
  groupId: cuid.optional(),
  gatewayId: cuid.optional(),
  productId: cuid.optional(),
  sizeInches: z.coerce.number().min(0).max(99).optional(),
  batteryMin: z.coerce.number().int().min(0).max(100).optional(),
  batteryMax: z.coerce.number().int().min(0).max(100).optional(),
  unbound: z.enum(["true", "false"]).optional(),
});

export function labelWhere(storeId, params) {
  return {
    storeId,
    ...search(params.q, LABEL_SEARCH_FIELDS),
    ...(params.status && { status: params.status }),
    ...(params.groupId && { groupId: params.groupId }),
    ...(params.gatewayId && { gatewayId: params.gatewayId }),
    ...(params.productId && { productId: params.productId }),
    ...(params.sizeInches !== undefined && { sizeInches: params.sizeInches }),
    ...((params.batteryMin !== undefined || params.batteryMax !== undefined) && {
      battery: {
        ...(params.batteryMin !== undefined && { gte: params.batteryMin }),
        ...(params.batteryMax !== undefined && { lte: params.batteryMax }),
      },
    }),
    ...(params.unbound === "true" && { productId: null }),
    ...dateRange("createdAt", params.from, params.to),
  };
}

/**
 * Prove every foreign key in `data` belongs to this store before writing it.
 * Without this a caller could bind their label to another tenant's product —
 * Prisma would happily accept the id, since the FK has no store component.
 */
export async function assertLabelRefs(storeId, data) {
  const checks = [
    ["productId", prisma.product],
    ["templateId", prisma.template],
    ["gatewayId", prisma.gateway],
    ["groupId", prisma.labelGroup],
  ];
  for (const [key, model] of checks) {
    const id = data[key];
    if (!id) continue;
    const row = await model.findFirst({ where: { id, storeId }, select: { id: true } });
    if (!row) throw notFound(`${key.replace(/Id$/, "")} not found in this store`);
  }
}

export const LABEL_CSV_COLUMNS = [
  { key: "mac", header: "mac" },
  { key: "model", header: "model" },
  // Prisma hands back a Decimal object; without this it would be JSON-quoted.
  { key: "sizeInches", header: "sizeInches", format: (v) => (v == null ? "" : String(v)) },
  { key: "battery", header: "battery" },
  { key: "rssi", header: "rssi" },
  { key: "status", header: "status" },
  { key: "productCode", header: "productCode", format: (_v, r) => r.product?.code ?? "" },
  { key: "productName", header: "productName", format: (_v, r) => r.product?.name ?? "" },
  { key: "groupName", header: "groupName", format: (_v, r) => r.group?.name ?? "" },
  { key: "gatewayMac", header: "gatewayMac", format: (_v, r) => r.gateway?.mac ?? "" },
  { key: "templateName", header: "templateName", format: (_v, r) => r.template?.name ?? "" },
  { key: "lastUpdateAt", header: "lastUpdateAt" },
  { key: "updatedAt", header: "updatedAt" },
];
