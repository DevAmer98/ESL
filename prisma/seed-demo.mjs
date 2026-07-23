// -----------------------------------------------------------------------------
// prisma/seed-demo.mjs — volume for the Statistical Analysis screens.
//
// prisma/seed.mjs bootstraps an account; this generates the *history* the charts
// need to be worth looking at. Empty charts hide bugs — a p95 computed over four
// rows looks fine no matter how wrong the query is.
//
// DESTRUCTIVE, by design and only within its own blast radius: it deletes this
// store's operation records, offline history, data changes, deletion logs,
// sensor readings and push jobs, plus the demo products/labels/groups/gateways
// it created on a previous run (all prefixed DEMO-), then regenerates them.
// Re-running is therefore safe and produces a comparable dataset; it will not
// touch rows you created by hand under different names.
//
//   npm run db:seed:demo
// -----------------------------------------------------------------------------
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const STORE_SLUG = process.env.SEED_STORE_SLUG ?? null;
const PRODUCTS = 40;
const LABELS = 60;
const OPERATIONS = 2000;
const READINGS = 5000;
const DAYS = 30;
const SUCCESS_RATE = 0.85;

const DAY_MS = 86_400_000;

// Deterministic PRNG: two runs produce the same shape, so "the p95 moved" is a
// signal about the code rather than about the dice.
let seed = 0x5eed1234;
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));

/** Box–Muller, so durations can be log-normal rather than uniformly fake. */
function gauss() {
  const u = Math.max(rnd(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}
/** ~350 ms median with a long right tail — what flaky BLE actually looks like. */
const duration = () => Math.max(40, Math.round(Math.exp(5.9 + 0.75 * gauss())));

const GROUPS = ["Produce", "Bakery", "Frozen"];
const BRANDS = ["Almarai", "Nadec", "Sadia", "Nestlé", "Goody", "Sunbulah"];
const UNITS = ["ea", "kg", "pack", "box"];
const NOUNS = [
  "Milk", "Yoghurt", "Labneh", "Chicken", "Rice", "Dates", "Olive Oil", "Tahini",
  "Cheese", "Butter", "Juice", "Water", "Bread", "Croissant", "Cake", "Ice Cream",
  "Peas", "Corn", "Fries", "Berries",
];
const SIZES = ["200g", "500g", "1kg", "1.5L", "2L", "6-pack"];

const mac = (i) => `DEMO-${i.toString(16).padStart(8, "0").toUpperCase().match(/.{2}/g).join(":")}`;

async function main() {
  const store = STORE_SLUG
    ? await prisma.store.findUnique({ where: { slug: STORE_SLUG } })
    : await prisma.store.findFirst({ where: { archivedAt: null }, orderBy: { createdAt: "asc" } });

  if (!store) throw new Error("No store found — run `npm run db:seed` first.");
  console.log(`▸ seeding demo data into "${store.name}" (${store.id}, tz ${store.timezone})`);

  // -------------------------------- wipe -------------------------------------
  await prisma.$transaction([
    prisma.operationRecord.deleteMany({ where: { storeId: store.id } }),
    prisma.offlineHistory.deleteMany({ where: { storeId: store.id } }),
    prisma.dataChange.deleteMany({ where: { storeId: store.id } }),
    prisma.deletionLog.deleteMany({ where: { storeId: store.id } }),
    prisma.sensorReading.deleteMany({ where: { storeId: store.id } }),
    prisma.pushJob.deleteMany({ where: { storeId: store.id } }),
    prisma.label.deleteMany({ where: { storeId: store.id, mac: { startsWith: "DEMO-" } } }),
    prisma.product.deleteMany({ where: { storeId: store.id, code: { startsWith: "DEMO" } } }),
    prisma.gateway.deleteMany({ where: { storeId: store.id, mac: { startsWith: "DEMO-" } } }),
  ]);

  const now = Date.now();
  const templates = await prisma.template.findMany({ where: { storeId: store.id } });

  // ------------------------------ groups -------------------------------------
  const groups = [];
  for (const [i, name] of GROUPS.entries()) {
    groups.push(
      await prisma.labelGroup.upsert({
        where: { storeId_name: { storeId: store.id, name } },
        update: {},
        create: { storeId: store.id, name, sortOrder: i, description: `${name} aisle` },
      }),
    );
  }

  // ----------------------------- gateways ------------------------------------
  const gateways = [];
  for (let i = 0; i < 2; i++) {
    gateways.push(
      await prisma.gateway.create({
        data: {
          storeId: store.id,
          name: `Ceiling GW ${i + 1}`,
          mac: mac(0xa0000000 + i),
          ip: `10.20.0.${11 + i}`,
          model: "G1-E",
          wifiFirmware: "1.4.2",
          bleFirmware: "2.0.7",
          bleModules: 4,
          status: i === 0 ? "ONLINE" : "OFFLINE",
          lastSeenAt: new Date(now - (i === 0 ? 60_000 : 3 * 3600_000)),
        },
      }),
    );
  }

  // ----------------------------- products ------------------------------------
  const products = [];
  for (let i = 0; i < PRODUCTS; i++) {
    const name = `${pick(BRANDS)} ${pick(NOUNS)} ${pick(SIZES)}`;
    products.push(
      await prisma.product.create({
        data: {
          storeId: store.id,
          code: `DEMO${(1000 + i).toString()}`,
          name,
          specification: pick(SIZES),
          unit: pick(UNITS),
          priceCents: int(199, 8999),
          memberPriceCents: rnd() < 0.4 ? int(150, 8000) : null,
          brand: name.split(" ")[0],
          origin: pick(["KSA", "Brazil", "France", "Türkiye", "Egypt"]),
          sku: `SKU${(100000 + i).toString()}`,
          createdAt: new Date(now - int(30, 180) * DAY_MS),
        },
      }),
    );
  }

  // ------------------------------ labels -------------------------------------
  const labels = [];
  for (let i = 0; i < LABELS; i++) {
    const online = rnd() < 0.8;
    const battery = rnd() < 0.15 ? int(3, 19) : int(21, 100);
    const lastBroadcastAt = new Date(now - (online ? int(1, 50) : int(90, 4000)) * 60_000);
    labels.push(
      await prisma.label.create({
        data: {
          storeId: store.id,
          mac: mac(i + 1),
          model: pick(["DS026F", "DS029F", "DS035F"]),
          sizeInches: pick([2.13, 2.9, 3.5]),
          battery,
          rssi: -int(45, 92),
          status: online ? "ONLINE" : "OFFLINE",
          productId: products[i % products.length].id,
          templateId: templates.length ? pick(templates).id : null,
          gatewayId: pick(gateways).id,
          groupId: groups[i % groups.length].id,
          lastBroadcastAt,
          lastUpdateAt: lastBroadcastAt,
          createdAt: new Date(now - int(20, 120) * DAY_MS),
        },
      }),
    );
  }

  // -------------------------- operation records ------------------------------
  // Weighted so PUSH dominates, as it does in a real store, and weekday daytime
  // is busier than 3am — otherwise Traffic Analytics is a flat line.
  const TYPES = [
    ...Array(55).fill("PUSH"),
    ...Array(15).fill("REFRESH"),
    ...Array(10).fill("SCHEDULED_PUSH"),
    ...Array(6).fill("BIND"),
    ...Array(4).fill("UNBIND"),
    ...Array(4).fill("LED_FLASH"),
    ...Array(3).fill("IMPORT"),
    ...Array(2).fill("REBOOT"),
    ...Array(1).fill("FIRMWARE_UPDATE"),
  ];
  const FAILURES = [
    "Gateway did not acknowledge within 8000ms",
    "Label out of range (rssi -97)",
    "Vendor returned 503 Service Unavailable",
    "Image payload rejected: unsupported colour mode",
    "Battery too low to accept a refresh",
  ];

  const operations = [];
  for (let i = 0; i < OPERATIONS; i++) {
    const label = pick(labels);
    const group = groups.find((g) => g.id === label.groupId);
    const daysAgo = rnd() * DAYS;
    // Bias the hour of day toward trading hours.
    const hour = pick([7, 8, 9, 10, 10, 11, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 2]);
    const at = new Date(now - daysAgo * DAY_MS);
    at.setUTCHours(hour, int(0, 59), int(0, 59), 0);
    // Pinning the hour can push a "few minutes ago" record into the future,
    // which would sit outside every window the UI asks for.
    if (at.getTime() > now) at.setTime(at.getTime() - DAY_MS);

    const success = rnd() < SUCCESS_RATE;
    operations.push({
      storeId: store.id,
      labelId: label.id,
      mac: label.mac,
      groupName: group?.name ?? null,
      operationType: pick(TYPES),
      result: success ? "SUCCESS" : "FAILURE",
      detail: success ? "Delivered" : pick(FAILURES),
      // Failures are slow: they are usually a timeout, not a fast rejection.
      durationMs: success ? duration() : duration() + int(1500, 9000),
      snapshot: {},
      createdAt: at,
    });
  }
  // A handful still in flight, so the PENDING branch of every aggregate is hit.
  for (let i = 0; i < 12; i++) {
    const label = pick(labels);
    operations.push({
      storeId: store.id,
      labelId: label.id,
      mac: label.mac,
      groupName: null,
      operationType: "PUSH",
      result: "PENDING",
      detail: "Queued",
      durationMs: null,
      snapshot: {},
      createdAt: new Date(now - int(1, 30) * 60_000),
    });
  }
  await prisma.operationRecord.createMany({ data: operations });

  // ---------------------------- offline history -------------------------------
  const incidents = [];
  for (let i = 0; i < 45; i++) {
    const label = pick(labels);
    const offlineAt = new Date(now - rnd() * DAYS * DAY_MS);
    const durationSec = int(300, 36 * 3600);
    const stillOpen = i < 4; // a few unresolved, so `openIncidents` is non-zero
    incidents.push({
      storeId: store.id,
      deviceType: "LABEL",
      deviceId: label.id,
      mac: label.mac,
      offlineAt,
      onlineAt: stillOpen ? null : new Date(offlineAt.getTime() + durationSec * 1000),
      durationSec: stillOpen ? null : durationSec,
    });
  }
  for (let i = 0; i < 5; i++) {
    const gw = pick(gateways);
    const offlineAt = new Date(now - rnd() * DAYS * DAY_MS);
    const durationSec = int(600, 6 * 3600);
    incidents.push({
      storeId: store.id,
      deviceType: "GATEWAY",
      deviceId: gw.id,
      mac: gw.mac,
      offlineAt,
      onlineAt: new Date(offlineAt.getTime() + durationSec * 1000),
      durationSec,
    });
  }
  await prisma.offlineHistory.createMany({ data: incidents });

  // ------------------------------ data changes --------------------------------
  const changes = [];
  for (let i = 0; i < 300; i++) {
    const p = pick(products);
    const field = pick(["priceCents", "name", "memberPriceCents", "specification", "origin"]);
    const oldValue = field.endsWith("Cents") ? String(int(199, 8999)) : `${pick(NOUNS)} ${pick(SIZES)}`;
    const newValue = field.endsWith("Cents") ? String(int(199, 8999)) : `${pick(NOUNS)} ${pick(SIZES)}`;
    changes.push({
      storeId: store.id,
      entity: "Product",
      entityId: p.id,
      field,
      oldValue,
      newValue,
      createdAt: new Date(now - rnd() * DAYS * DAY_MS),
    });
  }
  for (let i = 0; i < 60; i++) {
    const l = pick(labels);
    changes.push({
      storeId: store.id,
      entity: "Label",
      entityId: l.id,
      field: pick(["productId", "templateId", "groupId"]),
      oldValue: null,
      newValue: pick(products).id,
      createdAt: new Date(now - rnd() * DAYS * DAY_MS),
    });
  }
  await prisma.dataChange.createMany({ data: changes });

  // ------------------------------ deletion log --------------------------------
  const deletions = [];
  for (let i = 0; i < 25; i++) {
    deletions.push({
      storeId: store.id,
      entity: pick(["Product", "Label", "Template", "LabelGroup"]),
      entityId: `deleted-${i}`,
      snapshot: { code: `DEMO9${i}`, name: `${pick(BRANDS)} ${pick(NOUNS)}`, priceCents: int(199, 5999) },
      createdAt: new Date(now - rnd() * DAYS * DAY_MS),
    });
  }
  await prisma.deletionLog.createMany({ data: deletions });

  // ----------------------------- sensor readings ------------------------------
  // Only a subset of tags carry a sensor, and each keeps its own baseline so the
  // per-label latest table shows a plausible spread rather than one number.
  const sensorLabels = labels.slice(0, 20);
  const baselines = sensorLabels.map((l, i) => ({
    label: l,
    // Frozen aisle tags sit well below ambient.
    temp: i % 4 === 0 ? -18 + rnd() * 3 : 19 + rnd() * 5,
    hum: 35 + rnd() * 25,
  }));

  const readings = [];
  for (let i = 0; i < READINGS; i++) {
    const b = pick(baselines);
    const at = new Date(now - rnd() * 7 * DAY_MS);
    // Diurnal swing plus noise.
    const hourOfDay = at.getUTCHours();
    const swing = Math.sin(((hourOfDay - 5) / 24) * 2 * Math.PI) * 1.8;
    readings.push({
      storeId: store.id,
      labelId: b.label.id,
      temperature: Number((b.temp + swing + gauss() * 0.4).toFixed(2)),
      humidity: Number(Math.min(99, Math.max(5, b.hum + gauss() * 3)).toFixed(2)),
      recordedAt: at,
    });
  }
  // Guarantee every sensor label has a very recent reading for the "latest" panel.
  for (const b of baselines) {
    readings.push({
      storeId: store.id,
      labelId: b.label.id,
      temperature: Number((b.temp + gauss() * 0.3).toFixed(2)),
      humidity: Number(Math.min(99, Math.max(5, b.hum + gauss() * 2)).toFixed(2)),
      recordedAt: new Date(now - int(1, 20) * 60_000),
    });
  }
  for (let i = 0; i < readings.length; i += 1000) {
    await prisma.sensorReading.createMany({ data: readings.slice(i, i + 1000) });
  }

  // -------------------------------- push jobs ---------------------------------
  const jobs = [];
  for (let i = 0; i < 30; i++) {
    const label = pick(labels);
    const status = pick(["QUEUED", "QUEUED", "SUCCEEDED", "SUCCEEDED", "FAILED", "DEAD"]);
    jobs.push({
      storeId: store.id,
      labelId: label.id,
      status,
      attempts: status === "DEAD" ? 5 : int(0, 3),
      runAt: new Date(now - int(0, 120) * 60_000),
      lastError: status === "FAILED" || status === "DEAD" ? pick(FAILURES) : null,
      payload: { reason: "PUSH" },
      createdAt: new Date(now - int(0, 240) * 60_000),
    });
  }
  await prisma.pushJob.createMany({ data: jobs });

  const succeeded = operations.filter((o) => o.result === "SUCCESS").length;
  console.log(`✔ ${products.length} products, ${labels.length} labels, ${gateways.length} gateways`);
  console.log(`✔ ${operations.length} operation records (${succeeded} success, over ${DAYS} days)`);
  console.log(`✔ ${incidents.length} offline incidents, ${changes.length} data changes, ${deletions.length} deletions`);
  console.log(`✔ ${readings.length} sensor readings, ${jobs.length} push jobs`);
  console.log(`▸ store id for API calls: ${store.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
