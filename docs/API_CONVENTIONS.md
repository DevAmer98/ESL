# API conventions

Every route in this app follows the same handful of rules. They exist so that
reading one route tells you how all the others behave.

## Route shape

All store-scoped endpoints live under `app/api/stores/[storeId]/…` and are
wrapped by a guard from `lib/http.js`:

```js
import { withStore, ok, body, notFound } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withStore(async (req, { store, user, role, params }) => {
  …
}); // defaults to VIEWER

export const POST = withStore(handler, { role: "OPERATOR" });
export const DELETE = withStore(handler, { role: "ADMIN" });
```

`withStore` has already proved the user may act on this store at that role.
It has **not** filtered any query for you.

## The one non-negotiable rule

> Every Prisma query must constrain `storeId`.

Use `findFirst({ where: { id, storeId: store.id } })` — never `findUnique({ where: { id } })`
for a tenant-owned row. A `findUnique` by primary key will happily return
another tenant's record. Same for `update`/`delete`: read-then-write scoped, or
use `updateMany`/`deleteMany` with `storeId` in the filter.

## Role floors

| Action | Role |
|---|---|
| Read anything | `VIEWER` |
| Push, refresh, bind, LED, import | `OPERATOR` |
| Create/edit/delete records, settings | `ADMIN` |
| Store + membership management | `OWNER` |

## Errors

Throw, don't hand-build responses. `lib/http.js` exports `badRequest`,
`unauthorized`, `forbidden`, `notFound`, `conflict`, and the `ApiError` class.
Zod errors and Prisma `P2002`/`P2025` are translated automatically.

Every error response is `{ error: { code, message, details? } }`.

## Validation

Bodies and query strings are parsed with Zod, never read raw:

```js
const data = await body(req, createSchema);   // throws → 422 envelope
const params = query(req, listQuerySchema);
```

Keep the schema next to the route it validates unless two routes share it, in
which case put it in `lib/schemas/<entity>.js`.

## List endpoints

Use the primitives in `lib/query.js` — do not hand-roll pagination:

```js
const params = query(req, listQuerySchema.extend({ status: z.string().optional() }));
const where = {
  storeId: store.id,
  ...search(params.q, ["name", "code", "sku"]),
  ...(params.status && { status: params.status }),
};
const [items, total] = await Promise.all([
  prisma.product.findMany({ where, ...paginate(params, SORTABLE, "updatedAt") }),
  prisma.product.count({ where }),
]);
return ok(page(items, total, params));
```

`paginate` enforces a sort allow-list; passing an unlisted column is a 400, so a
query param can never reach the DB as an arbitrary identifier.

Response envelope: `{ items, page, pageSize, total, totalPages }`.

## Money

Stored as integer minor units in `priceCents` / `memberPriceCents`. Never floats,
never `Decimal` for currency. Convert at the edges only.

## Auditing

Mutations record history — failures here are swallowed and must never fail the
user's operation:

```js
await recordChanges({ storeId, entity: "Product", entityId: id, before, after, userId: user.id });
await recordDeletion({ storeId, entity: "Product", entityId: id, snapshot: before, userId: user.id });
```

Hardware operations additionally call `recordOperation(...)` — but note the push
queue already does this for pushes. Don't double-record.

## Hardware

Never call `lib/minew.js` from a route. Routes enqueue:

```js
await enqueuePush({ storeId: store.id, labelIds, operatorId: user.id });
```

The queue owns delivery, retries, backoff, label status and the operation
record. The only exceptions are genuinely synchronous, non-retryable actions
(LED flash, connection test), which may call the adapter directly.

## CSV

`lib/csv.js` gives you `parseCsv(text, rowSchema)` → `{ rows, errors }` with
1-based line numbers, plus `toCsv(rows, columns)` and `csvResponse(csv, name)`.
Import is row-tolerant on purpose: report bad rows, commit the good ones, and
return `{ imported, failed, errors }`.

## Dates

Store UTC. `listQuerySchema` already coerces `from`/`to`; use
`dateRange("createdAt", from, to)`.
