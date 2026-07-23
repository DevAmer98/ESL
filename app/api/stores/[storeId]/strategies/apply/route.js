import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, body, badRequest } from "@/lib/http";
import { applyStrategies } from "@/lib/services/strategy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const applySchema = z
  .object({
    /** Omit to sweep every label in the store. */
    labelIds: z.array(z.string().min(1)).max(5000).optional(),
  })
  .default({});

export const POST = withStore(
  async (req, { store }) => {
    const hasBody = (req.headers.get("content-length") ?? "0") !== "0";
    const { labelIds } = hasBody ? await body(req, applySchema) : {};

    if (labelIds?.length) {
      const n = await prisma.label.count({
        where: { id: { in: labelIds }, storeId: store.id },
      });
      if (n !== new Set(labelIds).size) throw badRequest("labelIds contains unknown labels");
    }

    // Assignment only — the operator decides separately when to push the new
    // artwork to the tags.
    return ok(await applyStrategies({ storeId: store.id, labelIds }));
  },
  { role: "OPERATOR" },
);
