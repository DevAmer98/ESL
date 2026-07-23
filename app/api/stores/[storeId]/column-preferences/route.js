import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, body, query } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const configSchema = z.object({
  visible: z.array(z.string().max(64)).max(200).optional(),
  order: z.array(z.string().max(64)).max(200).optional(),
  widths: z.record(z.string(), z.coerce.number().int().min(0).max(2000)).optional(),
});

const getSchema = z.object({ tableKey: z.string().trim().min(1).max(64).optional() });

const putSchema = z.object({
  tableKey: z.string().trim().min(1).max(64),
  config: configSchema,
});

// A column layout is the user's own view of the store, not store data, so the
// VIEWER floor is right even for the write: nobody else's rows can be reached.
export const GET = withStore(async (req, { store, user }) => {
  const { tableKey } = query(req, getSchema);

  if (!tableKey) {
    const items = await prisma.columnPreference.findMany({
      where: { userId: user.id, storeId: store.id },
    });
    return ok({ items });
  }

  const pref = await prisma.columnPreference.findFirst({
    where: { userId: user.id, storeId: store.id, tableKey },
  });
  // Absence is normal — the table renders its defaults.
  return ok(pref ?? { userId: user.id, storeId: store.id, tableKey, config: {} });
});

export const PUT = withStore(async (req, { store, user }) => {
  const { tableKey, config } = await body(req, putSchema);

  const pref = await prisma.columnPreference.upsert({
    where: { userId_storeId_tableKey: { userId: user.id, storeId: store.id, tableKey } },
    create: { userId: user.id, storeId: store.id, tableKey, config },
    update: { config },
  });

  return ok(pref);
});
