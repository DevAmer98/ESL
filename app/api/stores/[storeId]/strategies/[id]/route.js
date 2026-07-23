import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, body, notFound, badRequest } from "@/lib/http";
import { conditionSchema } from "@/lib/services/strategy";
import { recordChanges, recordDeletion } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    priority: z.coerce.number().int().min(0).max(9999),
    enabled: z.boolean(),
    condition: conditionSchema,
    templateId: z.string().min(1),
  })
  .partial();

function find(id, storeId) {
  return prisma.templateStrategy.findFirst({ where: { id, storeId } });
}

export const GET = withStore(async (req, { store, params }) => {
  const strategy = await prisma.templateStrategy.findFirst({
    where: { id: params.id, storeId: store.id },
    include: { template: { select: { id: true, name: true } } },
  });
  if (!strategy) throw notFound("Strategy not found");
  return ok(strategy);
});

export const PATCH = withStore(
  async (req, { store, user, params }) => {
    const before = await find(params.id, store.id);
    if (!before) throw notFound("Strategy not found");

    const data = await body(req, patchSchema);

    if (data.templateId) {
      const template = await prisma.template.findFirst({
        where: { id: data.templateId, storeId: store.id },
        select: { id: true },
      });
      if (!template) throw badRequest("templateId does not belong to this store");
    }

    const strategy = await prisma.templateStrategy.update({
      where: { id: before.id },
      data,
    });

    await recordChanges({
      storeId: store.id,
      entity: "TemplateStrategy",
      entityId: strategy.id,
      before,
      after: data,
      userId: user.id,
    });

    return ok(strategy);
  },
  { role: "ADMIN" },
);

export const DELETE = withStore(
  async (req, { store, user, params }) => {
    const before = await find(params.id, store.id);
    if (!before) throw notFound("Strategy not found");

    // Labels keep whatever template the rule already assigned — removing the
    // rule stops future assignment, it does not undo past ones.
    await prisma.templateStrategy.deleteMany({ where: { id: before.id, storeId: store.id } });

    await recordDeletion({
      storeId: store.id,
      entity: "TemplateStrategy",
      entityId: before.id,
      snapshot: before,
      userId: user.id,
    });

    return ok({ deleted: true, id: before.id });
  },
  { role: "ADMIN" },
);
