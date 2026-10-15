import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { FIRESTORE_HOST, PROJECT_ID } from '../support/emulators.ts';

const rulesPath = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const [host, port] = FIRESTORE_HOST.split(':') as [string, string];

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(rulesPath, 'utf8'), host, port: Number(port) },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'shops/shopA'), { ownerId: 'ownerA', slug: 'shopa123', name: 'A のお店', profileRevision: 0 });
    await setDoc(doc(db, 'shops/shopA/items/item1'), { name: 'ほうじ茶', priceJpy: 864 });
    await setDoc(doc(db, 'shops/shopA/releases/rel1'), { snapshot: { schemaVersion: 1 } });
    await setDoc(doc(db, 'shops/shopB'), { ownerId: 'ownerB', slug: 'shopb123', name: 'B のお店', profileRevision: 0 });
    await setDoc(doc(db, 'slugReservations/shopa123'), { shopId: 'shopA' });
    await setDoc(doc(db, 'publishedCatalogs/shopa123'), { shopId: 'shopA', releaseId: 'rel1' });
    await setDoc(doc(db, 'usage/ownerA_20261015'), { extractionAttempts: 1 });
  });
});

const ownerA = () => env.authenticatedContext('ownerA').firestore();
const ownerB = () => env.authenticatedContext('ownerB').firestore();
const anonymous = () => env.unauthenticatedContext().firestore();

describe('owner isolation (P1-1)', () => {
  it('lets an owner read their shop and its subcollections', async () => {
    await assertSucceeds(getDoc(doc(ownerA(), 'shops/shopA')));
    await assertSucceeds(getDoc(doc(ownerA(), 'shops/shopA/items/item1')));
    await assertSucceeds(getDocs(collection(ownerA(), 'shops/shopA/items')));
  });

  it('lets an owner list only their own shops', async () => {
    await assertSucceeds(getDocs(query(collection(ownerA(), 'shops'), where('ownerId', '==', 'ownerA'))));
    await assertFails(getDocs(query(collection(ownerA(), 'shops'), where('ownerId', '==', 'ownerB'))));
    await assertFails(getDocs(collection(ownerA(), 'shops')));
  });

  it("denies another owner's reads", async () => {
    await assertFails(getDoc(doc(ownerB(), 'shops/shopA')));
    await assertFails(getDoc(doc(ownerB(), 'shops/shopA/items/item1')));
    await assertFails(getDocs(collection(ownerB(), 'shops/shopA/items')));
  });

  it('denies anonymous reads', async () => {
    await assertFails(getDoc(doc(anonymous(), 'shops/shopA')));
    await assertFails(getDoc(doc(anonymous(), 'shops/shopA/items/item1')));
    await assertFails(getDocs(query(collection(anonymous(), 'shops'), where('ownerId', '==', 'ownerA'))));
  });

  it('keeps release snapshots server-only, even for the owner', async () => {
    await assertFails(getDoc(doc(ownerA(), 'shops/shopA/releases/rel1')));
  });
});

describe('server-only collections', () => {
  it.each(['slugReservations/shopa123', 'publishedCatalogs/shopa123', 'usage/ownerA_20261015'])('denies reads of %s', async (path) => {
    await assertFails(getDoc(doc(ownerA(), path)));
    await assertFails(getDoc(doc(anonymous(), path)));
  });
});

describe('direct client writes (P1-2)', () => {
  it('denies every write, including by the owner and with a forged ownerId', async () => {
    await assertFails(updateDoc(doc(ownerA(), 'shops/shopA'), { name: '変更' }));
    await assertFails(setDoc(doc(ownerA(), 'shops/newShop'), { ownerId: 'ownerA', name: '新しいお店' }));
    await assertFails(setDoc(doc(ownerB(), 'shops/forged'), { ownerId: 'ownerA', name: '偽装' }));
    await assertFails(setDoc(doc(ownerA(), 'shops/shopA/items/item2'), { name: '追加' }));
    await assertFails(setDoc(doc(ownerA(), 'slugReservations/taken'), { shopId: 'shopA' }));
    await assertFails(setDoc(doc(ownerA(), 'publishedCatalogs/shopa123'), { shopId: 'shopA', releaseId: 'x' }));
    await assertFails(setDoc(doc(anonymous(), 'shops/anon'), { ownerId: 'anon' }));
  });
});
