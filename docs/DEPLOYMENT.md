# Deployment and operations

How to set up, test, deploy, verify, roll back and clean up Shelf2Kumo. The implementation baseline is [Shelf2Kumo-Implementation-Specification.md](Shelf2Kumo-Implementation-Specification.md).

## Environments

| Environment | Firebase project | Purpose | Data |
|---|---|---|---|
| Local emulators | `demo-shelf2kumo` (`default` alias, offline) | Development, all automated tests | Throwaway; AI uses labeled fixtures, never paid calls |
| Production | `shelf2kumo` (`prod` alias) | The live site `https://shelf2kumo.web.app` | Real accounts and shops |

There is no separate staging project (owner decision for the hackathon). The emulators are the pre-deploy test environment, and production checks use clearly named test accounts that are deleted afterwards. Emulator and production data never mix: the client connects to emulators only when `VITE_USE_EMULATORS=true` **and** it is served from `localhost`/`127.0.0.1`.

## Prerequisites

- Node ≥ 22.22 and pnpm 10 (`pnpm install` also installs the pinned Firebase CLI; scripts use it)
- Java 11+ (OpenJDK 21 recommended) for the Firestore and Storage emulators
- Google Chrome for the end-to-end browser test (`CHROME_PATH` to override)
- `gcloud` signed in with access to `shelf2kumo` for operator scripts (Application Default Credentials: `gcloud auth application-default login`)

## Local setup

```bash
pnpm install
cp .env.example .env.local     # fill VITE_FIREBASE_* (public web config), VITE_USE_EMULATORS=true, AMD_API_KEY for manual AI scripts
pnpm eval:images               # synthetic product photos for evaluation and the demo shop
pnpm emulators:all             # Auth, Functions, Firestore, Storage, Hosting at http://127.0.0.1:5050
pnpm seed:emulator             # labeled demo shop at /s/demo (in another terminal)
pnpm dev                       # Vite dev server; /api, /s, /media proxy to the Hosting emulator
```

## One-time production configuration (already done for `shelf2kumo`)

| Item | Setting |
|---|---|
| Plan | Blaze (required for Functions, Secret Manager, Cloud Scheduler) |
| Firestore | `(default)`, Native, `asia-northeast1`, delete protection on; location pinned in `firebase.json` |
| Storage | `shelf2kumo.firebasestorage.app`, `us-west1` (no-cost tier); CORS from `infra/storage-cors.json` |
| Cross-service rules | Storage service agent `service-37543586877@gcp-sa-firebasestorage.iam.gserviceaccount.com` has `roles/firebaserules.firestoreServiceAgent` |
| Auth | Email/Password enabled |
| App Check | reCAPTCHA Enterprise score key (allowed domains `shelf2kumo.web.app`, `shelf2kumo.firebaseapp.com`, min score 0.5); enforced on `/api` via `APP_CHECK_ENFORCE=true` |
| Artifact Registry | Cleanup policy deletes function images older than 1 day (`asia-northeast1`) |

Re-apply bucket CORS if it changes:

```bash
gcloud storage buckets update gs://shelf2kumo.firebasestorage.app --cors-file=infra/storage-cors.json
```

## Secrets and parameters

The AMD key lives only in Secret Manager and is bound to `extractionWorker`, `chatWorker` and `opsAmdCheck`. Never put it in a `VITE_*` variable, a commit or a log.

```bash
# Set or rotate (reads from .env.local without echoing), then redeploy functions so they bind the new version.
printf '%s' "$(grep '^AMD_API_KEY=' .env.local | cut -d= -f2-)" | node_modules/.bin/firebase functions:secrets:set AMD_API_KEY --data-file /dev/stdin --project prod
pnpm deploy:prod
```

Non-secret function parameters are in `functions/.env.shelf2kumo` (production) and `functions/.env.demo-shelf2kumo` (emulators):

| Parameter | Production value | Meaning |
|---|---|---|
| `PUBLIC_ORIGIN` | `https://shelf2kumo.web.app` | Canonical URLs, sitemap, share links |
| `APP_CHECK_ENFORCE` | `true` | Require App Check on `/api` |
| `AMD_BASE_URL` | `https://developer.amd.com.cn/radeon/api` | Hackathon AMD endpoint (fixed) |
| `AMD_MODEL` | `MiniCPM-V-4.7-35B-A3B` | Vision model for photo extraction |
| `AMD_REQUEST_TIMEOUT_MS` | `60000` | Extraction call timeout |
| `AMD_CHAT_MODELS` | `MiniCPM-V-4.7-35B-A3B,DeepSeek-V4.1-Flash,Qwen3.8-Flash-Next` | Chat planning fallback chain |
| `AMD_CHAT_TIMEOUT_MS` | `30000` | Per-model chat attempt timeout |

## Release checklist

1. `pnpm verify` — typecheck, lint, unit tests, build, client secret scan.
2. `pnpm test:emulator` — Firestore/Storage rules and API suites (needs Java).
3. `pnpm test:e2e` — release browser flow at 360px (needs Java and Chrome).
4. `pnpm deploy:prod` — rules, indexes, functions, hosting. A first deploy of a new Firestore trigger can fail while Eventarc permissions propagate; wait a few minutes and deploy again.
5. `pnpm check:queries` — every composite/collection-group query has a usable production index (the emulator does not enforce indexes).
6. Smoke checks:
   ```bash
   for p in / /app/ /api/health /s/demo /sitemap.xml /robots.txt; do curl -s -o /dev/null -w "%{http_code} $p\n" https://shelf2kumo.web.app$p; done
   curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" https://asia-northeast1-shelf2kumo.cloudfunctions.net/opsAmdCheck
   ```
7. Optional live browser check: reCAPTCHA may block headless browsers, so create a temporary App Check debug token (Firebase console → App Check → Apps → Manage debug tokens, or the App Check REST API), set `self.FIREBASE_APPCHECK_DEBUG_TOKEN` in the test browser only, use accounts named `s2k-deploy-check-<digits>@example.test`, then delete the token and run the cleanup below.

## Rollback

**One shop's public content** (e.g. a bad publication): move its live pointer to a previous immutable release. Other shops and the owner's drafts are untouched; the CDN reflects it within about 60 seconds.

```bash
pnpm ops:rollback --shop <shopId>                              # list releases (read-only)
pnpm ops:rollback --shop <shopId> --release <releaseId> --confirm
```

**Code** (functions, rules or hosting): check out the last good commit and redeploy.

```bash
git checkout <good-commit> && pnpm install && pnpm deploy:prod && pnpm check:queries
```

Hosting alone can also be rolled back from the Firebase console (Hosting → release history → Rollback). Do not roll back Firestore rules or indexes to versions that predate collections in use.

**Unpublish a shop** in an emergency: the owner can use 公開を停止; an operator can delete `publishedCatalogs/{slug}` and clear `shops/{shopId}.liveReleaseId` (equivalent to the unpublish transaction).

## Cleanup

```bash
pnpm ops:cleanup-test-data            # dry run: test accounts (s2k-deploy-check-*, s2k-probe-*, e2e-* @example.test)
pnpm ops:cleanup-test-data --apply    # delete them with shops, releases, pointers, usage, locks and Storage objects
```

Abandoned uploads are removed automatically every 6 hours (`cleanupUploads`), and stuck extraction/chat jobs are failed every 5 minutes (`recoverExtractions`).

## Monitoring

```bash
# Recent errors from any function
gcloud logging read 'resource.type="cloud_run_revision" AND severity>=ERROR' --project shelf2kumo --freshness=1h --limit 50
# AI attempts (sanitized: model, latency, error kind/status; never content or keys)
gcloud logging read 'jsonPayload.message:"extraction attempt" OR jsonPayload.message:"chat planning attempt failed"' --project shelf2kumo --freshness=1h
```

Per-owner limits: 20 photo extractions and 100 chat requests per day (Asia/Tokyo), 10 shops, 50 items and 200 photos per shop.

The shared hackathon AMD endpoint varies in availability by model. If extraction fails broadly, check `opsAmdCheck`; owners can always add and edit products manually.
