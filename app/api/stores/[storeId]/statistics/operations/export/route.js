// CSV of the Operation Record tab. Takes the same filters as the list route —
// an export that ignores the active filter is worse than no export.
import prisma from "@/lib/prisma";
import { withStore, query } from "@/lib/http";
import { toCsv, csvResponse } from "@/lib/csv";
import { OPERATION_SORTABLE, operationListQuerySchema, operationWhere } from "@/lib/stats";
import { paginate } from "@/lib/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hard ceiling: streaming a million rows through Next's response body is not
 *  a download, it's an outage. Narrow the date range instead. */
const MAX_ROWS = 20_000;

const COLUMNS = [
  { key: "createdAt", header: "timestamp" },
  { key: "operationType", header: "operation" },
  { key: "result", header: "result" },
  { key: "mac", header: "mac" },
  { key: "groupName", header: "group" },
  { key: "durationMs", header: "durationMs" },
  { key: "detail", header: "detail" },
  { key: "operatorId", header: "operatorId" },
];

export const GET = withStore(async (req, { store }) => {
  const params = query(req, operationListQuerySchema);
  const where = operationWhere(store.id, params);

  const { orderBy } = paginate(params, OPERATION_SORTABLE, "createdAt");
  const rows = await prisma.operationRecord.findMany({
    where,
    orderBy,
    take: MAX_ROWS,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse(toCsv(rows, COLUMNS), `operations-${stamp}.csv`);
});
