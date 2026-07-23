// -----------------------------------------------------------------------------
// prisma/seed.js — bootstrap an owner account and a demo store.
//
// Idempotent: safe to re-run against an existing database. Credentials come
// from the environment so a production seed never plants a known password.
// -----------------------------------------------------------------------------
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const EMAIL = process.env.SEED_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.SEED_PASSWORD ?? "changeme123";
const STORE = process.env.SEED_STORE ?? "SVS Office";

const TEMPLATE_SIZES = [
  { name: "2.13\" Shelf Edge", sizeInches: 2.13, widthPx: 250, heightPx: 122, colorMode: "BWR" },
  { name: "2.9\" Shelf Edge", sizeInches: 2.9, widthPx: 296, heightPx: 128, colorMode: "BWRY" },
  { name: "3.5\" Standard", sizeInches: 3.5, widthPx: 384, heightPx: 184, colorMode: "BWR" },
  { name: "7.3\" Poster", sizeInches: 7.3, widthPx: 800, heightPx: 480, colorMode: "SEVEN_COLOR" },
];

/** A minimal but genuinely renderable layout. */
function starterLayout(w, h) {
  return {
    elements: [
      { id: "name", type: "text", x: 8, y: 8, w: w - 16, h: 28, binding: "product.name",
        fontSize: Math.round(h * 0.13), fontWeight: 700, align: "left", color: "black" },
      { id: "price", type: "text", x: 8, y: Math.round(h * 0.38), w: w - 16, h: Math.round(h * 0.34),
        binding: "product.price", fontSize: Math.round(h * 0.3), fontWeight: 800,
        align: "left", color: "red" },
      { id: "barcode", type: "barcode", x: 8, y: Math.round(h * 0.76), w: w - 16,
        h: Math.round(h * 0.18), binding: "product.sku" },
    ],
  };
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {},
    create: { email: EMAIL, passwordHash, name: "Administrator", isSuperAdmin: true },
  });

  const slug = STORE.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const store = await prisma.store.upsert({
    where: { slug },
    update: {},
    create: { name: STORE, slug, currency: "SAR", timezone: "Asia/Riyadh" },
  });

  await prisma.membership.upsert({
    where: { userId_storeId: { userId: user.id, storeId: store.id } },
    update: { role: "OWNER" },
    create: { userId: user.id, storeId: store.id, role: "OWNER" },
  });

  await prisma.storeSettings.upsert({
    where: { storeId: store.id },
    update: {},
    create: {
      storeId: store.id,
      mode: "DEMO",
      parameters: {
        lowBatteryThreshold: 20,
        offlineAfterMinutes: 60,
        pushMaxAttempts: 5,
      },
    },
  });

  for (const t of TEMPLATE_SIZES) {
    await prisma.template.upsert({
      where: { storeId_name: { storeId: store.id, name: t.name } },
      update: {},
      create: {
        storeId: store.id,
        name: t.name,
        sizeInches: t.sizeInches,
        widthPx: t.widthPx,
        heightPx: t.heightPx,
        colorMode: t.colorMode,
        layout: starterLayout(t.widthPx, t.heightPx),
      },
    });
  }

  const group = await prisma.labelGroup.upsert({
    where: { storeId_name: { storeId: store.id, name: "Default" } },
    update: {},
    create: { storeId: store.id, name: "Default", description: "Ungrouped labels" },
  });

  console.log(`✔ seeded store "${store.name}" (${store.id})`);
  console.log(`✔ owner ${EMAIL}`);
  if (PASSWORD === "changeme123") {
    console.log("⚠ using the default password — set SEED_PASSWORD before production");
  }
  console.log(`✔ ${TEMPLATE_SIZES.length} starter templates, group "${group.name}"`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
