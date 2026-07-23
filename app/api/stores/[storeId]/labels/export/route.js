import prisma from "@/lib/prisma";
import { withStore, query } from "@/lib/http";
import { paginate } from "@/lib/query";
import { toCsv, csvResponse } from "@/lib/csv";
import { LABEL_CSV_COLUMNS, LABEL_SORTABLE, labelListQuerySchema, labelWhere } from "@/lib/schemas/label";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPORT_LIMIT = 50_000;

export const GET = withStore(async (req, { store }) => {
  const params = query(req, labelListQuerySchema);
  const where = labelWhere(store.id, params);

  const { orderBy } = paginate(params, LABEL_SORTABLE, "updatedAt");
  const labels = await prisma.label.findMany({
    where,
    orderBy,
    take: EXPORT_LIMIT,
    include: {
      product: { select: { code: true, name: true } },
      group: { select: { name: true } },
      gateway: { select: { mac: true } },
      template: { select: { name: true } },
    },
  });

  return csvResponse(toCsv(labels, LABEL_CSV_COLUMNS), `labels-${store.slug}.csv`);
});
