import type { StorefrontSnapshot } from '@shelf2kumo/contracts';
import { demoShopSnapshot } from '@shelf2kumo/contracts/fixtures';
import { PALETTES } from '@shelf2kumo/themes';
import { describe, expect, it } from 'vitest';
import { canonicalJson, snapshotHash, summarizeChanges } from '../src/publishing/snapshot.ts';

const live: StorefrontSnapshot = { ...demoShopSnapshot, shop: { ...demoShopSnapshot.shop, isDemo: false } };

describe('summarizeChanges', () => {
  it('describes a first publication', () => {
    expect(summarizeChanges(live, null)).toMatchObject({ firstPublication: true, itemCount: 3, added: live.items.map((item) => item.name) });
  });

  it('reports no changes for an identical draft', () => {
    expect(summarizeChanges(structuredClone(live), live)).toMatchObject({ firstPublication: false, noChanges: true });
  });

  it('lists added, removed and changed items, profile, theme and order', () => {
    const [a, b, c] = live.items as [StorefrontSnapshot['items'][number], StorefrontSnapshot['items'][number], StorefrontSnapshot['items'][number]];
    const draft: StorefrontSnapshot = {
      ...live,
      shop: { ...live.shop, hours: '10:00〜19:00' },
      theme: { ...live.theme, colors: PALETTES.warm.colors },
      items: [{ ...b, priceJpy: 1500 }, a, { ...c, id: 'newItem', name: '新商品' }],
    };
    const summary = summarizeChanges(draft, live);
    expect(summary).toMatchObject({
      added: ['新商品'],
      removed: [c.name],
      changed: [{ name: b.name, fields: ['priceJpy'] }],
      profileFields: ['hours'],
      themeChanged: true,
      orderChanged: true,
      noChanges: false,
    });
  });
});

describe('snapshotHash', () => {
  it('does not depend on object key order', () => {
    const reordered = JSON.parse(canonicalJson(live)) as StorefrontSnapshot;
    expect(snapshotHash(reordered)).toBe(snapshotHash(live));
    expect(snapshotHash({ ...live, shop: { ...live.shop, name: '別名' } })).not.toBe(snapshotHash(live));
  });
});
