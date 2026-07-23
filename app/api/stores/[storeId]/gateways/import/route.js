import prisma from "@/lib/prisma";
import { withStore, ok, badRequest } from "@/lib/http";
import { parseCsv, fileFromRequest } from "@/lib/csv";
import { gatewayCsvRowSchema } from "@/lib/schemas/gateway";
import { recordOperation } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * parseCsv keeps only the rows that validated, so a row's index is not its line
 * number. Rebuild the mapping from the lines the parser already rejected —
 * otherwise a later failure blames an innocent row.
 */
function lineNumbers(rows, errors) {
  const rejected = new Set(errors.map((e) => e.line));
  const lines = [];
  for (let line = 2; lines.length < rows.length; line += 1) {
    if (!rejected.has(line)) lines.push(line);
  }
  return lines;
}

export const POST = withStore(
  async (req, { store, user }) => {
    const file = await fileFromRequest(req);
    if (!file) throw badRequest("Upload a CSV file in the `file` field");

    const { rows, errors } = parseCsv(file.text, gatewayCsvRowSchema);
    const lines = lineNumbers(rows, errors);

    let imported = 0;
    let updated = 0;

    for (const [i, row] of rows.entries()) {
      const { mac, ...rest } = row;
      try {
        const existing = await prisma.gateway.findFirst({
          where: { storeId: store.id, mac },
          select: { id: true },
        });
        if (existing) {
          await prisma.gateway.update({ where: { id: existing.id }, data: rest });
          updated += 1;
        } else {
          await prisma.gateway.create({ data: { ...rest, mac, storeId: store.id } });
          imported += 1;
        }
      } catch (err) {
        errors.push({ line: lines[i], message: err.message });
      }
    }

    await recordOperation({
      storeId: store.id,
      operationType: "IMPORT",
      result: errors.length ? "FAILURE" : "SUCCESS",
      detail: `${file.name}: ${imported} created, ${updated} updated, ${errors.length} failed`,
      snapshot: { file: file.name, imported, updated, failed: errors.length },
      operatorId: user.id,
    });

    return ok({ imported, updated, failed: errors.length, errors });
  },
  { role: "OPERATOR" },
);
