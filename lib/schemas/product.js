// -----------------------------------------------------------------------------
// lib/schemas/product.js — validation for Store Data (products).
//
// The DB stores integer minor units (`priceCents`), but merchandisers type and
// export decimals ("12.34"). The conversion lives here so it happens exactly
// once, at the edge, and no route or CSV importer has to remember it.
// -----------------------------------------------------------------------------
import { z } from "zod";
import { listQuerySchema, search, dateRange } from "@/lib/query";

/** Sort allow-list shared by the list and export endpoints. */
export const PRODUCT_SORTABLE = [
  "code",
  "name",
  "brand",
  "sku",
  "priceCents",
  "createdAt",
  "updatedAt",
];

/** Columns free-text search spans — the ones printed on a shelf label. */
export const PRODUCT_SEARCH_FIELDS = ["code", "name", "specification", "sku", "brand"];

/** Decimal currency in, integer minor units out. */
const money = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    // Strip currency symbols and thousands separators, but insist on what's
    // left being a number: Number("") is 0, so a typo would import as free.
    const cleaned = typeof v === "number" ? v : String(v).trim().replace(/[\s,]|^[^\d.-]+/g, "");
    const n = Number(cleaned);
    if (cleaned === "" || !Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "Must be a decimal amount" });
      return z.NEVER;
    }
    // Round rather than truncate: 19.99 * 100 is 1998.9999… in binary floats.
    return Math.round(n * 100);
  })
  .pipe(z.number().int().min(0));

const text = (max) => z.string().trim().max(max);

const productFields = {
  code: text(64).min(1),
  name: text(200).min(1),
  specification: text(200).nullish(),
  unit: text(32).nullish(),
  brand: text(120).nullish(),
  weight: text(64).nullish(),
  origin: text(120).nullish(),
  sku: text(64).nullish(),
  glyph: text(8).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  price: money.optional(),
  memberPrice: money.nullish(),
  // Accepted too, so a client that already speaks cents doesn't round-trip
  // through a decimal it might lose precision on.
  priceCents: z.coerce.number().int().min(0).optional(),
  memberPriceCents: z.coerce.number().int().min(0).nullish(),
};

/** Collapse the decimal aliases onto the columns Prisma actually has. */
function toColumns({ price, memberPrice, ...rest }) {
  const out = { ...rest };
  if (price !== undefined) out.priceCents = price;
  if (memberPrice !== undefined) out.memberPriceCents = memberPrice;
  return out;
}

const productBase = z.object(productFields);

export const productCreateSchema = productBase.transform(toColumns);
export const productUpdateSchema = productBase
  .partial()
  .refine((v) => Object.keys(v).length > 0, "No fields to update")
  .transform(toColumns);

/**
 * One CSV row. Loose on purpose: unrecognised headers become tenant-defined
 * `attributes` rather than being dropped, which is what Customize Columns
 * surfaces later.
 */
export const productCsvRowSchema = z
  .looseObject({
    code: text(64).min(1),
    name: text(200).min(1),
    specification: text(200).optional(),
    unit: text(32).optional(),
    brand: text(120).optional(),
    weight: text(64).optional(),
    origin: text(120).optional(),
    sku: text(64).optional(),
    glyph: text(8).optional(),
    price: money.optional(),
    memberPrice: money.optional(),
  })
  .transform(({ price, memberPrice, ...rest }) => {
    const known = new Set([
      "code", "name", "specification", "unit", "brand",
      "weight", "origin", "sku", "glyph",
    ]);
    const attributes = {};
    const columns = {};
    for (const [k, v] of Object.entries(rest)) {
      if (known.has(k)) columns[k] = v;
      else if (v !== undefined) attributes[k] = v;
    }
    return {
      ...columns,
      ...(price !== undefined && { priceCents: price }),
      ...(memberPrice !== undefined && { memberPriceCents: memberPrice }),
      ...(Object.keys(attributes).length && { attributes }),
    };
  });

/** Query params for list + export. Both must agree or the export lies. */
export const productListQuerySchema = listQuerySchema.extend({
  brand: z.string().trim().max(120).optional(),
  unit: z.string().trim().max(32).optional(),
  origin: z.string().trim().max(120).optional(),
  minPrice: money.optional(),
  maxPrice: money.optional(),
});

export function productWhere(storeId, params) {
  return {
    storeId,
    ...search(params.q, PRODUCT_SEARCH_FIELDS),
    ...(params.brand && { brand: params.brand }),
    ...(params.unit && { unit: params.unit }),
    ...(params.origin && { origin: params.origin }),
    ...((params.minPrice !== undefined || params.maxPrice !== undefined) && {
      priceCents: {
        ...(params.minPrice !== undefined && { gte: params.minPrice }),
        ...(params.maxPrice !== undefined && { lte: params.maxPrice }),
      },
    }),
    ...dateRange("createdAt", params.from, params.to),
  };
}

/** Cents are the truth; decimals are added back for the UI and CSV. */
export function productDto(p) {
  return {
    ...p,
    price: (p.priceCents / 100).toFixed(2),
    memberPrice: p.memberPriceCents == null ? null : (p.memberPriceCents / 100).toFixed(2),
  };
}

export const PRODUCT_CSV_COLUMNS = [
  { key: "code", header: "code" },
  { key: "name", header: "name" },
  { key: "specification", header: "specification" },
  { key: "unit", header: "unit" },
  { key: "price", header: "price" },
  { key: "memberPrice", header: "memberPrice" },
  { key: "brand", header: "brand" },
  { key: "weight", header: "weight" },
  { key: "origin", header: "origin" },
  { key: "sku", header: "sku" },
  { key: "glyph", header: "glyph" },
  { key: "attributes", header: "attributes" },
  { key: "updatedAt", header: "updatedAt" },
];
