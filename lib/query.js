// -----------------------------------------------------------------------------
// lib/query.js — list-endpoint primitives.
//
// Every table in the console (products, labels, gateways, operation records, …)
// wants the same four things: page, page size, sort, free-text search. Doing it
// once here keeps the routes short and, importantly, keeps the sort field on an
// allow-list so a query param can never reach the DB as an arbitrary column.
// -----------------------------------------------------------------------------
import { z } from "zod";
import { badRequest } from "@/lib/http";

export const MAX_PAGE_SIZE = 200;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  q: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * Turn validated list params into Prisma `skip`/`take`/`orderBy`.
 * @param params  output of listQuerySchema
 * @param sortable allow-listed column names
 * @param fallback default sort column
 */
export function paginate(params, sortable, fallback) {
  const { page, pageSize, sort, order } = params;

  if (sort && !sortable.includes(sort)) {
    throw badRequest(`Cannot sort by "${sort}"`, { sortable });
  }
  return {
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: { [sort || fallback]: order },
  };
}

/** Case-insensitive OR-contains across the given text columns. */
export function search(q, fields) {
  if (!q) return {};
  return { OR: fields.map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) };
}

/** Inclusive date-range filter on a timestamp column. */
export function dateRange(field, from, to) {
  if (!from && !to) return {};
  return { [field]: { ...(from && { gte: from }), ...(to && { lte: to }) } };
}

/** The response envelope every list endpoint returns. */
export function page(items, total, params) {
  return {
    items,
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}
