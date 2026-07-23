import prisma from "@/lib/prisma";
import { withStore, query } from "@/lib/http";
import { paginate } from "@/lib/query";
import { toCsv, csvResponse } from "@/lib/csv";
import {
  PRODUCT_CSV_COLUMNS,
  PRODUCT_SORTABLE,
  productDto,
  productListQuerySchema,
  productWhere,
} from "@/lib/schemas/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPORT_LIMIT = 50_000;

export const GET = withStore(async (req, { store }) => {
  const params = query(req, productListQuerySchema);
  const where = productWhere(store.id, params);

  // Export means "everything the filter matched", not the page the user is on,
  // so paginate() is used only for its validated sort.
  const { orderBy } = paginate(params, PRODUCT_SORTABLE, "updatedAt");
  const products = await prisma.product.findMany({ where, orderBy, take: EXPORT_LIMIT });

  const csv = toCsv(products.map(productDto), PRODUCT_CSV_COLUMNS);
  return csvResponse(csv, `products-${store.slug}.csv`);
});
