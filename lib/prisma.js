// -----------------------------------------------------------------------------
// lib/prisma.js — Prisma client singleton.
//
// Prisma 7 requires a driver adapter; we use node-postgres so the same client
// works on a long-lived server and in a serverless function with a pooler.
// The global cache keeps dev hot-reload from exhausting connections.
// -----------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function create() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "production" ? ["warn", "error"] : ["warn", "error"],
  });
}

const g = globalThis;
const prisma = g.__esl_prisma ?? (g.__esl_prisma = create());
export default prisma;
