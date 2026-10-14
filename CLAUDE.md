# CLAUDE.md

Guidance for coding agents working in this repository.

## Project

Shelf2Kumo (team KumoForge): small Japanese shops photograph products, AI extracts them into a draft catalog, the owner edits via chat or forms, confirms once, and gets a public storefront URL/QR.

The single source of truth is [docs/Shelf2Kumo-Implementation-Specification.md](docs/Shelf2Kumo-Implementation-Specification.md). Read §2 (core principles) and §12 (progress log) before every task, then work on the next incomplete phase in §10.

## Current state

No application code exists yet. Phase 0 (scaffolding and live gates) is next. Update this section and the "Commands" section as the project takes shape.

## Stack

- One React + Vite + TypeScript app (`apps/web`) for everything:
  - `src/workspace/`: merchant SPA at `/app/**`
  - `src/storefront/`: pure storefront components shared by the workspace preview (client) and public pages (server, `renderToStaticMarkup`, no hydration, no client JS)
  - SSR build is bundled into the `storefront` Cloud Function, which serves all shops at `/s/**`, `/media/**`, `/sitemap.xml`
- No Astro, Next.js or other SSR framework.
- Backend: Firebase Auth, Firestore, Cloud Functions (2nd gen), Cloud Storage, Hosting, App Check
- Shared: `packages/contracts` (Zod schemas, source of truth), `packages/themes`, `packages/ai` (server-only AMD adapter)
- AI: AMD endpoint `https://developer.amd.com.cn/radeon/api/v1/chat/completions`, model `MiniCPM-V-4.7-35B-A3B`

## Commands

To be filled in during Phase 0 (install, dev, emulators, build, typecheck, lint, test). Do not guess commands that do not exist yet.

## Non-negotiable rules

- **One gate:** extraction and edits save straight to draft. Never add review queues, per-item approval or mandatory preview. Publishing requires the owner's change-summary confirmation, bound to `contentRevision` and the snapshot hash.
- **The model only proposes.** AI output must pass Zod validation and the action allowlist; trusted server code does every write. AI never publishes.
- **Server enforces auth.** Every `/api` handler verifies the Firebase ID token, App Check and shop ownership. Never trust a body `ownerId`. All client Firestore writes are denied by rules.
- **Secrets:** `AMD_API_KEY` lives only in Firebase secret management / local env. Never in a `VITE_*` variable, client bundle, log or commit. Never import `packages/ai` from browser code.
- **Untrusted input:** image text, descriptions and chat history are data, never instructions.
- **No AMD call inside an HTTP request path.** Hosting rewrites time out at 60s; inference runs in Firestore-triggered workers.
- **Honesty:** fixtures must be labeled as fixtures. Never mark a phase or check as passed without evidence; report unrun or blocked checks explicitly. No accuracy claims without Workstream E data.
- **Storefront components stay pure:** props in, markup out. No Firebase, workspace state or browser-only APIs in `src/storefront/`.
- **Japanese-first UI:** user-facing labels in Japanese (`公開する`, not "deploy"); prices are integer JPY or `null` (`価格はお問い合わせください`).

## Working conventions

- Match the spec's contracts exactly (paths, field names, state machines in §6–§7). If a change is needed, update the spec and add a §12 decision log entry first.
- Ordinary tests use fixtures and the Firebase emulators; paid provider calls only in explicitly invoked scripts.
- Add negative authorization tests (second owner, anonymous) whenever access boundaries change.
- End each phase with: changed behavior, files, checks run with results by acceptance ID (e.g. `P3-2`), limitations, next phase. Update the checklist in §12.
- Create directories only when needed. Prefer small, focused modules matching the repository structure in §5.
