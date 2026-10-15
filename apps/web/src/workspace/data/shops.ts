import type { ShopDoc } from '@shelf2kumo/contracts';
import { collection, doc, onSnapshot, query, where, type DocumentData } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase.ts';

export type ShopWithId = ShopDoc & { id: string };

type Loadable<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** Narrows a Firestore document to the client-visible shop fields. */
export function toShop(id: string, data: DocumentData): ShopWithId {
  return {
    id,
    ownerId: String(data.ownerId ?? ''),
    slug: String(data.slug ?? ''),
    slugLocked: data.slugLocked === true,
    name: String(data.name ?? ''),
    description: str(data.description),
    address: str(data.address),
    phone: str(data.phone),
    hours: str(data.hours),
    mapUrl: str(data.mapUrl),
    isDemo: data.isDemo === true,
    profileRevision: num(data.profileRevision),
    contentRevision: num(data.contentRevision),
    liveReleaseId: str(data.liveReleaseId),
    publishedRevision: typeof data.publishedRevision === 'number' ? data.publishedRevision : null,
  };
}

const LOAD_ERROR = 'データを読み込めませんでした。ページを再読み込みしてください。';

/** Live list of the signed-in owner's shops (rules allow only ownerId-constrained queries). */
export function useMyShops(uid: string): Loadable<ShopWithId[]> {
  const [state, setState] = useState<Loadable<ShopWithId[]>>({ status: 'loading' });
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'shops'), where('ownerId', '==', uid)),
        (snapshot) => {
          const shops = snapshot.docs.map((d) => toShop(d.id, d.data())).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
          setState({ status: 'ready', data: shops });
        },
        () => setState({ status: 'error', message: LOAD_ERROR }),
      ),
    [uid],
  );
  return state;
}

/** Live shop document; missing and not-owned shops both read as null (rules deny the latter). */
export function useShop(shopId: string): Loadable<ShopWithId | null> {
  const [state, setState] = useState<Loadable<ShopWithId | null>>({ status: 'loading' });
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'shops', shopId),
        (snapshot) => setState({ status: 'ready', data: snapshot.exists() ? toShop(snapshot.id, snapshot.data()) : null }),
        (error) => setState(error.code === 'permission-denied' ? { status: 'ready', data: null } : { status: 'error', message: LOAD_ERROR }),
      ),
    [shopId],
  );
  return state;
}
