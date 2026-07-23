import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, body } from "@/lib/http";
import { recordDeletion } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bulkSchema = z.object({
  action: z.enum(["delete"]),
  ids: z.array(z.string().min(1)).min(1).max(500),
});

export const POST = withStore(
  async (req, { store, user }) => {
    const { ids } = await body(req, bulkSchema);

    // Read scoped first: the snapshot is the only record of what was removed,
    // and the read doubles as the tenancy filter for the delete.
    const products = await prisma.product.findMany({
      where: { id: { in: ids }, storeId: store.id },
    });

    const { count } = await prisma.product.deleteMany({
      where: { id: { in: products.map((p) => p.id) }, storeId: store.id },
    });

    for (const p of products) {
      await recordDeletion({
        storeId: store.id,
        entity: "Product",
        entityId: p.id,
        snapshot: p,
        userId: user.id,
      });
    }

    return ok({ deleted: count, skipped: ids.length - count });
  },
  { role: "ADMIN" },
);
