// -----------------------------------------------------------------------------
// GET  /api/stores/:storeId/gateways/live  — live gateways straight from Minew.
// POST /api/stores/:storeId/gateways/live  — sync those into Frostline's table.
//
// In CLOUD mode the Minew backend is the source of truth for hardware, so rather
// than hand-entering gateways we read them from `esl/gateway/listPage` via
// fetchGatewayStates(). GET is a read-only view; POST upserts them into the local
// Gateway table (keyed by storeId+mac) so the rest of the app has rows to relate to.
// -----------------------------------------------------------------------------
import prisma from "@/lib/prisma";
import { withStore, ok } from "@/lib/http";
import { fetchGatewayStates } from "@/lib/minew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Normalise a Minew gateway record into the shape the UI expects. */
function normalize(g) {
  return {
    mac: (g.mac ?? "").toUpperCase(),
    name: g.name ?? g.mac ?? null,
    online: Number(g.mode) === 1,
    model: g.subModel ?? g.model ?? null,
    ip: g.ip ?? null,
    wifiFirmware: g.wifiVersion ?? null,
    bleFirmware: g.bleVersion ?? null,
    lastSeenAt: g.updateTime ?? null,
  };
}

export const GET = withStore(async (_req, { store }) => {
  const settings = await prisma.storeSettings.findUnique({ where: { storeId: store.id } });

  // fetchGatewayStates returns null when the store isn't in CLOUD mode.
  const raw = await fetchGatewayStates(settings);
  if (raw == null) {
    return ok({ mode: settings?.mode ?? "DEMO", gateways: [], synced: false });
  }

  const gateways = raw.map(normalize);
  return ok({
    mode: settings.mode,
    online: gateways.filter((g) => g.online).length,
    total: gateways.length,
    gateways,
  });
});

export const POST = withStore(
  async (_req, { store }) => {
    const settings = await prisma.storeSettings.findUnique({ where: { storeId: store.id } });
    const raw = await fetchGatewayStates(settings);
    if (raw == null) {
      return ok({ synced: 0, note: "Store is not in CLOUD mode; nothing to sync." });
    }

    const gateways = raw.map(normalize).filter((g) => g.mac);
    for (const g of gateways) {
      const data = {
        name: g.name ?? g.mac,
        ip: g.ip,
        model: g.model ?? "G1-E",
        wifiFirmware: g.wifiFirmware,
        bleFirmware: g.bleFirmware,
        status: g.online ? "ONLINE" : "OFFLINE",
        lastSeenAt: g.online ? new Date() : undefined,
      };
      await prisma.gateway.upsert({
        where: { storeId_mac: { storeId: store.id, mac: g.mac } },
        update: data,
        create: { storeId: store.id, mac: g.mac, ...data },
      });
    }

    return ok({ synced: gateways.length, online: gateways.filter((g) => g.online).length });
  },
  { role: "ADMIN" },
);
