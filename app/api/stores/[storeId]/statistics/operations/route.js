// Statistical Analysis → Operation Record. The raw feed everything else on the
// screen is an aggregate of.
import prisma from "@/lib/prisma";
import { withStore, ok, query } from "@/lib/http";
import { paginate, page } from "@/lib/query";
import { OPERATION_SORTABLE, operationListQuerySchema, operationWhere } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withStore(async (req, { store }) => {
  const params = query(req, operationListQuerySchema);
  const where = operationWhere(store.id, params);

  const [items, total] = await Promise.all([
    prisma.operationRecord.findMany({
      where,
      ...paginate(params, OPERATION_SORTABLE, "createdAt"),
    }),
    prisma.operationRecord.count({ where }),
  ]);

  return ok(page(items, total, params));
});
