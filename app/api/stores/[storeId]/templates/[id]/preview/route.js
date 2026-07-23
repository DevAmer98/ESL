import { z } from "zod";
import prisma from "@/lib/prisma";
import { withStore, query, notFound } from "@/lib/http";
import { renderSvg } from "@/lib/render/svg";
import { buildContext, placeholderContext } from "@/lib/render/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const previewQuery = z.object({
  labelId: z.string().min(1).max(64).optional(),
  productId: z.string().min(1).max(64).optional(),
  storeId: z.string().optional(), // tolerated: withStore also accepts it as a query param
});

export const GET = withStore(async (req, { store, params }) => {
  const { labelId, productId } = query(req, previewQuery);

  const template = await prisma.template.findFirst({
    where: { id: params.id, storeId: store.id },
  });
  if (!template) throw notFound("Template not found");

  let label = null;
  let product = null;

  if (labelId) {
    label = await prisma.label.findFirst({
      where: { id: labelId, storeId: store.id },
      include: { product: true },
    });
    if (!label) throw notFound("Label not found");
    product = label.product;
  }

  if (productId) {
    product = await prisma.product.findFirst({
      where: { id: productId, storeId: store.id },
    });
    if (!product) throw notFound("Product not found");
  }

  // An unbound template still has to preview — that is the whole point during
  // authoring — so fall back to representative data rather than an empty panel.
  const context =
    label || product
      ? buildContext({ label, product, store, template })
      : placeholderContext({ store, template });

  const svg = renderSvg(template, context);

  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // Previews follow the template and the bound product, both of which the
      // user is actively editing. Never cache.
      "Cache-Control": "no-store",
    },
  });
});
