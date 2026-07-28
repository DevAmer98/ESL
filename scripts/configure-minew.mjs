// -----------------------------------------------------------------------------
// scripts/configure-minew.mjs — point a Frostline store at a Minew ESL Cloud v3
// backend (CLOUD mode), until the settings UI grows these fields.
//
// Usage (from the project root, with .env present):
//   MINEW_USERNAME='SVS Testing' \
//   MINEW_PASSWORD='your-minew-password' \
//   MINEW_STORE_ID='2046512742964830208' \
//   MINEW_URL='https://esl.smartvisionss.com:9443' \
//   node scripts/configure-minew.mjs
//
// Optional: STORE_SLUG='svs-office' to target a specific Frostline store
// (defaults to the first/only store).
//
// It encrypts the Minew password with ENCRYPTION_KEY exactly like lib/crypto.js,
// stores it in StoreSettings.tokenCipher, and puts minewUsername/minewStoreId in
// StoreSettings.parameters. Safe to re-run.
// -----------------------------------------------------------------------------
import "dotenv/config";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// --- mirror of lib/crypto.js encrypt() so this runs without the @ alias -------
function key() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  return Buffer.byteLength(raw) === 32
    ? Buffer.from(raw)
    : crypto.createHash("sha256").update(raw).digest();
}
function encrypt(plain) {
  if (plain == null || plain === "") return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main() {
  const username = requireEnv("MINEW_USERNAME");
  const password = requireEnv("MINEW_PASSWORD");
  const minewStoreId = requireEnv("MINEW_STORE_ID");
  const cloudUrl = process.env.MINEW_URL ?? "https://esl.smartvisionss.com:9443";

  const store = process.env.STORE_SLUG
    ? await prisma.store.findUnique({ where: { slug: process.env.STORE_SLUG } })
    : await prisma.store.findFirst({ orderBy: { createdAt: "asc" } });
  if (!store) throw new Error("No Frostline store found (seed one first, or set STORE_SLUG)");

  const existing = await prisma.storeSettings.findUnique({ where: { storeId: store.id } });
  const parameters = { ...(existing?.parameters ?? {}), minewUsername: username, minewStoreId };

  await prisma.storeSettings.upsert({
    where: { storeId: store.id },
    update: { mode: "CLOUD", cloudUrl, tokenCipher: encrypt(password), parameters },
    create: {
      storeId: store.id,
      mode: "CLOUD",
      cloudUrl,
      tokenCipher: encrypt(password),
      parameters,
    },
  });

  console.log(`✔ ${store.name} (${store.id}) -> CLOUD`);
  console.log(`  cloudUrl      = ${cloudUrl}`);
  console.log(`  minewUsername = ${username}`);
  console.log(`  minewStoreId  = ${minewStoreId}`);
  console.log(`  password      = (encrypted in tokenCipher)`);
  console.log("Now use Settings -> Integration -> Test Connection in the app.");
}

main()
  .catch((e) => {
    console.error("✗", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
