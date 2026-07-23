// -----------------------------------------------------------------------------
// lib/auth.js — password + session lifecycle.
//
// Sessions are opaque random tokens in an httpOnly cookie; the DB stores only
// their SHA-256. That means a database leak cannot be replayed as a login.
// -----------------------------------------------------------------------------
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { newToken, hashToken } from "@/lib/crypto";

export const SESSION_COOKIE = "esl_session";
const SESSION_DAYS = 30;
const BCRYPT_ROUNDS = 12;

export function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/** Create a session row and set the cookie. Returns the raw token. */
export async function createSession(userId, { userAgent, ip } = {}) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);

  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt, userAgent, ip },
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

/**
 * Resolve the signed-in user from the cookie, or null.
 * Expired rows are deleted lazily on read so the table self-prunes.
 */
export async function currentUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { memberships: true } } },
  });
  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.user.disabledAt) return null;

  return session.user;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
}

/** Housekeeping — safe to call from a cron. */
export function purgeExpiredSessions() {
  return prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
