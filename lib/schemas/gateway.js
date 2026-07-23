// -----------------------------------------------------------------------------
// lib/schemas/gateway.js — validation for the Gateway table.
//
// Gateways are typed in by installers from a sticker on the box, so the MAC
// normalisation from lib/schemas/label.js applies here too.
// -----------------------------------------------------------------------------
import { z } from "zod";
import { listQuerySchema, search, dateRange } from "@/lib/query";
import { macSchema } from "@/lib/schemas/label";

export const GATEWAY_SORTABLE = ["name", "mac", "ip", "model", "status", "lastSeenAt", "createdAt", "updatedAt"];

export const GATEWAY_SEARCH_FIELDS = ["name", "mac", "ip", "model"];

const gatewayStatus = z.enum(["ONLINE", "OFFLINE", "UNKNOWN"]);

// Not z.string().ip(): installers routinely enter a hostname on a LAN with mDNS.
const host = z.string().trim().max(120);

const gatewayFields = {
  name: z.string().trim().min(1).max(120),
  mac: macSchema,
  ip: host.nullish(),
  model: z.string().trim().max(64).optional(),
  wifiFirmware: z.string().trim().max(64).nullish(),
  bleFirmware: z.string().trim().max(64).nullish(),
  bleModules: z.coerce.number().int().min(1).max(16).optional(),
  status: gatewayStatus.optional(),
};

export const gatewayCreateSchema = z.object(gatewayFields);
export const gatewayUpdateSchema = z
  .object(gatewayFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

export const gatewayCsvRowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mac: macSchema,
  ip: host.optional(),
  model: z.string().trim().max(64).optional(),
  bleModules: z.coerce.number().int().min(1).max(16).optional(),
});

export const gatewayListQuerySchema = listQuerySchema.extend({
  status: gatewayStatus.optional(),
  model: z.string().trim().max(64).optional(),
});

export function gatewayWhere(storeId, params) {
  return {
    storeId,
    ...search(params.q, GATEWAY_SEARCH_FIELDS),
    ...(params.status && { status: params.status }),
    ...(params.model && { model: params.model }),
    ...dateRange("createdAt", params.from, params.to),
  };
}

export const GATEWAY_CSV_COLUMNS = [
  { key: "name", header: "name" },
  { key: "mac", header: "mac" },
  { key: "ip", header: "ip" },
  { key: "model", header: "model" },
  { key: "bleModules", header: "bleModules" },
  { key: "status", header: "status" },
  { key: "lastSeenAt", header: "lastSeenAt" },
];
