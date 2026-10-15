import { extract, loadAmdConfig, planChat } from '@shelf2kumo/ai';
import { initializeApp } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineBoolean, defineSecret, defineString } from 'firebase-functions/params';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';
import { createApiHandler } from './api/handler.ts';
import { fixturePlanner } from './chat/fixture.ts';
import { recoverChatRequests } from './chat/recovery.ts';
import { firestoreChatService } from './chat/service.ts';
import { runChatRequest, type Planner } from './chat/worker.ts';
import { fixtureExtractor, useExtractionFixtures } from './extraction/fixture.ts';
import { firestoreExtractionJobService } from './extraction/jobs.ts';
import { recoverExtractionJobs } from './extraction/recovery.ts';
import { runExtractionJob, type Extractor } from './extraction/worker.ts';
import type { ApiRequest, ApiResponse } from './api/http.ts';
import { cleanupAbandonedUploads } from './images/cleanup.ts';
import { firestoreImageService } from './images/service.ts';
import { firebaseObjectStore } from './images/store.ts';
import { firestoreItemService } from './items/service.ts';
import { amdReachabilityCheck } from './ops/amd-check.ts';
import { firestorePublishingService } from './publishing/service.ts';
import { firestoreShopService } from './shops/service.ts';
import { firestoreThemeService } from './theme/service.ts';
import { STOREFRONT_CSS_HREF } from './storefront/config.ts';
import { handleStorefrontRequest } from './storefront/handler.ts';
import { firestoreSnapshotSource, fixtureSnapshotSource, shouldUseFixtures, type SnapshotSource } from './storefront/source.ts';

/** Region proposed in spec §3; verify availability before provisioning. Must match firebase.json rewrites. */
const REGION = 'asia-northeast1';

setGlobalOptions({ region: REGION, maxInstances: 10 });

/** Canonical public origin for storefront URLs; never derived from request headers. */
const publicOrigin = defineString('PUBLIC_ORIGIN', {
  description: 'Public origin for canonical storefront URLs, e.g. https://<project>.web.app',
});

/** Enforce App Check on /api once a reCAPTCHA Enterprise site key is configured for the web app. */
const appCheckEnforce = defineBoolean('APP_CHECK_ENFORCE', {
  default: false,
  description: 'Require a valid App Check token on /api requests',
});

/** AMD credentials and endpoint (spec §8). The key is bound only to functions that call AMD. */
const amdApiKey = defineSecret('AMD_API_KEY');
const amdBaseUrl = defineString('AMD_BASE_URL', { default: 'https://developer.amd.com.cn/radeon/api' });
const amdModel = defineString('AMD_MODEL', { default: 'MiniCPM-V-4.7-35B-A3B' });
const amdTimeoutMs = defineString('AMD_REQUEST_TIMEOUT_MS', { default: '60000' });
/**
 * Ordered chat-planning models: one attempt each, falling back on rate limits, timeouts or invalid
 * output. The shared hackathon endpoint's per-model availability varies (spec §12).
 */
const amdChatModels = defineString('AMD_CHAT_MODELS', { default: 'MiniCPM-V-4.7-35B-A3B,DeepSeek-V4.1-Flash,Qwen3.8-Flash-Next' });
const amdChatTimeoutMs = defineString('AMD_CHAT_TIMEOUT_MS', { default: '30000' });

initializeApp();

const amdConfig = (model = amdModel.value(), timeoutMs = amdTimeoutMs.value()) =>
  loadAmdConfig({
    AMD_API_KEY: amdApiKey.value(),
    AMD_BASE_URL: amdBaseUrl.value(),
    AMD_MODEL: model,
    AMD_REQUEST_TIMEOUT_MS: timeoutMs,
  });

let source: SnapshotSource | undefined;
function snapshotSource(): SnapshotSource {
  source ??= shouldUseFixtures(process.env) ? fixtureSnapshotSource : firestoreSnapshotSource(getFirestore());
  return source;
}

let apiHandler: ((request: ApiRequest) => Promise<ApiResponse>) | undefined;
function getApiHandler() {
  apiHandler ??= createApiHandler({
    shops: firestoreShopService(getFirestore()),
    images: firestoreImageService(getFirestore(), firebaseObjectStore()),
    items: firestoreItemService(getFirestore()),
    extractions: firestoreExtractionJobService(getFirestore()),
    chat: firestoreChatService(getFirestore(), firestoreExtractionJobService(getFirestore())),
    themes: firestoreThemeService(getFirestore()),
    publishing: firestorePublishingService(getFirestore(), () => publicOrigin.value()),
    verifyIdToken: (token) => getAuth().verifyIdToken(token),
    verifyAppCheckToken: (token) => getAppCheck().verifyToken(token),
    appCheckEnforced: appCheckEnforce.value(),
    log: (message, data) => logger.error(message, data),
  });
  return apiHandler;
}

// Image processing (sharp) runs in the API; limit concurrency so decodes fit in memory.
export const api = onRequest({ memory: '1GiB', concurrency: 16, timeoutSeconds: 60 }, async (req, res) => {
  const result = await getApiHandler()({
    method: req.method,
    path: req.path,
    header: (name) => req.get(name),
    body: req.body,
    rawBodyBytes: req.rawBody?.length ?? 0,
  });
  res.set('Cache-Control', 'private, no-store');
  res.status(result.status).json(result.body);
});

export const storefront = onRequest({ memory: '256MiB' }, async (req, res) => {
  const result = await handleStorefrontRequest(
    { method: req.method, path: req.path },
    {
      source: snapshotSource(),
      origin: publicOrigin.value(),
      cssHref: STOREFRONT_CSS_HREF,
      readMedia: (path) => firebaseObjectStore().read(path),
      log: (message, data) => logger.error(message, data),
    },
  );
  res.status(result.status).set(result.headers).send(result.body);
});

/** Removes stale allocations and rejected uploads (spec §6 retention). */
export const cleanupUploads = onSchedule({ schedule: 'every 6 hours', timeZone: 'Asia/Tokyo', memory: '256MiB' }, async () => {
  const removed = await cleanupAbandonedUploads(getFirestore(), firebaseObjectStore());
  logger.info('cleanupUploads finished', { removed });
});

/**
 * Operator-only AMD reachability check (spec P0-4). Not public: callers need run.invoker IAM,
 * e.g. `curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" <url>`.
 */
export const opsAmdCheck = onRequest({ invoker: 'private', secrets: [amdApiKey], memory: '256MiB', timeoutSeconds: 120 }, async (_req, res) => {
  const evidence = await amdReachabilityCheck(amdConfig(), REGION);
  logger.info('opsAmdCheck', evidence);
  res.set('Cache-Control', 'no-store');
  res.status(evidence.outcome === 'passed' ? 200 : 502).json(evidence);
});

/** Live AMD extraction, or the labeled fixture extractor inside the emulator (never deployed). */
function extractor(): Extractor {
  if (useExtractionFixtures(process.env)) return fixtureExtractor(getFirestore());
  const config = amdConfig();
  return (request) => extract(config, request);
}

/**
 * Extraction worker (spec §8). Runs when a job is created or re-kicked while queued. Automatic
 * trigger retries stay off so redelivery cannot multiply provider calls; leases and the recovery
 * schedule handle crashes.
 */
export const extractionWorker = onDocumentWritten(
  { document: 'shops/{shopId}/jobs/{jobId}', secrets: [amdApiKey], timeoutSeconds: 300, memory: '512MiB', maxInstances: 5, retry: false },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || after.state !== 'queued') return;
    if (before && before.state === 'queued' && before.kick === after.kick) return;
    const result = await runExtractionJob(
      {
        db: getFirestore(),
        store: firebaseObjectStore(),
        extractor: extractor(),
        log: (message, data) => logger.info(message, data),
      },
      event.params.shopId,
      event.params.jobId,
    );
    logger.info('extractionWorker finished', { jobId: event.params.jobId, result });
  },
);

/** Fails expired leases and wakes stalled queues (spec §8 recovery). */
export const recoverExtractions = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Asia/Tokyo', memory: '256MiB' }, async () => {
  const result = await recoverExtractionJobs(getFirestore());
  const chat = await recoverChatRequests(getFirestore());
  if (result.expired > 0 || result.kicked > 0 || chat > 0) logger.info('recoverExtractions', { ...result, chatRequestsFailed: chat });
});

/** Live chat planner with model fallback, or the labeled fixture planner inside the emulator. */
function chatPlanning(): { planner: Planner; maxAttempts: number } {
  if (useExtractionFixtures(process.env)) return { planner: fixturePlanner(getFirestore()), maxAttempts: 2 };
  const configs = amdChatModels
    .value()
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
    .map((model) => amdConfig(model, amdChatTimeoutMs.value()));
  return {
    planner: ({ context, text }, attempt) => planChat(configs[(attempt - 1) % configs.length] ?? configs[0]!, { context, text }),
    maxAttempts: Math.max(1, configs.length),
  };
}

/** Chat action planning (spec §8). Text requests only; automatic trigger retries stay off. */
export const chatWorker = onDocumentCreated(
  { document: 'shops/{shopId}/chatRequests/{requestId}', secrets: [amdApiKey], timeoutSeconds: 180, memory: '512MiB', maxInstances: 5, retry: false },
  async (event) => {
    if (event.data?.get('state') !== 'queued') return;
    const { planner, maxAttempts } = chatPlanning();
    await runChatRequest(
      { db: getFirestore(), planner, maxAttempts, log: (message, data) => logger.info(message, data) },
      event.params.shopId,
      event.params.requestId,
    );
  },
);
