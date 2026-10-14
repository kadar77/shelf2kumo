import type { StorefrontSnapshot } from '@shelf2kumo/contracts';
import { demoShopSnapshot } from '@shelf2kumo/contracts/fixtures';

/**
 * FIXTURE data source for the Phase 0 shell. Replaced by authenticated Firestore subscriptions in
 * Phase 1–3. The UI labels this data as デモデータ wherever it appears.
 */
export const fixtureShops: Record<string, StorefrontSnapshot> = {
  demo: demoShopSnapshot,
};
