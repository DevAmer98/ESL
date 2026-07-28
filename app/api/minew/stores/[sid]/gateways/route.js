// -----------------------------------------------------------------------------
// GET /api/minew/stores/:sid/gateways — live gateways for a Minew store id.
// -----------------------------------------------------------------------------
import { withAuth, ok, ApiError } from "@/lib/http";
import { accountConfig, listGatewaysFor } from "@/lib/minew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, { params }) => {
  const config = accountConfig();
  if (!config) {
    throw new ApiError(503, "not_configured", "Minew account credentials are not set.");
  }
  const gateways = await listGatewaysFor(config, params.sid);
  return ok({
    total: gateways.length,
    online: gateways.filter((g) => g.online).length,
    gateways,
  });
});
