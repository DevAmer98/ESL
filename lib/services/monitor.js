// -----------------------------------------------------------------------------
// lib/services/monitor.js — liveness reconciliation.
//
// Nothing pushes us a "device went away" event: a tag that runs out of battery
// simply stops broadcasting. So the analytics tabs are only truthful if someone
// periodically compares lastBroadcastAt against the store's offline threshold
// and writes the transition down. That someone is this file, called every
// worker tick.
//
// Idempotence is the whole design constraint. A tick that runs every five
// seconds must never open a second incident for a device that already has one
// open, or the Offline History tab fills with duplicates and the downtime
// totals inflate. Every write here is therefore conditional on the *current*
// state, and incidents are opened only for devices with no open row.
// -----------------------------------------------------------------------------
import prisma from "@/lib/prisma";
import { storeParameters } from "@/lib/stats";

/** Statuses that mean "we believe this device is reachable". */
const LIVE_LABEL = ["ONLINE", "BROADCASTING"];

const seconds = (from, to) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));

/**
 * Flip stale devices to OFFLINE and open/close OfflineHistory to match.
 * Safe to call concurrently and repeatedly.
 *
 * @returns counts of what actually changed, for the worker log
 */
export async function reconcileOfflineState({ storeId, now = new Date() }) {
  const { offlineAfterMinutes } = await storeParameters(storeId);
  const cutoff = new Date(now.getTime() - offlineAfterMinutes * 60_000);

  const open = await prisma.offlineHistory.findMany({
    where: { storeId, onlineAt: null },
    select: { id: true, deviceType: true, deviceId: true, offlineAt: true },
  });
  const openBy = new Map(open.map((o) => [`${o.deviceType}:${o.deviceId}`, o]));

  const result = { labelsOffline: 0, gatewaysOffline: 0, closed: 0 };

  // ------------------------------- labels ------------------------------------
  const staleLabels = await prisma.label.findMany({
    where: {
      storeId,
      status: { in: LIVE_LABEL },
      OR: [
        { lastBroadcastAt: { lt: cutoff } },
        // Never heard from and old enough to count: a tag registered an hour ago
        // that has still said nothing is offline, not merely new.
        { lastBroadcastAt: null, createdAt: { lt: cutoff } },
      ],
    },
    select: { id: true, mac: true, lastBroadcastAt: true },
  });

  for (const label of staleLabels) {
    // Scoped to the live statuses again so a concurrent push that just brought
    // the tag back cannot be stomped by this tick's stale read.
    const flipped = await prisma.label.updateMany({
      where: { id: label.id, storeId, status: { in: LIVE_LABEL } },
      data: { status: "OFFLINE" },
    });
    if (!flipped.count) continue;
    result.labelsOffline += flipped.count;

    if (openBy.has(`LABEL:${label.id}`)) continue; // already recorded
    await prisma.offlineHistory.create({
      data: {
        storeId,
        deviceType: "LABEL",
        deviceId: label.id,
        mac: label.mac,
        offlineAt: label.lastBroadcastAt ?? now,
      },
    });
    openBy.set(`LABEL:${label.id}`, { deviceId: label.id });
  }

  // ------------------------------ gateways -----------------------------------
  const staleGateways = await prisma.gateway.findMany({
    where: {
      storeId,
      status: "ONLINE",
      OR: [
        { lastSeenAt: { lt: cutoff } },
        { lastSeenAt: null, createdAt: { lt: cutoff } },
      ],
    },
    select: { id: true, mac: true, lastSeenAt: true },
  });

  for (const gateway of staleGateways) {
    const flipped = await prisma.gateway.updateMany({
      where: { id: gateway.id, storeId, status: "ONLINE" },
      data: { status: "OFFLINE" },
    });
    if (!flipped.count) continue;
    result.gatewaysOffline += flipped.count;

    if (openBy.has(`GATEWAY:${gateway.id}`)) continue;
    await prisma.offlineHistory.create({
      data: {
        storeId,
        deviceType: "GATEWAY",
        deviceId: gateway.id,
        mac: gateway.mac,
        offlineAt: gateway.lastSeenAt ?? now,
      },
    });
  }

  // ------------------------- close recovered incidents ------------------------
  // A device that spoke again after its incident opened is back; close the row
  // so the tab stops counting it as still-down.
  if (open.length) {
    const labelIds = open.filter((o) => o.deviceType === "LABEL").map((o) => o.deviceId);
    const gatewayIds = open.filter((o) => o.deviceType === "GATEWAY").map((o) => o.deviceId);

    const [labels, gateways] = await Promise.all([
      labelIds.length
        ? prisma.label.findMany({
            where: { id: { in: labelIds }, storeId },
            select: { id: true, lastBroadcastAt: true },
          })
        : [],
      gatewayIds.length
        ? prisma.gateway.findMany({
            where: { id: { in: gatewayIds }, storeId },
            select: { id: true, lastSeenAt: true },
          })
        : [],
    ]);

    const seenAt = new Map([
      ...labels.map((l) => [`LABEL:${l.id}`, l.lastBroadcastAt]),
      ...gateways.map((g) => [`GATEWAY:${g.id}`, g.lastSeenAt]),
    ]);

    for (const incident of open) {
      const last = seenAt.get(`${incident.deviceType}:${incident.deviceId}`);
      if (!last || last <= incident.offlineAt || last < cutoff) continue;

      // updateMany with onlineAt still null: whichever tick gets there first
      // closes it, the loser writes nothing.
      const closed = await prisma.offlineHistory.updateMany({
        where: { id: incident.id, storeId, onlineAt: null },
        data: { onlineAt: last, durationSec: seconds(incident.offlineAt, last) },
      });
      result.closed += closed.count;
    }
  }

  return result;
}

/** Reconcile every store that is still active. */
export async function reconcileAllStores() {
  const stores = await prisma.store.findMany({
    where: { archivedAt: null },
    select: { id: true },
  });

  const totals = { stores: 0, labelsOffline: 0, gatewaysOffline: 0, closed: 0 };
  for (const store of stores) {
    // One bad store must not stop the rest of the fleet being reconciled.
    try {
      const r = await reconcileOfflineState({ storeId: store.id });
      totals.stores++;
      totals.labelsOffline += r.labelsOffline;
      totals.gatewaysOffline += r.gatewaysOffline;
      totals.closed += r.closed;
    } catch (err) {
      console.error(`[monitor] store ${store.id} failed`, err);
    }
  }
  return totals;
}
