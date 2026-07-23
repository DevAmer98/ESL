import prisma from "@/lib/prisma";
import { withStore, ok, badRequest } from "@/lib/http";
import { parseCsv, fileFromRequest } from "@/lib/csv";
import { labelCsvRowSchema } from "@/lib/schemas/label";
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

    const { rows, errors } = parseCsv(file.text, labelCsvRowSchema);
    const lines = lineNumbers(rows, errors);

    // Resolve the human-readable columns once instead of per row: a 2,000-MAC
    // rollout file usually names the same handful of groups and gateways.
    const [products, groups, gateways] = await Promise.all([
      prisma.product.findMany({ where: { storeId: store.id }, select: { id: true, code: true } }),
      prisma.labelGroup.findMany({ where: { storeId: store.id }, select: { id: true, name: true } }),
      prisma.gateway.findMany({ where: { storeId: store.id }, select: { id: true, mac: true } }),
    ]);
    const byCode = new Map(products.map((p) => [p.code, p.id]));
    const byGroup = new Map(groups.map((g) => [g.name, g.id]));
    const byGatewayMac = new Map(gateways.map((g) => [g.mac, g.id]));

    let imported = 0;
    let updated = 0;

    for (const [i, row] of rows.entries()) {
      const { mac, productCode, groupName, gatewayMac, ...rest } = row;
      const line = lines[i];
      try {
        const refs = {};
        if (productCode !== undefined) {
          if (!byCode.has(productCode)) throw new Error(`Unknown product code "${productCode}"`);
          refs.productId = byCode.get(productCode);
        }
        if (groupName !== undefined) {
          if (!byGroup.has(groupName)) throw new Error(`Unknown group "${groupName}"`);
          refs.groupId = byGroup.get(groupName);
        }
        if (gatewayMac !== undefined) {
          if (!byGatewayMac.has(gatewayMac)) throw new Error(`Unknown gateway "${gatewayMac}"`);
          refs.gatewayId = byGatewayMac.get(gatewayMac);
        }

        const existing = await prisma.label.findFirst({
          where: { storeId: store.id, mac },
          select: { id: true },
        });
        if (existing) {
          await prisma.label.update({ where: { id: existing.id }, data: { ...rest, ...refs } });
          updated += 1;
        } else {
          await prisma.label.create({
            data: { ...rest, ...refs, mac, storeId: store.id },
          });
          imported += 1;
        }
      } catch (err) {
        errors.push({ line, message: err.message });
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
