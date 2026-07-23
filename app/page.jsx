import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Root is a router, not a screen: land people wherever they can actually work. */
export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const stores = user.isSuperAdmin
    ? await prisma.store.findMany({ where: { archivedAt: null }, take: 2 })
    : await prisma.store.findMany({
        where: { archivedAt: null, memberships: { some: { userId: user.id } } },
        take: 2,
      });

  if (stores.length === 1) redirect(`/stores/${stores[0].id}`);
  redirect("/stores");
}
