// -----------------------------------------------------------------------------
// lib/http.js — the single front door for every API route.
//
// Wrapping handlers here buys four things uniformly, so no route has to
// remember them: a stable error envelope, auth, store scoping + role checks,
// and Zod-validated bodies. A route body can then assume it is authorised and
// its input is already the right shape.
// -----------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";

/** Errors thrown with this are safe to show the client verbatim. */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (m, d) => new ApiError(400, "bad_request", m, d);
export const unauthorized = (m = "Sign in required") => new ApiError(401, "unauthorized", m);
export const forbidden = (m = "Not permitted") => new ApiError(403, "forbidden", m);
export const notFound = (m = "Not found") => new ApiError(404, "not_found", m);
export const conflict = (m, d) => new ApiError(409, "conflict", m, d);

export const ok = (data, init) => NextResponse.json(data, init);
export const noContent = () => new NextResponse(null, { status: 204 });

const ROLE_RANK = { VIEWER: 0, OPERATOR: 1, ADMIN: 2, OWNER: 3 };

function toResponse(err) {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation_failed",
          message: "Request failed validation",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 422 },
    );
  }
  // Prisma unique-constraint violation — the common one worth translating.
  if (err?.code === "P2002") {
    const fields = Array.isArray(err.meta?.target) ? err.meta.target.join(", ") : "value";
    return NextResponse.json(
      { error: { code: "conflict", message: `Duplicate ${fields}` } },
      { status: 409 },
    );
  }
  if (err?.code === "P2025") {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found" } },
      { status: 404 },
    );
  }

  console.error("[api] unhandled", err);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Something went wrong" } },
    { status: 500 },
  );
}

/**
 * Public route — no auth. Still gets the error envelope.
 * @param {(req: Request, ctx: object) => Promise<Response>} handler
 */
export function route(handler) {
  return async (req, ctx) => {
    try {
      const params = ctx?.params ? await ctx.params : {};
      return await handler(req, { ...ctx, params });
    } catch (err) {
      return toResponse(err);
    }
  };
}

/** Authenticated route with no particular store. */
export function withAuth(handler) {
  return route(async (req, ctx) => {
    const user = await currentUser();
    if (!user) throw unauthorized();
    return handler(req, { ...ctx, user });
  });
}

/**
 * Authenticated + scoped to the store in the path (`/api/stores/[storeId]/…`)
 * or the `storeId` query param. Rejects unless the user's role meets `role`.
 *
 * Hands the handler `{ user, store, role, params }` — every downstream query
 * must still filter on `store.id`; this only proves the user may be here.
 */
export function withStore(handler, { role = "VIEWER" } = {}) {
  return withAuth(async (req, ctx) => {
    const storeId =
      ctx.params?.storeId ?? new URL(req.url).searchParams.get("storeId");
    if (!storeId) throw badRequest("storeId is required");

    const store = await prisma.store.findFirst({
      where: { id: storeId, archivedAt: null },
    });
    if (!store) throw notFound("Store not found");

    const membership = ctx.user.memberships?.find((m) => m.storeId === storeId);
    const effectiveRole = ctx.user.isSuperAdmin ? "OWNER" : membership?.role;
    if (!effectiveRole) throw forbidden("You do not have access to this store");
    if (ROLE_RANK[effectiveRole] < ROLE_RANK[role]) {
      throw forbidden(`Requires ${role.toLowerCase()} access`);
    }

    return handler(req, { ...ctx, store, role: effectiveRole });
  });
}

/** Parse + validate a JSON body against a Zod schema. */
export async function body(req, schema) {
  let raw;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Body must be valid JSON");
  }
  return schema.parse(raw);
}

/** Parse + validate the query string against a Zod schema. */
export function query(req, schema) {
  const sp = new URL(req.url).searchParams;
  return schema.parse(Object.fromEntries(sp.entries()));
}
