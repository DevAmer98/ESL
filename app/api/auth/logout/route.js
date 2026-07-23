import { route, noContent } from "@/lib/http";
import { destroySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async () => {
  await destroySession();
  return noContent();
});
