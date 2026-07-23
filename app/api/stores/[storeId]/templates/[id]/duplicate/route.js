import prisma from "@/lib/prisma";
import { withStore, ok, notFound, conflict } from "@/lib/http";
import { recordChanges } from "@/lib/audit";
import { serializeTemplate } from "@/lib/schemas/template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_COPIES = 50;

/**
 * "X" → "X (copy)" → "X (copy 2)" … Names are unique per store, so we probe
 * rather than guess. The base is stripped of any existing suffix first so
 * duplicating a copy gives "X (copy 2)" and not "X (copy) (copy)".
 */
async function uniqueName(storeId, name) {
  const base = name.replace(/ \(copy(?: \d+)?\)$/, "");

  const taken = new Set(
    (
      await prisma.template.findMany({
        where: { storeId, name: { startsWith: base } },
        select: { name: true },
      })
    ).map((t) => t.name),
  );

  for (let i = 1; i <= MAX_COPIES; i++) {
    const candidate = i === 1 ? `${base} (copy)` : `${base} (copy ${i})`;
    // Postgres has a 120-char cap on our name column via Zod; keep within it.
    if (!taken.has(candidate)) return candidate.slice(0, 120);
  }
  throw conflict(`Too many copies of "${base}"`);
}

export const POST = withStore(
  async (_req, { store, user, params }) => {
    const source = await prisma.template.findFirst({
      where: { id: params.id, storeId: store.id },
    });
    if (!source) throw notFound("Template not found");

    const created = await prisma.template.create({
      data: {
        storeId: store.id,
        name: await uniqueName(store.id, source.name),
        kind: source.kind,
        sizeInches: source.sizeInches,
        widthPx: source.widthPx,
        heightPx: source.heightPx,
        colorMode: source.colorMode,
        rotation: source.rotation,
        layout: source.layout,
        thumbnail: source.thumbnail,
      },
    });

    await recordChanges({
      storeId: store.id,
      entity: "Template",
      entityId: created.id,
      before: {},
      after: { name: created.name, duplicatedFrom: source.id },
      userId: user.id,
    });

    return ok(serializeTemplate(created), { status: 201 });
  },
  { role: "ADMIN" },
);
