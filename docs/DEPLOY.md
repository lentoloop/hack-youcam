# Deploy Breakout Log

Run account commands only when ready to deploy. Release preparation runs offline checks and a bundle dry run; it does not provision accounts, databases, or hosted services. Never put secret values in configuration, source, command arguments, logs, or the web build.

## 1. Install and verify

Use Node.js 22.13 or newer and npm. Wrangler is included in the service devDependencies. Dependency installation requires npm registry access. From the project root:

```sh
export npm_config_cache=/tmp/breakout-npm-cache
npm ci
(cd service && npm ci --ignore-scripts)
(cd web && npm ci)
(cd web && npm run build)
bash scripts/verify-release.sh
```

All checks must pass before deployment. Use `npm ci --ignore-scripts` in `service/` because better-sqlite3 13 includes `prebuilds/linux-x64.node`; plain `npm ci` attempts a source build that fails on this box because `make` is unavailable. The service tests must still pass. If the default npm cache is read-only, set `npm_config_cache` to a writable temporary directory for all installs. Run the fresh migration check alone with `node scripts/verify-migrations.mjs`. It opens an empty temporary SQLite database, applies `0001.sql` through `0005.sql` in order, checks the final schema and integrity, and removes the database. It uses better-sqlite3 when installed, otherwise Node's built-in SQLite. It also verifies that migration 0005 records nine externally spent dev units. This checks SQL compatibility, not Cloudflare account configuration.

## 2. Create and bind D1

From `service/`, authenticate to the intended Cloudflare account and create a database:

```sh
npx --no-install wrangler login
npx --no-install wrangler d1 create breakout-log
```

From `service/`:

Copy the complete checked-in configuration to the ignored local file `service/wrangler.deploy.toml`:

```sh
cp wrangler.toml wrangler.deploy.toml
```

In that local file, replace the existing D1 block with:

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
npx --no-install wrangler d1 migrations apply DB --config wrangler.deploy.toml --local --persist-to "$LOCAL_D1_DIR"
```

Confirm all five migrations succeeded. Then apply them to the remote database:

```sh
npx --no-install wrangler d1 migrations apply DB --config wrangler.deploy.toml --remote
```

Never run `--remote` during offline release verification. Back up an existing database before any remote migration with `wrangler d1 export DB --config wrangler.deploy.toml --remote --output <private-backup-file>`. Keep backups private and apply a retention policy.

## 3. Set server secrets

Enter values only at Wrangler's hidden interactive prompts:

```sh
npx --no-install wrangler secret put --config wrangler.deploy.toml IP_HASH_SECRET
npx --no-install wrangler secret put --config wrangler.deploy.toml YOUCAM_API_KEY
```

`IP_HASH_SECRET` must be strong, random, and stable across requests. Mock mode also needs it. The provider key is needed only for live analysis and cleanup. Optional privileged pools require separate access codes:

```sh
npx --no-install wrangler secret put --config wrangler.deploy.toml JUDGE_CODE
npx --no-install wrangler secret put --config wrangler.deploy.toml DEV_CODE
```

Leave access codes unset to disable privileged pools. Never expose these secrets through Vite variables or browser code.

## 4. Deploy the Worker and web on one origin

The default deployment serves the Vite single-page app and API from one `workers.dev` hostname. No custom domain or zone is required. `service/wrangler.toml` declares Workers static assets from `../web/dist`. Only `/api/*` runs the Worker first. Other paths use static assets with single-page application fallback, so they do not invoke the Worker. Unknown `/api/*` paths retain the Worker's JSON 404 response.

Build the web before each dry run or deployment. From the root:

```sh
(cd web && npm run build)
```

From `service/`, inspect the offline bundle using the checked-in placeholder configuration:

```sh
BUNDLE_DIR=$(mktemp -d)
WRANGLER_LOG_PATH=/tmp/breakout-wrangler.log WRANGLER_SEND_METRICS=false npx --no-install wrangler deploy --dry-run --outdir "$BUNDLE_DIR"
```

Check the assets directory, raw and gzip bundle sizes, `DB` binding, mock mode, storage host allowlist, compatibility date, and cron. The checked-in compatibility date is `2026-07-30`. The cron `*/15 * * * *` retries bounded cleanup every 15 minutes. Live cleanup can contact the provider even without uploads.

After setting the real D1 ID and secrets with the local configuration, Kai deploys from `service/`:

```sh
npx --no-install wrangler deploy --config wrangler.deploy.toml
```

Open the `workers.dev` URL returned by Wrangler. Keep `YOUCAM_MODE = "mock"` for the initial smoke check. Static asset requests use Workers static asset serving. API requests and scheduled cleanup remain subject to the account's Workers and D1 free-plan limits.

### Drain before switching mode

Stop new POST `/api/analyses` requests before changing `YOUCAM_MODE`. Wait at least 30 minutes after the last POST, or confirm that no `jobs` rows remain in `queued` or `running` state. Keep the provider credentials and storage allowlist available until live jobs and cleanup finish. Then change the mode in the local deployment configuration and deploy. GET polling and accounting use each job's stored mode.

### Alternative: Pages with a custom domain

If you have an owned Cloudflare zone, you can host the web on Pages and route that hostname's `/api/*` requests to the Worker. Separate Pages and `workers.dev` URLs do not provide this routing. The Vite proxy exists only for local development.

For this alternative, remove the `[assets]` table from `wrangler.deploy.toml` and set these top-level keys before any TOML tables:

```toml
workers_dev = false
routes = [{ pattern = "<web-hostname>/api/*", zone_name = "<zone-name>" }]
```

Verify that the hostname belongs to the zone, is proxied through Cloudflare, and serves the Pages project. After building the web, create the Pages project only if it does not exist:

```sh
(cd service && npx --no-install wrangler pages project create breakout-log --production-branch main)
(cd service && npx --no-install wrangler pages deploy ../web/dist --project-name breakout-log --branch main)
(cd service && npx --no-install wrangler deploy --config wrangler.deploy.toml)
```

Attach the custom domain in Cloudflare Pages. Keep the `/api/*` route on every Worker deployment.

## 5. Smoke check without paid calls

With the Worker in mock mode, open the deployed web URL and use Sample. Confirm the sample label, results, JSON download/import, and End session behavior. Check the API on the same hostname:

```sh
curl -i 'https://<web-hostname>/api/analyses/release-check-missing'
```

Expect HTTP 404 with a JSON `not_found` error, not static HTML. There is no `/health` endpoint. For the upload flow, use only an approved synthetic face in mock mode. Confirm the mock label, polling, result display, and per-job DELETE, then confirm GET returns 404. Do not change to live mode or run live smoke scripts without separate authorization and a budget check.

## 6. Roll back

Record the Worker deployment ID before each release. For the Pages alternative, also record the Pages production deployment. From `service/`, inspect and restore the previous Worker version:

```sh
npx --no-install wrangler deployments list --config wrangler.deploy.toml
npx --no-install wrangler rollback --config wrangler.deploy.toml <previous-version-id>
```

For the Pages alternative, restore the previous Pages deployment through the Pages dashboard. Check both the web and `/api/*` route again. Worker rollback does not reverse D1 migrations or restore deleted data. Migrations 0001–0004 add tables, columns, and indexes. Migration 0005 records nine externally spent dev units in reservations. Do not remove that accounting record during rollback. Before restoring older code, verify it can use the current schema. Restore database backups only as a deliberate recovery operation; lost accounting can allow extra provider spending.

## 7. Delete all data

Deleting all data is irreversible. Stop new traffic and disable the cleanup cron before database removal. Keep a controlled operator route only while reconciling provider tasks. For each known job, call DELETE `/api/analyses/<id>` and inspect the returned provider cleanup status. Retry pending or failed cleanup. Reconcile unknown submissions in the provider console before removing the records needed to find them. Never log or publish bearer job IDs or task IDs.

End browser sessions, clear the page, and delete any downloaded JSON and private backups that must be removed. Browser page-exit DELETE is best-effort. In-memory results expire logically after 30 minutes; D1 deletion alone does not clear Worker isolate memory. Remove the deployed Worker to stop serving those isolates, and remove Pages if you used that alternative and the whole application is being retired. From `service/`, after provider cleanup and explicit confirmation that accounting and tombstones must be destroyed:

```sh
npx --no-install wrangler delete --config wrangler.deploy.toml
npx --no-install wrangler d1 delete breakout-log --config wrangler.deploy.toml
npx --no-install wrangler pages project delete breakout-log
```

Confirm the public URLs no longer serve the app and that the database is absent in the dashboard. Provider-side retention and cleanup remain governed by the provider; do not claim that deleting D1 deletes provider files. Do not recreate an empty live database during the same allowance period without reconciling spent units.

## Dependency advisories

Release preparation on 2026-10-29 retained Miniflare 4.20260730.0 and added overrides scoped to `miniflare` for `sharp` 0.35.5 and `undici` 7.30.1. This avoids npm's suggested breaking downgrade and preserves the `2026-07-30` compatibility date. Wrangler's own Miniflare 5.x already resolves sharp 0.35.5 and undici 7.30.1. To regenerate the lockfile, use `npm_config_cache=/tmp/breakout-npm-cache npm install --ignore-scripts` from `service/`, then run `npm ci --ignore-scripts`, verify, and commit the updated lockfile.

`npm audit --json` reported the following counts in the root, `service/`, and `web/`, respectively:

```text
root:    info 0, low 0, moderate 0, high 0, critical 0, total 0
service: info 0, low 0, moderate 0, high 0, critical 0, total 0
web:     info 0, low 0, moderate 0, high 0, critical 0, total 0
```

The service install also printed `found 0 vulnerabilities`. `npm ls miniflare sharp undici --depth=2` confirmed Miniflare 4.20260730.0 uses sharp 0.35.5 and undici 7.30.1. No Miniflare upgrade or downgrade was needed.

After building the web, `bash scripts/verify-release.sh` passed all eight checks: three TypeScript checks, 165 service tests in nine files, 12 e2e tests in two files, 25 web tests in three files, the web build, and all five migrations with fresh SQLite schema and integrity checks. Wrangler 4.155.0's dry run read four files from `web/dist` and reported 258.19 KiB raw and 155.16 KiB gzip, the DB binding, and mock mode. The dry run used a temporary log path because the default Wrangler log directory is read-only on this box.

A local `wrangler dev --local` check with the same configuration returned HTML 200 for `/` and `/release-check-spa`, JavaScript 200 for the built asset, and JSON 404 with `error.code = "not_found"` for `/api/release-check-missing`. The check used no secrets or provider calls.
