# Shelf2Kumo

**From Shelf to Cloud, Powered by AI** · Team KumoForge

Shelf2Kumo helps small Japanese shops put their products online from a phone. The owner photographs a product, AI fills in a draft catalog entry, the owner adjusts it by chatting or with simple forms, and one confirmation publishes a storefront page they can share by URL or QR code.

## Status

Planning stage. No application code yet. The implementation baseline is [docs/Shelf2Kumo-Implementation-Specification.md](docs/Shelf2Kumo-Implementation-Specification.md); progress is tracked in its §12.

| Item | Status |
|---|---|
| AMD text inference (`MiniCPM-V-4.7-35B-A3B`) | Confirmed with one manual request |
| AMD image input | **Unverified**, Phase 0 gate |
| Application, deployment | Not started |

## Architecture at a glance

- **Merchant workspace:** React + Vite + TypeScript on Firebase Hosting (`/app`)
- **Storefront:** Astro, server-rendered from immutable release snapshots in a Cloud Function, cached by the Hosting CDN (`/s/:slug`)
- **Backend:** Firebase Auth, Firestore, Cloud Functions, Cloud Storage, App Check
- **AI:** AMD-hosted MiniCPM-V for product extraction and chat action planning

## Getting started

Setup instructions will be added in Phase 0. Copy `.env.example` to `.env.local` for local scripts; never commit real keys.

## Contributing with coding agents

See [CLAUDE.md](CLAUDE.md) for the rules agents follow in this repository.
