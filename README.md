# Shelf2Kumo

**From Shelf to Cloud, Powered by AI** · Team KumoForge

Shelf2Kumo helps small Japanese shops put their products online from a phone. The owner photographs a product, AI fills in a draft catalog entry, the owner adjusts it by chatting or with simple forms, and one confirmation publishes a storefront page they can share by URL or QR code.

## Status

Phases 0–2 are complete and live at https://shelf2kumo.web.app. The implementation baseline is [docs/Shelf2Kumo-Implementation-Specification.md](docs/Shelf2Kumo-Implementation-Specification.md); progress is tracked in its §12.

| Item | Status |
|---|---|
| AMD text inference (`MiniCPM-V-4.7-35B-A3B`) | Passed from the deployed Tokyo region (~1.5 s) |
| AMD image extraction | Prompt `extraction-v1`: 5/5 synthetic images correct and schema-valid (15–30 s each); real-photo quality not measured |
| Workspace shell, storefront renderer, emulator routing | Working |
| Sign-up/sign-in/reset, shop creation and profile editing, owner isolation | Done (Phase 1); live at https://shelf2kumo.web.app/app/ |
| Private photo upload, server validation, EXIF-free renditions, private previews | Done (Phase 2); live |
| Firebase project `shelf2kumo` (production) | Blaze; Firestore (Tokyo), Storage (us-west1), Auth, App Check enforced on the API |

## Architecture at a glance

- **One React + Vite + TypeScript app** for the merchant workspace (`/app`) and every shop's storefront (`/s/:slug`)
- **Storefront:** the same React components, rendered to plain HTML in a Cloud Function from immutable release snapshots and cached by the Hosting CDN
- **Backend:** Firebase Auth, Firestore, Cloud Functions, Cloud Storage, App Check
- **AI:** AMD-hosted MiniCPM-V for product extraction and chat action planning

## Getting started

Requirements: Node ≥ 22.22, pnpm 10, Firebase CLI. Java 11+ only for the Auth/Firestore/Storage emulators.

```bash
pnpm install
pnpm dev          # http://localhost:5173/ (landing) and /app/shops/demo (workspace)
pnpm verify       # typecheck, lint, test, build, client secret scan
pnpm emulators    # http://127.0.0.1:5050/s/demo (storefront via Hosting → Function rewrite)
```

Copy `.env.example` to `.env.local` for local scripts; never commit real keys. `pnpm smoke:amd` sends one paid request to the AMD endpoint to check connectivity.

## Contributing with coding agents

See [CLAUDE.md](CLAUDE.md) for the rules agents follow in this repository.
