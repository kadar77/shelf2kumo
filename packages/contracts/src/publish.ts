import { z } from 'zod';
import { ContentHash, DocId } from './common.ts';

/** Publish confirmations expire after this long (spec §6). */
export const CONFIRMATION_TTL_MS = 10 * 60_000;

/** What will change on the public page, compared with the live release (spec §9). */
export interface ChangeSummary {
  firstPublication: boolean;
  itemCount: number;
  added: string[];
  removed: string[];
  changed: Array<{ name: string; fields: string[] }>;
  profileFields: string[];
  themeChanged: boolean;
  orderChanged: boolean;
  /** True when the draft equals the live release. */
  noChanges: boolean;
}

export interface PreparePublicationResponse {
  confirmationId: string;
  snapshotHash: string;
  summary: ChangeSummary;
  expiresAt: string;
  url: string;
}

export const PublishRequest = z.strictObject({
  confirmationId: DocId,
  snapshotHash: ContentHash,
});
export type PublishRequest = z.infer<typeof PublishRequest>;

export interface PublishResponse {
  releaseId: string;
  url: string;
}
