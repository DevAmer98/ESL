import prisma from "@/lib/prisma";
import { withStore, ok, body, badRequest } from "@/lib/http";
import { encrypt } from "@/lib/crypto";
import { settingsUpdateSchema, withDefaults, mergeParameters } from "@/lib/schemas/settings";
import { recordChanges } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only representation of settings that may leave the server. `tokenCipher`
 * is deliberately not spread in — a future column added to the model must be
 * opted into here rather than leaking by default.
 */
function present(settings, storeId) {
  return {
    storeId,
    mode: settings?.mode ?? "DEMO",
    cloudUrl: settings?.cloudUrl ?? "",
    gatewayIp: settings?.gatewayIp ?? "",
    tokenSet: Boolean(settings?.tokenCipher),
    parameters: withDefaults(settings?.parameters),
    updatedAt: settings?.updatedAt ?? null,
  };
}

export const GET = withStore(async (req, { store }) => {
  const settings = await prisma.storeSettings.findFirst({ where: { storeId: store.id } });
  return ok(present(settings, store.id));
});

export const PUT = withStore(
  async (req, { store, user }) => {
    const data = await body(req, settingsUpdateSchema);
    const before = await prisma.storeSettings.findFirst({ where: { storeId: store.id } });

    // Merge, don't replace: the Parameter Settings tab posts only the knobs it
    // renders, and a future tab must not blank the ones it never saw.
    const parameters = mergeParameters(before?.parameters, data.parameters);

    // defaultTemplateId is an id like any other — it must not point across tenants.
    if (data.parameters?.defaultTemplateId) {
      const template = await prisma.template.findFirst({
        where: { id: data.parameters.defaultTemplateId, storeId: store.id },
        select: { id: true },
      });
      if (!template) throw badRequest("defaultTemplateId does not belong to this store");
    }

    const fields = {
      ...(data.mode !== undefined && { mode: data.mode }),
      ...(data.cloudUrl !== undefined && { cloudUrl: data.cloudUrl }),
      ...(data.gatewayIp !== undefined && { gatewayIp: data.gatewayIp }),
      parameters,
      // Saving the form re-posts an empty token box; overwriting on empty would
      // silently disconnect the store from the vendor.
      ...(data.token ? { tokenCipher: encrypt(data.token) } : {}),
    };

    const settings = await prisma.storeSettings.upsert({
      where: { storeId: store.id },
      create: { storeId: store.id, ...fields },
      update: fields,
    });

    await recordChanges({
      storeId: store.id,
      entity: "StoreSettings",
      entityId: store.id,
      before: before && present(before, store.id),
      after: present(settings, store.id),
      userId: user.id,
    });

    return ok(present(settings, store.id));
  },
  { role: "ADMIN" },
);
