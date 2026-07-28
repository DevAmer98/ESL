// -----------------------------------------------------------------------------
// GET  /api/minew/stores  — every store under the Minew merchant account.
// POST /api/minew/stores  — create a Minew store { number, name, address }.
//
// Account-level (not scoped to a Frostline store): reads merchant credentials
// from the environment via accountConfig(). Any signed-in user may list;
// creating requires a super admin.
// -----------------------------------------------------------------------------
import { z } from "zod";
import { withAuth, ok, body, ApiError, forbidden } from "@/lib/http";
import { accountConfig, listStores, addStore } from "@/lib/minew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireAccount() {
  const config = accountConfig();
  if (!config) {
    throw new ApiError(
      503,
      "not_configured",
      "Minew account credentials are not set. Add MINEW_USERNAME and MINEW_PASSWORD to .env.",
    );
  }
  return config;
}

export const GET = withAuth(async (req) => {
  const config = requireAccount();
  const active = new URL(req.url).searchParams.get("active");
  const stores = await listStores(config, { active: active != null ? Number(active) : 1 });
  return ok({ total: stores.length, stores });
});

const addSchema = z.object({
  number: z.string().trim().min(1),
  name: z.string().trim().min(1),
  address: z.string().trim().min(1),
});

export const POST = withAuth(async (req, { user }) => {
  if (!user.isSuperAdmin) throw forbidden("Only a super admin can create stores");
  const config = requireAccount();
  const data = await body(req, addSchema);
  const result = await addStore(config, data);
  return ok(result, { status: 201 });
});
