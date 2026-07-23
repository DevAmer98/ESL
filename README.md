# Frostline — ESL console

A multi-store management console for **Minew** electronic shelf labels driven
through **G1-E** gateways. One Next.js app: React console, App-Router API,
Postgres via Prisma, and a single isolated hardware adapter.

The vendor API token is encrypted at rest and never reaches the browser.

## What it does

| Area | Capability |
|---|---|
| **Overview** | Fleet health, refresh success/failure, weekly update chart, queue depth |
| **Store Data** | Product catalogue — search, sort, paginate, CSV import/export, bulk delete, custom columns |
| **Templates** | Multi-size / multi-colour-mode label templates with a live SVG renderer and previews |
| **Gateways** | Registration, firmware versions, status, reboot, CSV import |
| **Devices** | Labels — binding, grouping, batch refresh, battery/RSSI, import/export |
| **Store Settings** | Label groups, tunable parameters, scheduled updates (cron), template strategies, media library |
| **Statistical Analysis** | Operation record, update performance (p50/p95), offline history, data changes, deletion log, traffic, temperature/humidity |

Cross-cutting: email/password auth with sessions, per-store roles
(owner/admin/operator/viewer), full multi-tenancy, a durable push queue with
retry + backoff, and an audit trail behind every mutation.

## Run it

Requires **Node 20+** and **Postgres 14+**.

```bash
cp .env.example .env          # then set DATABASE_URL and ENCRYPTION_KEY
npm install
npm run db:migrate            # create the schema
npm run db:seed               # owner account + demo store + starter templates
npm run dev                   # http://localhost:3000
```

Seed credentials come from `SEED_EMAIL` / `SEED_PASSWORD`. If you leave
`SEED_PASSWORD` empty it falls back to `changeme123` and warns — fine locally,
never in production.

Optional: `npm run db:seed:demo` generates ~30 days of realistic operational
history so the analytics screens have something to show.

### With Docker

```bash
ENCRYPTION_KEY=$(openssl rand -base64 32) docker compose up --build
```

## Architecture

```
app/
  login/                      sign-in
  stores/[storeId]/           the console — one route per screen
  api/
    auth/                     login · logout · me
    jobs/tick                 external cron entry point
    stores/[storeId]/         every store-scoped resource
lib/
  prisma.js    db client        http.js     route guards + error envelope
  auth.js      sessions         query.js    pagination/search/sort primitives
  crypto.js    AES-GCM + hash   csv.js      import/export
  audit.js     change history   queue.js    durable push outbox
  worker.js    background tick  minew.js    <- the ONLY hardware-facing code
  render/      template → SVG   services/   schedules · strategies · monitoring
  schemas/     Zod validation   client/     browser API client + list hook
components/    UI kit, DataTable, charts, session context
prisma/        schema · migrations · seeds
```

Two rules hold the backend together, both documented in
[docs/API_CONVENTIONS.md](docs/API_CONVENTIONS.md):

1. **Every query constrains `storeId`.** Tenancy is not optional and not
   inherited — `withStore()` proves the user may be here, it does not filter
   your query for you.
2. **Routes never call the hardware.** They enqueue; `lib/queue.js` owns
   delivery, retries, label status and the operation record. That is why the
   statistics are trustworthy and a 500-tag refresh doesn't live inside an HTTP
   request.

## Wiring real hardware

Set **Store Settings → Integration** to `CLOUD` and supply your MinewTag ESL
Cloud URL and API token, then use *Test connection*.

Endpoint paths default to the values in `DEFAULT_PATHS` at the top of
`lib/minew.js`. Self-hosted ESL Cloud deployments differ by version, so if
yours uses different paths, override them per store without touching code via
`settings.parameters.minewPaths`:

```json
{ "minewPaths": { "refresh": "/apis/esl/label/refresh" } }
```

Until a token is set, the app runs in **demo mode** — the full queue, status
and statistics pipeline exercises end to end without hardware.

Direct-to-gateway mode is stubbed: the e-ink downlink protocol is proprietary
and needs Minew's SDK. It fails fast and non-retryably rather than pretending.

### Getting credentials

The DS026F/G1-E kit includes a MinewTag Cloud Platform account, which is where
the REST API and token live. Ask your Minew contact (info@minewtag.com) for the
API docs — the spec PDFs don't include them. Point the gateway at your network
over its Wi-Fi AP (`GW-AC233Fxxxxx`, admin at `192.168.99.1`).

## Deploying

```bash
npm run build
npm run db:deploy    # apply migrations
npm start
```

Checklist:

- **`ENCRYPTION_KEY`** — set it once and never rotate casually; changing it
  makes stored vendor tokens undecryptable.
- **Sessions** are httpOnly cookies, `secure` in production. Terminate TLS.
- **Background work** — the in-process worker runs by default. Running more
  than one instance? Set `WORKER_ENABLED=false` everywhere and point a cron at
  `POST /api/jobs/tick` with `Authorization: Bearer $CRON_SECRET`. The queue
  claims jobs with `FOR UPDATE SKIP LOCKED`, so both topologies are safe.
- **Media uploads** land in `./storage` — mount a volume, or swap `lib/storage.js`
  for object storage.
- **Rate limiting** — login has a small in-memory attempt counter. Put a real
  limiter at the edge in front of it.
# ESL
