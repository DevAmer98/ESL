import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, body, notFound, conflict } from "@/lib/http";
import { recordChanges, recordDeletion } from "@/lib/audit";
import {
  templateUpdateSchema,
  validateDevice,
  serializeTemplate,
} from "@/lib/schemas/template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Always by (id, storeId) — a bare findUnique would cross tenants. */
async function load(storeId, id) {
  const template = await prisma.template.findFirst({ where: { id, storeId } });
  if (!template) throw notFound("Template not found");
  return template;
}

export const GET = withStore(async (_req, { store, params }) => {
  const template = await load(store.id, params.id);
  return ok(serializeTemplate(template));
});

export const PATCH = withStore(
  async (req, { store, user, params }) => {
    const before = await load(store.id, params.id);
    const data = await body(req, templateUpdateSchema);

    // The device triple has to be legal for the *result*, not just for the
    // fields that happen to be in the patch: changing only colorMode can still
    // produce a combination the panel already on the record cannot render.
    const merged = {
      sizeInches: data.sizeInches ?? Number(before.sizeInches),
      widthPx: data.widthPx ?? before.widthPx,
      heightPx: data.heightPx ?? before.heightPx,
      colorMode: data.colorMode ?? before.colorMode,
    };
    const issues = [];
    validateDevice(merged, { addIssue: (i) => issues.push(i) });
    if (issues.length) throw new z.ZodError(issues);

    const updated = await prisma.template.update({
      where: { id: before.id },
      data,
    });

    await recordChanges({
      storeId: store.id,
      entity: "Template",
      entityId: before.id,
      before,
      after: updated,
      userId: user.id,
    });

    return ok(serializeTemplate(updated));
  },
  { role: "ADMIN" },
);

export const DELETE = withStore(
  async (_req, { store, user, params }) => {
    const before = await load(store.id, params.id);

    // Prisma would SetNull the labels for us, which silently unbinds live
    // shelf tags. Refuse instead and make the operator reassign deliberately.
    const labelCount = await prisma.label.count({
      where: { storeId: store.id, templateId: before.id },
    });
    if (labelCount > 0) {
      throw conflict(
        labelCount === 1
          ? "1 label still uses this template"
          : `${labelCount} labels still use this template`,
        { labels: labelCount },
      );
    }

    const strategyCount = await prisma.templateStrategy.count({
      where: { storeId: store.id, templateId: before.id },
    });
    if (strategyCount > 0) {
      throw conflict(
        strategyCount === 1
          ? "1 template strategy still references this template"
          : `${strategyCount} template strategies still reference this template`,
        { strategies: strategyCount },
      );
    }

    await prisma.template.deleteMany({ where: { id: before.id, storeId: store.id } });

    await recordDeletion({
      storeId: store.id,
      entity: "Template",
      entityId: before.id,
      snapshot: serializeTemplate(before),
      userId: user.id,
    });

    return ok({ deleted: true, id: before.id });
  },
  { role: "ADMIN" },
);
