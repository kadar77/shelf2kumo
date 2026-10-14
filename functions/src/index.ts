import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { handleApiRequest } from './api/handler.ts';
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

initializeApp();

let source: SnapshotSource | undefined;
function snapshotSource(): SnapshotSource {
  source ??= shouldUseFixtures(process.env) ? fixtureSnapshotSource : firestoreSnapshotSource(getFirestore());
  return source;
}

export const api = onRequest({ memory: '256MiB' }, (req, res) => {
  const result = handleApiRequest({ method: req.method, path: req.path });
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
      log: (message, data) => logger.error(message, data),
    },
  );
  res.status(result.status).set(result.headers).send(result.body);
});
