import { withStore, ok } from "@/lib/http";
import { DEVICE_PRESETS, PALETTE, INK_HEX } from "@/lib/render/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The size/colour picker is driven from here rather than a constant in the
 * client, so adding a panel is a one-file change and the UI can never offer a
 * combination the validator will reject.
 */
export const GET = withStore(async () => {
  return ok({
    presets: DEVICE_PRESETS,
    palettes: PALETTE,
    inks: INK_HEX,
  });
});
