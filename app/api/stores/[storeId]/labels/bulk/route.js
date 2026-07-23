import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, body, forbidden, notFound } from "@/lib/http";
import { recordDeletion } from "@/lib/audit";
import { enqueuePush } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bulkSchema = z.object({
  action: z.enum(["delete", "refresh", "assignGroup", "assignTemplate"]),
  ids: z.array(z.string().min(1)).min(1).max(500),
  groupId: z.string().min(1).nullish(),
  templateId: z.string().min(1).nullish(),
});

// Destructive and structural edits are admin work; a refresh is what an
// operator on the shop floor does all day.
const ROLE_FOR = {
  delete: "ADMIN",
  assignGroup: "ADMIN",
  assignTemplate: "ADMIN",
  refresh: "OPERATOR",
};
const ROLE_RANK = { VIEWER: 0, OPERATOR: 1, ADMIN: 2, OWNER: 3 };

export const POST = withStore(
  async (req, { store, user, role }) => {
    const input = await body(req, bulkSchema);
    const needed = ROLE_FOR[input.action];
    if (ROLE_RANK[role] < ROLE_RANK[needed]) {
      throw forbidden(`Requires ${needed.toLowerCase()} access`);
    }

    // One scoped read decides which ids the caller is actually allowed to touch.
    const labels = await prisma.label.findMany({
      where: { id: { in: input.ids }, storeId: store.id },
    });
    const ids = labels.map((l) => l.id);
    const skipped = input.ids.length - ids.length;
    if (!ids.length) return ok({ action: input.action, affected: 0, skipped });

    if (input.action === "delete") {
      const { count } = await prisma.label.deleteMany({
        where: { id: { in: ids }, storeId: store.id },
      });
      for (const l of labels) {
        await recordDeletion({
          storeId: store.id,
          entity: "Label",
          entityId: l.id,
          snapshot: l,
          userId: user.id,
        });
      }
      return ok({ action: input.action, affected: count, skipped });
    }

    if (input.action === "refresh") {
      const jobs = await enqueuePush({
        storeId: store.id,
        labelIds: ids,
        operatorId: user.id,
        reason: "REFRESH",
      });
      return ok({ action: input.action, affected: jobs.length, skipped });
    }

    const key = input.action === "assignGroup" ? "groupId" : "templateId";
    const value = input[key] ?? null;
    if (value) {
      const model = key === "groupId" ? prisma.labelGroup : prisma.template;
      const row = await model.findFirst({
        where: { id: value, storeId: store.id },
        select: { id: true },
      });
      if (!row) throw notFound(`${key.replace(/Id$/, "")} not found in this store`);
    }

    const { count } = await prisma.label.updateMany({
      where: { id: { in: ids }, storeId: store.id },
      data: { [key]: value },
    });
    return ok({ action: input.action, affected: count, skipped });
  },
  { role: "OPERATOR" },
);
