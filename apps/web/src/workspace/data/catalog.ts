import type { ItemDoc, ItemField, JobDoc, JobErrorCode, JobOutcome, JobState } from '@shelf2kumo/contracts';
import { collection, limit, onSnapshot, orderBy, query, type DocumentData } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firestore.ts';

export type ItemWithId = ItemDoc & { id: string };
export type JobWithId = JobDoc & { id: string };

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const TAX = new Set(['included', 'excluded', 'unknown']);
const FIELDS = new Set<ItemField>(['name', 'description', 'category', 'priceJpy', 'taxTreatment']);

export function toItem(id: string, data: DocumentData): ItemWithId {
  return {
    id,
    name: str(data.name),
    description: str(data.description),
    category: str(data.category),
    priceJpy: typeof data.priceJpy === 'number' ? data.priceJpy : null,
    currency: 'JPY',
    taxTreatment: TAX.has(data.taxTreatment) ? data.taxTreatment : 'unknown',
    imageId: str(data.imageId),
    order: typeof data.order === 'number' ? data.order : 0,
    revision: typeof data.revision === 'number' ? data.revision : 0,
    sourceJobId: str(data.sourceJobId),
    uncertainFields: Array.isArray(data.uncertainFields) ? data.uncertainFields.filter((f: ItemField) => FIELDS.has(f)) : [],
  };
}

function toJob(id: string, data: DocumentData): JobWithId {
  const error = data.error && typeof data.error === 'object' ? data.error : null;
  return {
    id,
    ownerId: String(data.ownerId ?? ''),
    imageId: String(data.imageId ?? ''),
    mode: 'single',
    state: (data.state as JobState) ?? 'queued',
    outcome: (data.outcome as JobOutcome | null) ?? null,
    itemId: str(data.itemId),
    productCountEstimate: typeof data.productCountEstimate === 'number' ? data.productCountEstimate : null,
    attempt: typeof data.attempt === 'number' ? data.attempt : 0,
    retryOf: str(data.retryOf),
    error: error ? { code: error.code as JobErrorCode, message: String(error.message ?? ''), retryable: error.retryable === true } : null,
    model: str(data.model),
  };
}

/** Live catalog items in display order. */
export function useItems(shopId: string): ItemWithId[] | null {
  const [items, setItems] = useState<ItemWithId[] | null>(null);
  useEffect(
    () =>
      onSnapshot(query(collection(db, 'shops', shopId, 'items'), orderBy('order')), (snapshot) =>
        setItems(snapshot.docs.map((d) => toItem(d.id, d.data()))),
      ),
    [shopId],
  );
  return items;
}

/** Live recent extraction jobs, newest first. */
export function useJobs(shopId: string): JobWithId[] {
  const [jobs, setJobs] = useState<JobWithId[]>([]);
  useEffect(
    () =>
      onSnapshot(query(collection(db, 'shops', shopId, 'jobs'), orderBy('createdAt', 'desc'), limit(30)), (snapshot) =>
        setJobs(snapshot.docs.map((d) => toJob(d.id, d.data()))),
      ),
    [shopId],
  );
  return jobs;
}
