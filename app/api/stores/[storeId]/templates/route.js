import prisma from "@/lib/prisma";
import { withStore, ok, body, query } from "@/lib/http";
import { listQuerySchema, paginate, search, page } from "@/lib/query";
import {
  templateCreateSchema,
  templateListSchema,
  serializeTemplate,
  TEMPLATE_SORTABLE,
} from "@/lib/schemas/template";
import { recordChanges } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withStore(async (req, { store }) => {
  const params = query(req, listQuerySchema.extend(templateListSchema.shape));

  const where = {
    storeId: store.id,
    ...search(params.q, ["name"]),
    ...(params.kind && { kind: params.kind }),
    ...(params.colorMode && { colorMode: params.colorMode }),
    ...(params.sizeInches != null && { sizeInches: params.sizeInches }),
  };

  const [items, total] = await Promise.all([
    prisma.template.findMany({ where, ...paginate(params, TEMPLATE_SORTABLE, "updatedAt") }),
    prisma.template.count({ where }),
  ]);

  return ok(page(items.map(serializeTemplate), total, params));
});

export const POST = withStore(
  async (req, { store, user }) => {
    const data = await body(req, templateCreateSchema);

    const created = await prisma.template.create({
      data: { ...data, storeId: store.id },
    });

    // Creation is recorded as a diff from nothing so the Data Changes tab shows
    // where a template came from, not just how it later drifted.
    await recordChanges({
      storeId: store.id,
      entity: "Template",
      entityId: created.id,
      before: {},
      after: { name: created.name, kind: created.kind, sizeInches: String(created.sizeInches),
        widthPx: created.widthPx, heightPx: created.heightPx, colorMode: created.colorMode },
      userId: user.id,
    });

    return ok(serializeTemplate(created), { status: 201 });
  },
  { role: "ADMIN" },
);
