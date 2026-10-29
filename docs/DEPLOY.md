# Deploy Breakout Log

Run account commands only when ready to deploy. Release preparation runs offline checks and a bundle dry run; it does not provision accounts, databases, or hosted services. Never put secret values in configuration, source, command arguments, logs, or the web build.

## 1. Install and verify

Use Node.js 22.13 or newer and npm. Wrangler is included in the service devDependencies. Dependency installation requires npm registry access. From the project root:

```sh
npm ci
(cd service && npm ci)
(cd web && npm ci)
bash scripts/verify-release.sh
```

All checks must pass before deployment. On npm 11.21.1 with Node.js 24.22.1, the service install attempted an unnecessary better-sqlite3 source build and failed because `make` was unavailable. In that environment, use `npm ci --ignore-scripts --cache /tmp/breakout-npm-cache` in `service/`; the package includes prebuilt binaries. The service tests must still pass. If the default npm cache is read-only, set `npm_config_cache` to a writable temporary directory for all installs. Run the fresh migration check alone with `node scripts/verify-migrations.mjs`. It opens an empty temporary SQLite database, applies `0001.sql` through `0005.sql` in order, checks the final schema and integrity, and removes the database. It uses better-sqlite3 when installed, otherwise Node's built-in SQLite. It also verifies that migration 0005 records nine externally spent dev units. This checks SQL compatibility, not Cloudflare account configuration.

## 2. Create and bind D1

From `service/`, authenticate to the intended Cloudflare account and create a database:

```sh
npx --no-install wrangler login
npx --no-install wrangler d1 create breakout-log
```

Copy the returned database ID into a local deployment configuration based on `wrangler.toml`. Add:

```toml
[[d1_databases]]
binding = "DB"
database_name = "breakout-log"
database_id = "<database-id-from-create>"
migrations_dir = "migrations"
```

The checked-in configuration includes the `DB` binding and an all-zero placeholder database ID. Replace the placeholder only in local deployment configuration before deployment. Never commit a real account or database ID. Keep `YOUCAM_MODE = "mock"` for initial smoke checks. The storage host suffix allowlist is required for live results and must match the approved provider hosts.

Apply migrations locally first, using a fresh persistence directory:

```sh
LOCAL_D1_DIR=$(mktemp -d)
npx --no-install wrangler d1 migrations apply DB --local --persist-to "$LOCAL_D1_DIR"
```

Confirm all five migrations succeeded. Then apply them to the remote database:

```sh
npx --no-install wrangler d1 migrations apply DB --remote
```

Never run `--remote` during offline release verification. Back up an existing database before any remote migration with `wrangler d1 export DB --remote --output <private-backup-file>`. Keep backups private and apply a retention policy.

## 3. Set server secrets

Enter values only at Wrangler's hidden interactive prompts:

```sh
npx --no-install wrangler secret put IP_HASH_SECRET
npx --no-install wrangler secret put YOUCAM_API_KEY
```

`IP_HASH_SECRET` must be strong, random, and stable across requests. Mock mode also needs it. The provider key is needed only for live analysis and cleanup. Optional privileged pools require separate access codes:

```sh
npx --no-install wrangler secret put JUDGE_CODE
npx --no-install wrangler secret put DEV_CODE
```

Leave access codes unset to disable privileged pools. Never expose these secrets through Vite variables or browser code.

## 4. Deploy the Worker and web on one origin

The web client uses relative `/api` URLs. Use a Cloudflare Pages custom domain for the web, then route that hostname's `/api/*` traffic to this Worker. Separate Pages and workers.dev URLs do not provide this routing. The Vite proxy exists only for local development.

In `wrangler.toml`, set an owned hostname and zone:

```toml
# Place these top-level keys before [vars] or other TOML tables.
workers_dev = false
routes = [{ pattern = "<web-hostname>/api/*", zone_name = "<zone-name>" }]
```

Verify the hostname belongs to the chosen zone, is proxied through Cloudflare, and serves the Pages project. Keep the `/api/*` route on every Worker deployment.

From `service/`, inspect the offline bundle before the real deploy:

```sh
BUNDLE_DIR=$(mktemp -d)
WRANGLER_SEND_METRICS=false npx --no-install wrangler deploy --dry-run --outdir "$BUNDLE_DIR"
```

The release-prep dry run on 2026-10-29 reported 258.19 KiB raw and 155.16 KiB gzip with Wrangler 4.155.0. It listed the DB binding and mock mode. Check the reported raw/gzip bundle size, `DB` binding, mode, storage host allowlist, compatibility date, and cron. The checked-in compatibility date is `2026-07-30`. An older installed runtime may warn or reject it. The cron `*/15 * * * *` retries bounded cleanup every 15 minutes; live cleanup can contact the provider even without uploads.

Build the web from the root and create a Pages project only if it does not exist:

```sh
(cd web && npm run build)
(cd service && npx --no-install wrangler pages project create breakout-log --production-branch main)
(cd service && npx --no-install wrangler pages deploy ../web/dist --project-name breakout-log --branch main)
```

Attach the intended custom domain in Cloudflare Pages. From `service/`, deploy the Worker with its `/api/*` route:

```sh
npx --no-install wrangler deploy
```

## 5. Smoke check without paid calls

With the Worker in mock mode, open the deployed web URL and use Sample. Confirm the sample label, results, JSON download/import, and End session behavior. Check the API on the same hostname:

```sh
curl -i 'https://<web-hostname>/api/analyses/release-check-missing'
```

Expect HTTP 404 with a JSON `not_found` error, not Pages HTML. There is no `/health` endpoint. For the upload flow, use only an approved synthetic face in mock mode. Confirm the mock label, polling, result display, and per-job DELETE, then confirm GET returns 404. Do not change to live mode or run live smoke scripts without separate authorization and a budget check.

## 6. Roll back

Record the Worker deployment ID and Pages production deployment before each release. From `service/`, inspect and restore the previous Worker version:

```sh
npx --no-install wrangler deployments list
npx --no-install wrangler rollback <previous-version-id>
```

Restore the previous Pages deployment through the Pages dashboard. Check both the web and `/api/*` route again. Worker rollback does not reverse D1 migrations or restore deleted data. Migrations 0001–0004 add tables, columns, and indexes. Migration 0005 records nine externally spent dev units in reservations. Do not remove that accounting record during rollback. Before restoring older code, verify it can use the current schema. Restore database backups only as a deliberate recovery operation; lost accounting can allow extra provider spending.

## 7. Delete all data

Deleting all data is irreversible. Stop new traffic and disable the cleanup cron before database removal. Keep a controlled operator route only while reconciling provider tasks. For each known job, call DELETE `/api/analyses/<id>` and inspect the returned provider cleanup status. Retry pending or failed cleanup. Reconcile unknown submissions in the provider console before removing the records needed to find them. Never log or publish bearer job IDs or task IDs.

End browser sessions, clear the page, and delete any downloaded JSON and private backups that must be removed. Browser page-exit DELETE is best-effort. In-memory results expire logically after 30 minutes; D1 deletion alone does not clear Worker isolate memory. Remove the deployed Worker to stop serving those isolates, and remove Pages if the whole application is being retired. From `service/`, after provider cleanup and explicit confirmation that accounting and tombstones must be destroyed:

```sh
npx --no-install wrangler delete
npx --no-install wrangler d1 delete breakout-log
npx --no-install wrangler pages project delete breakout-log
```

Confirm the public URLs no longer serve the app and that the database is absent in the dashboard. Provider-side retention and cleanup remain governed by the provider; do not claim that deleting D1 deletes provider files. Do not recreate an empty live database during the same allowance period without reconciling spent units.
