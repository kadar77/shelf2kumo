# Shelf2Kumo — Implementation Specification

Version: 1.3 · Updated: 2026-10-15 · Status: editable implementation baseline

Team: KumoForge  
Tagline: From Shelf to Cloud, Powered by AI

This document supersedes the earlier Next.js/Supabase/Vercel architecture. The Firebase services and AMD endpoint/model below are confirmed project choices. The owner has adopted a React/Vite conversational workspace, curated AI-customized themes and Astro static storefront publishing. Implementation defaults can be revised during discussion. No application, infrastructure, model benchmark, or live API verification has been executed as part of writing this document.

## 1. Product and scope

Shelf2Kumo helps small Japanese shops publish featured products from photographs. The primary demonstration is a specialty retail shop; cafés and printed menus are secondary.

**Workflow:** sign in → describe shop in chat → upload photos → products appear automatically → optionally request edits or preview → confirm changes and publish → build and release static pages → share URL or QR code.

### Required MVP

- Japanese-first, mobile-first conversational merchant workspace with editable cards, catalog navigation and a live draft preview.
- Chat can update shop information, product drafts and storefront theme; direct forms remain available.
- Three curated modern storefront templates, customized through validated design tokens.
- Owner-confirmed publication followed by an asynchronous Astro build and Firebase Hosting release.
- Firebase authentication and one owner per shop; multiple shops per owner are allowed.
- Shop profile, individual product photographs, automatic catalog updates, optional editing, one publish confirmation and unpublishing.
- No review queue, candidate-adoption step or per-product approval. “Draft” means saved but not yet published data; it is an internal state, not a required workflow screen.
- Anonymous public catalog and individual product pages, rendered as HTML with meaningful metadata.
- JPY prices as integers; unknown prices remain `null` and display as `価格はお問い合わせください`.
- QR sharing and a copy-link action.
- Actual AMD inference for the live AI demonstration; seeded examples are clearly identified as demo data.

### Deferred or excluded

Multi-product shelf recognition and menu extraction follow the MVP. Comparative model evaluation runs separately when images and ground truth are available. No POS integration, checkout, payments, orders, shipping, inventory synchronization, automatic business-listing registration, marketplace publishing, generated product photography, native app, or self-hosted GPU deployment.

The product supports online discovery. Search indexing, search ranking, and merchant-listing eligibility are not acceptance promises. Do not invent business addresses, availability, product claims, or customer testimonials.

## 2. Decisions and verification status

| Decision | Status | Implementation consequence |
|---|---|---|
| Firebase Auth, Firestore, Cloud Functions, Firebase Hosting | User-selected | Use these services throughout the application |
| Cloud Storage for Firebase | Proposed supporting service, adopted here | Required for persistent image files; Firestore stores metadata only |
| React + Vite + TypeScript | Adopted | Conversational owner workspace on Firebase Hosting |
| Astro static storefronts | Adopted | Build publication-confirmed catalog/profile/theme snapshots into public HTML |
| Background build job | Required supporting component | Functions coordinate a dedicated Astro build runner; proposed Google Cloud Build |
| AMD endpoint | Confirmed by user-provided successful request | `https://developer.amd.com.cn/radeon/api/v1/chat/completions` |
| AMD request model | Confirmed by sample | `MiniCPM-V-4.7-35B-A3B` |
| Response text location | Confirmed by sample | `choices[0].message.content` |
| Response model identity | Observed in sample | May be `self-dploy/MiniCPM-V-4.7-35B-A3B`; do not require equality with request model |
| Image message format and limits | Unverified | Test adapter compatibility before claiming functional extraction |
| JSON mode, schema mode, tools, streaming | Unverified; native support not required | Use schema-validated JSON action proposals; validate conversational reliability before release |
| Recognition accuracy / model ranking | Not measured | No accuracy claims; evaluation is outside the critical build path |

The text response does not establish Japanese OCR quality, vision compatibility, latency under load, or the underlying hardware used for each request. Preserve provider evidence where available and verify any event-specific evidence requirements separately.

## 3. Frontend comparison and recommendation

| Option | Fit with Firebase Hosting | Dynamic catalog and SEO | Tradeoff for Shelf2Kumo |
|---|---|---|---|
| **React + Vite** | Build static assets into `dist`; serve directly from Hosting. Use Cloud Functions for APIs. | Use the SPA for private owner interactions; pair it with Astro for complete public HTML. | Best fit for chat, editable cards and preview controls. **Selected for the owner workspace.** |
| **Next.js** | Static export can be hosted on Hosting. Full server features need a server deployment; Firebase recommends App Hosting for full-stack Next.js rather than its framework-aware Hosting experiment. | Strong integrated server rendering, metadata and routing. Static export cannot provide arbitrary new shop pages at request time without another approach. | Useful if the project later prioritizes a large server-rendered site and adopts App Hosting. Its server layer overlaps the chosen Cloud Functions backend. |
| **Astro** | Static output fits Hosting directly; publish events trigger builds of publication-confirmed content. | Excellent for content-heavy pages; static builds require regeneration for new content, while SSR requires server integration. | **Selected for storefronts.** Curated templates produce fast public pages; keep owner interactions in React/Vite. |

**Decision:** use React/Vite for `/app/**` and Astro static output for `/s/**`. Astro renders publication-confirmed shop, product and theme data at publication time. A background build job replaces the previous per-request public renderer. Share contracts and theme tokens between the private preview and Astro; do not ship the merchant bundle to public visitors.

This split accepts a build/release delay in exchange for static storefront delivery. The editor preview updates after each saved draft; the public site changes only after an owner-confirmed release succeeds.
Next.js was reasonable in the earlier monolithic architecture because it combines UI, API routes and rendering. The requested Firebase architecture already assigns API work to Cloud Functions, so Next.js is no longer the simplest default. This is a project-specific recommendation, not a general framework performance ranking.

Sources: [Vite static deployment](https://vite.dev/guide/static-deploy.html), [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports), [Firebase Next.js integration guidance](https://firebase.google.com/docs/hosting/frameworks/nextjs), [Astro Firebase deployment](https://docs.astro.build/en/guides/deploy/firebase/). Reviewed 2026-10-15; recheck deployment prerequisites when implementing.

## 4. Architecture

```text
Owner: React/Vite on Firebase Hosting + Firebase Auth
  ├─ Chat, image upload, editable cards, catalog and draft preview
  └─ /api/** → Cloud Functions: authorize, validate and save commands
                   ├─ Firestore: drafts, conversations, actions and revisions
                   ├─ Storage: private images and build artifacts
                   └─ AMD: extraction and structured conversational proposals

Owner sees change summary → confirms Publish
  → immutable confirmed snapshot → publication job
  → dedicated build runner: Astro templates + theme + selected assets
  → validate complete release → Firebase Hosting version/release
  → verify live revision → mark published → URL and QR code

Visitor → Firebase Hosting → static catalog/product HTML and selected images
```

Use second-generation Cloud Functions with a currently supported Node.js runtime, pinned at implementation time. Select compatible Functions/Firestore/Storage locations near the target users after checking service availability; record the actual choices before provisioning. Keep development and production in separate Firebase projects. Budget for billable services; confirm current billing prerequisites before deployment.

Host `/api/**` through HTTP Functions and rewrite only `/app/**` to the merchant SPA shell. Serve `/s/**`, `/media/**`, `/sitemap.xml` and the landing page as generated static files. Unknown public routes return a real 404. Fingerprinted application bundles may use immutable caching; public shop HTML and product media initially use `no-store` to limit stale content after unpublication. Private responses use `private, no-store`.

Keep inference and publication asynchronous rather than holding a Hosting request open. [Firebase Hosting and Functions](https://firebase.google.com/docs/hosting/functions)

### Static publication lifecycle

- Proposed runner: Google Cloud Build using a pinned Node/Astro build image and locked dependencies. Functions submit jobs; the browser and AI never receive deployment credentials. This is supporting build infrastructure, not a replacement for the selected Firebase services. Validate permissions, billing and runtime limits during Phase 0.
- Use trusted repository templates only. AI supplies validated data and theme tokens; it cannot supply shell commands, dependencies, JavaScript, raw HTML, arbitrary CSS or build configuration.
- Publish confirmation is tied to `shopId`, exact saved revision, item revisions, theme version and publication snapshot hash. Reject stale confirmations with 409. Save an immutable release snapshot before enqueueing.
- Job states: `queued → building → validating → releasing → published`, with `failed` and `superseded` terminal states. The UI reports “Publishing” until the Hosting release is verified. The existing storefront remains live on build failure.
- MVP uses one shared Hosting site per environment. Maintain a manifest mapping every shop to its last released artifact, plus the pinned owner-app/landing assets. A release is a complete file manifest: never deploy only one shop's folder and accidentally remove other shops.
- Serialize all releases, including owner-app updates, through one coordinator. Build artifacts may be prepared independently, but assemble against the latest released manifest under a global fenced lease. Recheck desired shop revisions before release; a stale job must not overwrite a newer publish or resurrect an unpublished shop.
- Create/finalize a Hosting version, release it, verify its release ID and expected revision marker, then update Firestore's live pointer. Hosting and Firestore cannot commit atomically: a recovery worker reconciles a crash after release using the recorded version/release IDs before retrying. No duplicate build or blind rollback on an ambiguous timeout.
- Unpublish is an explicit removal release: remove that shop's pages, product images and sitemap entries while preserving other shops. Report “Unpublishing” until verified. Deleting a Firestore snapshot alone does not take static pages offline. Previously downloaded content cannot be recalled.
- Retain versioned snapshots/artifacts for recovery. Normal per-shop rollback assembles a new complete release with only the chosen shop reverted; do not restore an entire old site version and undo other owners' updates. Apply current unpublish decisions during recovery.
- Private draft preview is an authenticated React rendering from the same versioned theme contract. It is not a public Hosting preview channel. Test visual parity against generated Astro pages; use private build artifacts for QA. Rebuild when template versions change only through a controlled release workflow.

Astro's static dynamic routes are enumerated at build time through `getStaticPaths()`. The build consumes immutable snapshots, not mutable live draft queries. [Astro routing](https://docs.astro.build/en/reference/routing-reference/)

Firebase provides APIs for uploading version assets and releasing them programmatically. [Firebase Hosting deployment API](https://firebase.google.com/docs/hosting/api-deploy)

### Suggested repository structure

```text
apps/web/                  React/Vite chat workspace, draft preview and landing page
apps/storefront/           Astro templates, catalog/product routes and metadata
build/                     Trusted build runner and complete release assembly
functions/src/api/         Authenticated commands
functions/src/extraction/  Worker, leases and validation
functions/src/chat/        Structured proposals and validated action execution
functions/src/publishing/  Jobs, release coordinator and reconciliation
packages/themes/          Versioned presets, tokens and preview contract
packages/contracts/       Shared schemas, types and normalization
packages/ai/              Server-only AMD adapter and versioned prompt
scripts/evaluate-models.ts Standalone evaluation entry point (deferred)
evaluation/               Manifest, ground truth, ignored images/results
tests/                    Unit, emulator integration and browser tests
docs/                     Specification, status, deployment and demo notes
firebase.json
firestore.rules
firestore.indexes.json
storage.rules
.env.example
```

Create directories only as needed. Never import the server-only AI package into the browser bundle.

## 5. Data contracts and access boundaries

Use server timestamps and opaque IDs. Documents below are proposed contracts, not existing resources.

| Path | Main fields / purpose |
|---|---|
| `shops/{shopId}` | `ownerId`, immutable `slug`, name, description, merchant-confirmed address/phone/hours, `isDemo`, draft revision, timestamps |
| `slugReservations/{slug}` | Unique `shopId`; server transaction reserves slug |
| `shops/{shopId}/images/{imageId}` | Owner-scoped storage path, validated MIME/bytes/dimensions, generation/hash, upload state, timestamps |
| `shops/{shopId}/jobs/{jobId}` | Image reference, mode, state, attempt, lease token/expiry, idempotency key, model, prompt version, safe error, timing, usage |
| `shops/{shopId}/jobs/{jobId}/results/{resultId}` | Private extraction provenance, source evidence and uncertainty flags; internal audit data, never a review queue |
| `shops/{shopId}/items/{itemId}` | Editable name/description/category, `priceJpy`, `currency: JPY`, tax treatment, image reference, order, revision, source job/result reference and uncertainty flags; no approval fields |
| `shops/{shopId}/theme/current` | Template ID/version, palette, typography preset, density, image treatment, theme revision |
| `shops/{shopId}/conversations/{conversationId}/messages/{messageId}` | Owner messages, assistant responses, attachment IDs and action references; private |
| `shops/{shopId}/actions/{actionId}` | Validated operation, target, expected revision, before/after diff, state and actor |
| `shops/{shopId}/releases/{revisionId}` | Immutable sanitized profile/items/theme/media snapshot and hash |
| `shops/{shopId}/publicationJobs/{jobId}` | Requested operation/revision, state, artifact hash, build ID, Hosting version/release IDs and safe errors |
| `publishedCatalogs/{slug}` | Private live pointer: released revision, Hosting release ID and publication time; reconciled after release |
| `hostingManifests/{manifestId}` | Server-only complete site artifact mapping, sequence and release ID |

MVP cap: 50 items per shop, 200 characters per name, 2,000 characters per description, and a serialized public snapshot below 500 KiB. Enforce these application limits before writing; do not rely on Firestore rejecting oversized documents. If growth requires splitting snapshots, introduce immutable version documents and an atomic active-version pointer.

Every profile, item, theme or catalog-order mutation increments the aggregate shop draft revision transactionally. Publishing captures the exact saved data summarized in the confirmation, with a strict public-field allowlist. Subsequent edits do not alter the immutable release snapshot. Every subsequent edit invalidates outstanding publish confirmations; it never creates a per-item approval requirement. Public data changes only after a successful static release; the live pointer tracks actual Hosting state, not publication intent. Unpublishing follows the removal-release lifecycle above.
Reserve lowercase ASCII slugs transactionally; Japanese display names remain unrestricted within length limits. Keep slugs immutable in MVP to avoid redirect complexity.

### Authorization

- Firebase Auth: start with email/password, Japanese sign-in/reset screens and a verified-email gate for paid extraction and publishing. Add Google sign-in later if useful.
- Clients may read only their own shop trees through Firestore rules. All application data mutations go through authenticated Functions; deny direct client writes.
- Deny direct client access to slug reservations and published snapshots. Anonymous visitors receive generated static files only. Deny client access to complete Hosting manifests and build credentials; conversation/action records inherit owner isolation.
- Admin SDK operations bypass Firestore rules: every command must independently verify the Firebase ID token and ownership. Never accept a body `ownerId` as authority.
- Storage permits owner uploads only to allocated image paths; deny overwrite, listing by other users and public original-image reads. Validate ownership, bytes and MIME in rules and revalidate actual file content server-side.
- Test rules with two different owners and an anonymous client. Authentication alone is not tenant isolation. [Firestore authorization conditions](https://firebase.google.com/docs/firestore/security/rules-conditions)

### Images

Add Cloud Storage for Firebase because photos cannot be stored appropriately as Firestore records. MVP accepts JPEG, PNG and WebP up to 8 MiB per original and 20 megapixels after decode; reject unsupported formats with Japanese guidance. Treat these as application limits, not confirmed AMD limits. Provide a useful HEIC conversion message until conversion is implemented.

Strip EXIF/GPS and create a bounded JPEG rendition (initial maximum long edge 1,600 px). Originals and AI renditions stay private. Do not generate durable public download tokens for originals. At publication, copy only selected renditions included in the publish confirmation into the static artifact under `/media/{shopId}/{contentHash}.jpg`. Remove unreferenced media from subsequent release manifests. Apply the publication caching policy; private Storage objects remain inaccessible anonymously even after a public rendition is released.
Source images may contain multiple products or private details. Show the selected image on the product card and include image additions/changes in the publish summary; no separate image approval is required. Do not silently present an entire shelf photo as a product close-up. Keep source images while referenced; remove abandoned uploads through a documented cleanup policy and provide owner deletion. Never delete media that the currently published snapshot still references.

## 6. AMD integration contract

### Confirmed text request

```bash
curl https://developer.amd.com.cn/radeon/api/v1/chat/completions \
  -H "Authorization: Bearer $AMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"MiniCPM-V-4.7-35B-A3B","messages":[{"role":"user","content":"Say hello in one sentence."}]}'
```

The supplied response has `choices[0].message.content = "Hello!"`, `finish_reason = "stop"`, usage counters and provider metadata. Optional cost and metadata fields must remain optional. Do not assume cost currency or infer reliable pricing from one response. Do not log full provider metadata, organization identifiers, key hashes, authorization headers or image payloads.

Configuration:

- `AMD_API_KEY`: server secret, bound only to extraction and chat workers through Firebase secret management. Local scripts read it from the environment.
- `AMD_CHAT_COMPLETIONS_URL`: exact full endpoint above; do not append another `/chat/completions`.
- `AMD_MODEL`: default exactly `MiniCPM-V-4.7-35B-A3B`; no provider prefix in the request.
- `AMD_REQUEST_TIMEOUT_MS`: initial 45,000; tune using real observations.
- `EXTRACTION_PROMPT_VERSION`: immutable version recorded with every result.
- `CHAT_PROMPT_VERSION`: versioned action-planning prompt; use the same model initially with separate validation tests.

No browser `VITE_*` variable may contain the AMD key. Use a server-side adapter with an interface such as `extract({imageBytes, mimeType, mode, signal})`. Implement HTTP with `fetch`; an SDK is optional and must not introduce unsupported parameters.

### Conversational action planning

Use the same AMD endpoint/model initially for text requests that return a bounded JSON proposal: `message`, `actions`, and optional `clarification`. Each action contains an allowlisted `type`, target ID, expected revision and typed arguments. Native tool calling and JSON mode are not assumed. Add a separate `proposeActions()` adapter method; keep extraction and chat prompts/schemas distinct.

The server supplies the current shop facts and only relevant conversation context. Firestore is authoritative; chat text never overrides ownership or publication state. Image OCR, product descriptions and prior messages are untrusted content. Unsupported actions, unknown targets, cross-shop IDs and malformed JSON produce no mutation. Ambiguous references such as “change this one” require selection or clarification.

Allowlisted MVP actions: update shop profile, create/update/remove a draft item, reorder catalog items, set theme tokens and request a preview. AI may offer publication but cannot execute it without the single server-validated owner confirmation. There is no approve-item action. Clearly requested reversible edits may apply to drafts immediately with a visible diff and Undo. Batch actions validate and commit atomically or fail without partial changes. Undo is a new revision-checked action; it cannot silently overwrite later edits or change already published content.

Persist request IDs and action IDs to avoid replay on reconnect or retried responses. Limit input length, context size, action count (initially 10) and provider attempts. Start with a separate configurable 100-chat-request daily allowance per owner. Reject requests over quota before inference. Keep chat history private, support clearing it, and never feed another owner's context to the model. Clearing history does not delete catalog data or the necessary private change audit.

Release checks cover Japanese requests, price edits, opening hours, multi-step corrections, clarification, malicious photo instructions and refused unsupported actions. Until live conversational reliability is verified, retain direct forms and identify fixture-powered demonstrations. This focused compatibility testing does not require the deferred comparative benchmark.

### Vision compatibility gate

A proposed message uses `content` parts with `type: "text"` and `type: "image_url"`, the latter containing a base64 data URL. **This shape is a hypothesis, not confirmed AMD behavior.** Isolate serialization in the adapter and verify against provider guidance or one authorized image request. Prefer inline image bytes if supported; do not make originals public merely to satisfy an assumed URL requirement. If a temporary signed URL is necessary, document its lifetime and exposure.

The first available consented image is enough for a compatibility smoke test; a benchmark dataset is not required. Until that test passes, use clearly labeled fixture responses for UI development and mark live extraction unverified. Never substitute fixtures silently after a production API failure.

### Extraction output

Request JSON only, Japanese text, visible evidence only, and `null` for unreadable or absent values. Image text is untrusted data, not instructions. Do not infer allergens, health claims, brand, weight, price or tax status from general knowledge.

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "name": "ほうじ茶",
      "description": null,
      "category": null,
      "priceJpy": null,
      "taxTreatment": "unknown",
      "evidenceText": "ほうじ茶",
      "uncertainFields": ["priceJpy"]
    }
  ],
  "warnings": []
}
```

Validate with a shared schema: bounded strings and arrays, no unknown writable fields, nonnegative integer or null price, tax enum `included | excluded | unknown`, maximum 20 candidates per image. Empty `items` is valid and means nothing confidently readable was found. Extracted names may be null if unreadable. Auto-create editable items from validated output; a missing required name is an inline validation issue that must be filled or the item removed before publication. Unknown prices remain publishable as null. Uncertainty flags are informational, not approval gates. Persist item currency as JPY in application code rather than trusting model output.

Allow removal of one enclosing JSON code fence; otherwise parse strictly. Reject invalid JSON, truncated completion, invalid schema, empty choices or unexpected content shape as controlled failures. Do not “repair” results by guessing missing facts. Optional one explicit retry is allowed; no unbounded repair loop. Model self-reported confidence is not calibrated accuracy.

### Jobs and retries

`queued → running → succeeded | failed`; validated extraction results automatically create saved unpublished catalog items and display editable cards in chat. No accept/reject queue or manual adoption step intervenes. Allocate idempotency keys per user/shop/image generation/prompt version and request intent. Duplicate client submissions return the same job. A Firestore-triggered worker claims a transaction-protected lease and writes internal provenance and catalog items with deterministic IDs, increments the shop revision and completes the job in one transaction. Retried delivery cannot recreate an item the owner has since edited or removed; use job completion/provenance records for deduplication. A stale worker cannot overwrite a newer attempt.

Start with one active extraction per owner, a configurable 20-request daily allowance, and conservative worker instance limits. Count attempts that reach the provider. Retry only timeouts, 429 and transient 5xx with bounded backoff, jitter and `Retry-After` where supplied; maximum two provider attempts per job. Do not retry authentication or malformed-request errors blindly. A lost response may still be billable; application idempotency does not guarantee provider exactly-once billing.

Use a scheduled recovery function to fail expired leases after a documented grace period; an explicit user retry creates a linked job and counts against quota. Configure trigger retries deliberately so they cannot create uncontrolled provider calls. Allowlist operational logs: job ID, requested/returned model, prompt version, latency, sanitized error class, token counts and optional provider request ID.

## 7. Application API and merchant behavior

Use same-origin JSON HTTP APIs under `/api`, Firebase bearer tokens, server-side validation and a consistent `{error: {code, message, retryable}}` envelope. Set request size limits. Cross-origin access, if required for local development, uses an explicit allowlist. [Firebase HTTP Functions](https://firebase.google.com/docs/functions/http-events)

| Command | Behavior |
|---|---|
| `POST /api/shops` | Validate profile and reserve slug transactionally |
| `PATCH /api/shops/:id` | Owner-only profile update with expected revision |
| `POST /api/shops/:id/uploads` | Allocate image ID/path and limits; browser uploads privately |
| `POST /api/shops/:id/extractions` | Validate completed upload, quota and idempotency; return 202 with job ID |
| `POST /api/shops/:id/items` | Create a saved unpublished item; extraction uses the same validated data contract automatically |
| `PATCH /api/shops/:id/items/:itemId` | Validate fields, reject stale revision with 409, invalidate outstanding publish confirmations |
| `POST /api/shops/:id/prepare-publication` | Validate current saved data and return change summary, immutable snapshot hash and short-lived confirmation ID; no preview visit required |
| `POST /api/shops/:id/publish` | Validate explicit confirmation and snapshot hash; enqueue static publication and return 202/job ID |
| `POST /api/shops/:id/unpublish` | Confirm removal and enqueue idempotent complete-site removal release |
| `POST /api/shops/:id/chat` | Persist message/attachments and enqueue bounded action planning; return request ID |
| `POST /api/shops/:id/actions/:actionId/apply` | Apply authorized proposal once with revision checks; never accepts arbitrary model operations |
| `POST /api/shops/:id/actions/:actionId/undo` | Apply validated inverse as a new draft revision |
| `PATCH /api/shops/:id/theme` | Validate preset/tokens, save draft revision and refresh preview |
| `POST /api/shops/:id/preview` | Return authenticated snapshot and hash for current revision; no public deployment |
| `DELETE /api/shops/:id/items/:itemId` | Delete private draft only if public references are resolved; explain republish requirement |

The UI shows upload, processing, saved/unpublished changes, publishing, failure and published states explicitly. Provide manual entry when extraction fails. Show photo and editable fields together; flag unknown prices and uncertain text. The sole publication gate is a change-summary confirmation. Product cards are optional editing controls, never required review tasks. Disable duplicate submissions locally and also enforce idempotency on the server. Sign-out clears private subscriptions and cached merchant data.

Public routes: `/s/:slug` and `/s/:slug/p/:itemId`. Include Japanese language metadata, escaped content, canonical URL, title, description and Open Graph tags. Product details and shop contact information must be in the first HTML response. Publish only the saved data covered by the owner’s confirmation; do not emit stock availability or offers unless they represent real supported facts. Demo shops are visibly labeled and `noindex`; exclude them from the sitemap. Add a validated map link only when the merchant supplies it. LINE sharing is optional; copy-link and QR suffice for MVP.

### Conversational workspace and visual direction

Use a polished modern interface with calm neutral surfaces, clear Japanese typography, generous spacing and product photography as the main visual content. Desktop has shop/catalog navigation, a central conversation and a resizable storefront preview. Mobile has Chat, Catalog and Preview tabs with a persistent publication status/action. Keep the owner workspace styling stable even when the storefront theme changes.

Messages can contain upload thumbnails, progress, editable product cards, field-level diffs, theme choices and action buttons. Users can manage every required field through forms as well as chat. Keep processing status visible without requiring token streaming. Announce asynchronous results accessibly, preserve focus while cards update and respect reduced motion. Label actions in Japanese; use `公開する` (Publish), not “deploy.”

After a completed edit batch, offer “この変更を公開しますか？” with a concise summary and Publish / Keep editing actions; Preview is optional. Summarize added, changed and removed products, profile fields, images and theme against the last live version. First publication summarizes the whole storefront. One confirmation publishes all valid saved items; there is no mandatory preview, review screen or item-by-item approval. Do not interrupt every keystroke with a confirmation. Bind the confirmation to the exact saved revision and snapshot hash. Concurrent edits or completed extraction jobs invalidate it and require a refreshed summary. If jobs are still running, wait for completion or cancellation before preparing the summary; never publish a misleading partial photo upload. Provide retry for failed builds and a live URL/QR only after a verified release.

### Curated AI-customized storefront themes

Ship three professionally designed templates: **Natural** (ivory/clay, spacious photography for crafts), **Botanical** (cream/green, soft imagery for tea or flowers), and **Modern** (crisp neutrals, strong typography for specialty retail). These are starting points, not assumptions about a shop's identity.

Generate a theme proposal from the merchant-confirmed category, shop description, brand preferences and optional logo colors. Select a template and allowlisted tokens: background/surface/text/accent colors, Japanese-safe font preset, spacing density, corner treatment and image aspect/crop preference. Validate contrast and token ranges before saving. If supplied colors fail contrast, suggest an accessible variant. Do not invent logos or change product photo colors.

The owner can say “make it warmer” or choose a preset directly. Save exact tokens and template version; ordinary product edits and republishing must not regenerate the design. Theme changes are drafts until published. Plain text copy edits join the saved changes and the same publish summary; do not add a separate copy-review step or invent factual claims.

Share CSS tokens, font assets and component/layout specifications between React preview and Astro. Verify parity at 360px, 768px and desktop widths using representative short/long Japanese names and missing images. Meet WCAG AA text contrast, visible keyboard focus, labeled fields and comfortable touch targets (aim for 44px). Avoid excessive animation, decorative gradients and crowded cards; provide clear hierarchy and consistent spacing. Static pages must remain usable without JavaScript.

## 8. Phased implementation for coding agents

Every phase must end with working demonstrable behavior, a brief status update, and evidence for its acceptance criteria. The tables above are the implementation contract. Tests using fixtures establish application behavior, not model quality.

### Phase 0 — Foundation and decisions

**Depends on:** none.

**Instructions:** scaffold TypeScript React/Vite, Astro and Functions workspaces, shared schemas and Firebase emulator configuration. Record runtime/package versions, project aliases and region decisions. Add `.env.example`, secret exclusions, CI build/typecheck and this specification. Add a Japanese chat/preview shell, three theme contracts and an Astro sample build. Document the Cloud Build runner and deployment identity requirements; do not introduce Next.js API routes.

**Acceptance:** clean install/build/typecheck succeeds; emulators start with documented commands; merchant deep links load; an Astro fixture produces static HTML; preview/template contracts are versioned; no secret in built assets; README identifies confirmed facts and pending vision compatibility.

### Phase 1 — Identity, shop profile and isolation

**Depends on:** Phase 0.

**Instructions:** implement Auth, profile creation/editing, unique slug reservation, owner-checked APIs, deny-by-default rules and owner-only reads. Implement revision checks before building later mutations.

**Acceptance:** owner A can create/reload a shop; owner B and anonymous users cannot read or change it; forged owner IDs and direct writes fail; concurrent duplicate slugs produce one winner; sign-in/reset/error states work on mobile.

### Phase 2 — Private photo upload and AMD adapter

**Depends on:** Phase 1.

**Instructions:** allocate private upload paths, validate/re-encode images, implement the adapter and prompt/schema versioning. Add a manual text connectivity check, separate from regular tests. Prepare fixture-based adapter tests. Perform one live image compatibility check when an authorized image becomes available; do not start a comparative evaluation project.

**Acceptance:** valid images preview privately; unsupported/oversized/corrupt images fail safely; cross-owner image access fails; text adapter reads the supplied response shape including prefixed model identity; timeouts, non-JSON and malformed responses are controlled errors. Record image test as passed or pending with evidence. Pending image verification does not block subsequent fixture-backed UI development, but blocks an AI-complete release claim.

### Phase 3 — Conversational management and automatic catalog updates

**Depends on:** Phase 2 application contracts; live vision verification may remain pending during development.

**Instructions:** implement job creation, quotas, transaction leases, bounded retries and recovery. Subscribe to job state in the merchant UI. Save validated extraction results directly as unpublished catalog items and show them in chat immediately. Retain internal provenance only. Implement optional manual editing/removal without candidate adoption, review queues or approval buttons. Add private conversation persistence, structured chat actions, field diffs, clarification, revision-checked Undo and direct-form alternatives. Add theme proposals and a private live preview.

**Acceptance:** duplicate requests do not create duplicate catalog items; competing workers cannot both finalize a job; expired leases become actionable failures; quotas hold under concurrent requests; uploaded photos produce saved items without a review step; nothing is published automatically; reload preserves saved items and job state; a failed extraction supports manual entry. Japanese chat can change a price, shop hours and theme; ambiguous requests ask for clarification; replayed or cross-owner actions fail; Undo cannot overwrite newer edits; extracted text cannot trigger commands; preview updates only after a successful save. Run live extraction and conversational action checks before claiming AI completeness.

### Phase 4 — Publish confirmation, Astro builds and static publishing

**Depends on:** Phase 3.

**Instructions:** build the single change-summary confirmation, revision-bound publication snapshots and unpublish. Optional editing/preview must not introduce another required step. Build Astro catalog/product HTML and selected media from immutable snapshots. Implement the background runner, full-site manifest assembly, serialized Hosting release, reconciliation and removal releases. Require explicit publication confirmation tied to the publication snapshot hash. Enforce item/document bounds and safe escaping.

**Acceptance:** a merchant can upload a photo and confirm publication without visiting a review/preview screen or approving any item; initial public HTML contains the confirmed data with JavaScript disabled; draft edits remain private; stale publish confirmations fail safely and show a refreshed summary; concurrent edits return 409; after a verified removal release, unpublished pages/media return 404; unknown routes return 404; public responses reveal no source paths, user IDs or raw AI metadata; malicious strings cannot execute HTML or script; a failed build preserves the old site; publishing shop A preserves shop B and the owner application; simultaneous publishes and an unpublish cannot lose or resurrect content; recovery reconciles a crash after Hosting release; one-shop rollback preserves other shops.

**Milestone:** a complete functional MVP. It is AI-complete only after real image extraction and conversational action checks pass.

### Phase 5 — Modern UI, theme polish and sharing

**Depends on:** Phase 4.

**Instructions:** add canonical metadata, sitemap, copy-link and QR, accessible responsive public pages, optional merchant-confirmed map link. Polish all three templates and chat/cards/preview layouts. Test preview-to-Astro visual parity, long Japanese text and missing images. Keep demo content visibly distinct. Add lightweight performance measurement.

**Acceptance:** QR opens the correct production catalog on a phone; metadata appears in raw HTML; sitemap includes only active non-demo catalogs; all actions work by keyboard; labels and focus states are present; 360px-wide screens have no horizontal overflow; errors explain the next action in Japanese; all three themes pass contrast and responsive checks; saved themes remain stable across product-only republishes; owners can finish the workflow using either chat cards or forms.

### Phase 6 — Release verification and demo

**Depends on:** Phases 0–5, live image compatibility and conversational action verification.

**Instructions:** run targeted unit tests, emulator authorization/concurrency tests and a browser test covering login → describe shop in chat → upload → edit product → optionally choose theme or preview → confirm change summary and publish → verify static release → unpublish. Deploy to staging, verify the complete live flow, document environment setup, secret binding, rollback and cleanup. Production deployment is a separate operational action from this documentation task.

**Acceptance:** real AMD extraction succeeds on an authorized image and is distinguishable from fixtures; owner isolation and public HTML tests pass; secrets are absent from client assets/logs; errors and quota limits are demonstrated; verified unpublish removes released files; multi-shop publication and release recovery checks pass; staging/production data are separated; rollback procedure is documented. Prepare a short demo showing real inference plus merchant corrections without claiming benchmark accuracy. If credentials/images are unavailable, report those checks as blocked, never passed.

### Phase 7 — Optional scope expansion

**Depends on:** release-ready MVP.

**Instructions:** add multi-item shelf extraction first, then menu extraction and optional LINE sharing. Reuse the same automatic-save and single publish-confirmation contracts. Display source-image crops and item-price associations as editable fields without per-item approval. Introduce no automatic product matching based solely on model guesses.

**Acceptance:** merchant can remove duplicate items, correct item/price pairing and change images, then publish all changes with one confirmation; existing single-product workflow remains intact. Skip this phase if it threatens core release readiness.

### Standalone workstream E — Deferred model evaluation

**Depends on:** stable adapter, consented images and manually labeled ground truth. Not a prerequisite for building or releasing the MVP after its single-image compatibility check.

**Instructions:** implement `scripts/evaluate-models.ts` as an explicitly invoked local CLI importing the same server-only adapter, prompts and schemas. It must not require Firebase, create catalog records, run in deployment, or be part of normal CI. It is a future implementation deliverable; this specification does not claim the script already exists.

Proposed interface:

```bash
npm run evaluate:models -- --manifest evaluation/manifest.json \
  --models MiniCPM-V-4.7-35B-A3B --out evaluation/results/run-001
```

- Manifest specifies image paths, task mode, ground-truth path and dataset version. Reject missing files before any paid call. No images means a clear “evaluation not run” result, never a zero-accuracy report.
- API key comes from the environment. Allow endpoint/model overrides explicitly. Other model names are user-supplied candidates, not assumed available or vision-capable.
- Default concurrency 1; support a maximum request count, timeout, dry run, resume and configurable repeats. Resume identity includes image hash, model, prompt, schema and repetition index.
- Record requested/returned model, dataset hash, prompt/schema version, request timestamp, latency, error category, retry count, token usage and optional reported cost. Save sanitized raw model content only locally with dataset consent; never store secrets or full provider metadata.
- Report schema-valid response rate, failure rate, exact normalized name/price correctness, null-versus-invented-field errors, and latency median/p95 with sample counts. Normalize Japanese width/Unicode and surrounding whitespace without removing meaningful characters. Measure name and price separately.
- For multi-item images, require reviewed prediction-to-ground-truth matching, or document a fixed deterministic matching rule before scoring precision/recall. Count false positives, misses and duplicate predictions. Do not use an unreviewed model judge as ground truth.
- Missing ground truth permits operational metrics only; accuracy is “not measured.” Distinguish unsupported models from low accuracy. Report per-image results and aggregate JSON/CSV/Markdown with denominators and small-sample limitations.
- Keep evaluation images and outputs ignored by default. Synthetic/fixture tests validate the runner, not real recognition quality.

**Acceptance:** dry run performs zero network requests; absent dataset fails helpfully; fixtures verify scoring and resume behavior; one real dataset run produces traceable per-image and aggregate output when data is available. Model replacement requires reviewed evidence and a deliberate configuration change, never an automatic switch based on one sample.

## 9. Coding-agent operating instructions

1. Read this specification and current project status before editing. Work on the next incomplete phase and preserve existing user changes.
2. Treat explicit requirements as binding and defaults as documented implementation choices. Record material departures and reasons before expanding scope.
3. Keep AMD serialization, prompts and normalization in reusable server-only modules so the app and deferred evaluation script use identical contracts.
4. Use fixtures for fast deterministic tests. Never imply fixtures are live inference or include paid provider calls in ordinary tests.
5. Enforce validation, owner authorization and expected revisions on the server even if the UI already checks them.
6. Run checks relevant to the changed behavior; include negative authorization tests whenever access boundaries change.
7. End each phase with changed behavior, files, checks run/results, remaining limitations and next phase. Update checkboxes and the decision log in this same document.
8. Never mark a phase complete solely because code exists. Record unrun deployment, vision or browser checks explicitly.
9. Use the documented background build runner for Astro publication. Do not add unrelated integrations or autonomous agent orchestration. AI proposes validated data/actions; trusted code controls writes and deployments.
10. Keep chat, direct forms and public templates on the same contracts. Publication must require an owner-confirmed revision and never be triggered solely by model output.

Suggested agent handoff:

> Implement the next incomplete phase of Shelf2Kumo-Implementation-Specification.md. Read current code and status first. Use Firebase Auth, Firestore, Cloud Functions, Firebase Hosting and private Cloud Storage image assets. Build the React/Vite conversational workspace, curated AI-customized themes and Astro static publication pipeline. Follow the specified AMD endpoint/model, save validated extraction results directly to unpublished catalog data and require only one change-summary confirmation before publishing; do not add review queues or per-item approval, and keep model evaluation standalone. Deliver working behavior with phase acceptance evidence. Update the specification/status with decisions, verification results and remaining blockers.

## 10. Progress and decision log

- [x] Editable implementation specification created.
- [x] Firebase architecture and frontend alternatives documented.
- [x] AMD text-request evidence incorporated; image support explicitly unverified.
- [ ] Phase 0: application foundation.
- [ ] Phase 1: identity and isolation.
- [ ] Phase 2: uploads and adapter.
- [ ] Live image compatibility gate.
- [x] Conversational workspace, theme generation and Astro publication requirements incorporated.
- [ ] Live conversational action verification.
- [ ] Phase 3: conversational management and automatic catalog updates.
- [ ] Phase 4: single publish confirmation, Astro builds and static publication.
- [ ] Phase 5: modern UI, theme parity, sharing and polish.
- [ ] Phase 6: release verification.
- [ ] Phase 7: optional shelf/menu expansion.
- [ ] Workstream E: standalone evaluation, deferred until dataset availability.

| Date | Decision | Reason / follow-up |
|---|---|---|
| 2026-10-15 | Replace earlier Supabase/Vercel design with Firebase services | Explicit user stack choice |
| 2026-10-15 | Adopt React/Vite chat workspace plus Astro static storefronts | Owner-approved direction; supersedes version 1.1 public renderer |
| 2026-10-15 | Add curated AI-customized themes and draft preview | Modern UI with stable, validated design tokens |
| 2026-10-15 | Require confirmed publication and background complete-site releases | Prevent accidental publication, lost shop files and stale build overwrites |
| 2026-10-15 | Remove separate review/adoption and per-item approval steps (v1.3) | User requested automatic saved catalog updates with one change-summary confirmation before publishing |
| 2026-10-15 | Add private Cloud Storage assets | Required persistence for product photographs |
| 2026-10-15 | Default to MiniCPM-V-4.7-35B-A3B at supplied AMD endpoint | Successful user-provided text request; image format remains a verification gate |
| 2026-10-15 | Defer comparative evaluation to standalone script | No test image dataset yet; evaluation must not delay application construction |

Implementation-time checks: actual Firebase project IDs/regions and billing prerequisites; current supported Node runtime; secret provisioning; first consented test image and accepted multimodal payload; retention settings; production domain; build runner identity/billing; Hosting release reconciliation and cache behavior; live chat-action compatibility; event submission requirements. None of these unknowns justify fabricated defaults or claims of completed deployment.
