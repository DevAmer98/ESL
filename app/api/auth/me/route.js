import prisma from "@/lib/prisma";
import { withAuth, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Session bootstrap for the client: who am I, and which stores can I open. */
export const GET = withAuth(async (_req, { user }) => {
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { store: true },
    orderBy: { createdAt: "asc" },
  });

  const stores = user.isSuperAdmin
    ? (await prisma.store.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }))
        .map((s) => ({ id: s.id, name: s.name, slug: s.slug, role: "OWNER" }))
    : memberships
        .filter((m) => !m.store.archivedAt)
        .map((m) => ({ id: m.store.id, name: m.store.name, slug: m.store.slug, role: m.role }));

  return ok({
    user: { id: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin },
    stores,
  });
});
