// -----------------------------------------------------------------------------
// GET /api/minew/stores/:sid/tags — live ESL tags for a Minew store id.
// -----------------------------------------------------------------------------
import { withAuth, ok, ApiError } from "@/lib/http";
import { accountConfig, listTagsFor } from "@/lib/minew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, { params }) => {
  const config = accountConfig();
  if (!config) {
    throw new ApiError(503, "not_configured", "Minew account credentials are not set.");
  }
  const tags = await listTagsFor(config, params.sid);
  return ok({
    total: tags.length,
    online: tags.filter((t) => t.online).length,
    bound: tags.filter((t) => t.goodsId).length,
    tags,
  });
});
