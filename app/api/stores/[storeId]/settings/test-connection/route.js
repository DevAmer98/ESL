import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, ok, body } from "@/lib/http";
import { encrypt } from "@/lib/crypto";
import { testConnection } from "@/lib/minew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Optional overrides let the operator test credentials before saving them. */
const testSchema = z
  .object({
    mode: z.enum(["DEMO", "CLOUD", "GATEWAY"]).optional(),
    cloudUrl: z.string().trim().max(500).optional(),
    token: z.string().max(500).optional(),
  })
  .default({});

export const POST = withStore(
  async (req, { store }) => {
    // "Test" with no body means "test what is saved", so an absent body is not
    // an error — but a malformed one still is.
    const hasBody = (req.headers.get("content-length") ?? "0") !== "0";
    const overrides = hasBody ? await body(req, testSchema) : {};
    const stored = await prisma.storeSettings.findFirst({ where: { storeId: store.id } });

    // Synchronous, non-retryable and useless if deferred — one of the two
    // documented exceptions to "routes never call the adapter".
    const result = await testConnection({
      mode: overrides.mode ?? stored?.mode ?? "DEMO",
      cloudUrl: overrides.cloudUrl ?? stored?.cloudUrl ?? "",
      parameters: stored?.parameters ?? {},
      tokenCipher: overrides.token ? encrypt(overrides.token) : stored?.tokenCipher ?? null,
    });

    return ok({ ok: result.ok, detail: result.detail });
  },
  { role: "ADMIN" },
);
