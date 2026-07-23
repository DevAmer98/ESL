import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, body, query, badRequest } from "@/lib/http";
import { listQuerySchema, paginate, page, search } from "@/lib/query";
import { conditionSchema } from "@/lib/services/strategy";
import { recordChanges } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTABLE = ["name", "priority", "createdAt", "updatedAt"];

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  priority: z.coerce.number().int().min(0).max(9999).default(0),
  enabled: z.boolean().default(true),
  condition: conditionSchema,
  templateId: z.string().min(1),
});

export const GET = withStore(async (req, { store }) => {
  const params = query(req, listQuerySchema);

  const where = { storeId: store.id, ...search(params.q, ["name"]) };

  const [items, total] = await Promise.all([
    prisma.templateStrategy.findMany({
      where,
      ...paginate(params, SORTABLE, "priority"),
      include: { template: { select: { id: true, name: true } } },
    }),
    prisma.templateStrategy.count({ where }),
  ]);

  return ok(page(items, total, params));
});

export const POST = withStore(
  async (req, { store, user }) => {
    const data = await body(req, createSchema);

    // The FK alone would accept another tenant's template.
    const template = await prisma.template.findFirst({
      where: { id: data.templateId, storeId: store.id },
      select: { id: true },
    });
    if (!template) throw badRequest("templateId does not belong to this store");

    const strategy = await prisma.templateStrategy.create({
      data: { ...data, storeId: store.id },
    });

    await recordChanges({
      storeId: store.id,
      entity: "TemplateStrategy",
      entityId: strategy.id,
      before: null,
      after: data,
      userId: user.id,
    });

    return ok(strategy, { status: 201 });
  },
  { role: "ADMIN" },
);
