import prisma from "@/lib/prisma";
import { withStore, ok, body, query } from "@/lib/http";
import { paginate, page } from "@/lib/query";
import {
  PRODUCT_SORTABLE,
  productCreateSchema,
  productDto,
  productListQuerySchema,
  productWhere,
} from "@/lib/schemas/product";
import { recordChanges } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withStore(async (req, { store }) => {
  const params = query(req, productListQuerySchema);
  const where = productWhere(store.id, params);

  const [items, total] = await Promise.all([
    prisma.product.findMany({ where, ...paginate(params, PRODUCT_SORTABLE, "updatedAt") }),
    prisma.product.count({ where }),
  ]);

  return ok(page(items.map(productDto), total, params));
});

export const POST = withStore(
  async (req, { store, user }) => {
    const data = await body(req, productCreateSchema);

    const product = await prisma.product.create({
      data: { ...data, storeId: store.id },
    });

    await recordChanges({
      storeId: store.id,
      entity: "Product",
      entityId: product.id,
      before: {},
      after: data,
      userId: user.id,
    });

    return ok(productDto(product), { status: 201 });
  },
  { role: "ADMIN" },
);
