import { z } from "zod";
import prisma from "@/lib/prisma";
import { route, body, ok, unauthorized, ApiError } from "@/lib/http";
import { verifyPassword, createSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

/**
 * Failed attempts are counted in-memory per email+IP. It resets on restart,
 * which is fine — it exists to blunt online guessing, not to be a rate limiter
 * of record. Put a real one at the edge in front of this in production.
 */
const attempts = new Map();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

function tooMany(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}

function note(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
  } else {
    rec.count++;
  }
}

export const POST = route(async (req) => {
  const { email, password } = await body(req, schema);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const key = `${email}|${ip ?? "-"}`;

  if (tooMany(key)) {
    throw new ApiError(429, "rate_limited", "Too many attempts. Try again later.");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: { include: { store: true } } },
  });

  // Always run a comparison so a missing account and a wrong password take
  // indistinguishable time.
  const hash = user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
  const valid = await verifyPassword(password, hash);

  if (!user || !valid || user.disabledAt) {
    note(key);
    throw unauthorized("Incorrect email or password");
  }

  attempts.delete(key);

  await createSession(user.id, {
    userAgent: req.headers.get("user-agent") ?? undefined,
    ip: ip ?? undefined,
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return ok({
    user: { id: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin },
    stores: user.memberships.map((m) => ({
      id: m.store.id,
      name: m.store.name,
      slug: m.store.slug,
      role: m.role,
    })),
  });
});
