import { describe, expect, it } from 'vitest';
import {
  ExtractionOutput,
  LIMITS,
  MapUrl,
  PriceJpy,
  Slug,
  StorefrontSnapshot,
  ThemeTokens,
  snapshotByteSize,
} from '../src/index.ts';
import { demoShopSnapshot } from '../src/fixtures/index.ts';

describe('PriceJpy', () => {
  it('accepts nonnegative integers and null', () => {
    expect(PriceJpy.parse(0)).toBe(0);
    expect(PriceJpy.parse(1200)).toBe(1200);
    expect(PriceJpy.parse(null)).toBeNull();
  });

  it('rejects fractions, negatives and strings', () => {
    expect(PriceJpy.safeParse(12.5).success).toBe(false);
    expect(PriceJpy.safeParse(-1).success).toBe(false);
    expect(PriceJpy.safeParse('1200').success).toBe(false);
  });
});

describe('Slug', () => {
  it('accepts lowercase ASCII', () => {
    expect(Slug.safeParse('k3x9a2bq').success).toBe(true);
    expect(Slug.safeParse('demo').success).toBe(true);
  });

  it('rejects uppercase, Japanese, path characters and edge hyphens', () => {
    for (const value of ['Demo', 'こもれび', '../x', 'a/b', '-abc', 'abc-', 'ab']) {
      expect(Slug.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('MapUrl', () => {
  it('accepts https Google Maps links only', () => {
    expect(MapUrl.safeParse('https://maps.app.goo.gl/abc123').success).toBe(true);
    expect(MapUrl.safeParse('https://www.google.com/maps/place/x').success).toBe(true);
    expect(MapUrl.safeParse('http://maps.app.goo.gl/abc').success).toBe(false);
    expect(MapUrl.safeParse('https://evil.example/maps').success).toBe(false);
    expect(MapUrl.safeParse('javascript:alert(1)').success).toBe(false);
  });
});

describe('ThemeTokens', () => {
  it('rejects CSS injection through color values', () => {
    const result = ThemeTokens.safeParse({
      ...demoShopSnapshot.theme,
      colors: { ...demoShopSnapshot.theme.colors, accent: 'red;}body{display:none' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(ThemeTokens.safeParse({ ...demoShopSnapshot.theme, css: 'x' }).success).toBe(false);
  });
});

describe('ExtractionOutput', () => {
  const valid = {
    schemaVersion: 1,
    items: [
      {
        name: 'ほうじ茶',
        description: null,
        category: null,
        priceJpy: null,
        taxTreatment: 'unknown',
        evidenceText: 'ほうじ茶',
        uncertainFields: ['priceJpy'],
      },
    ],
    productCountEstimate: 1,
    warnings: [],
  };

  it('accepts the specified example', () => {
    expect(ExtractionOutput.safeParse(valid).success).toBe(true);
  });

  it('accepts empty items', () => {
    expect(ExtractionOutput.safeParse({ ...valid, items: [], productCountEstimate: 0 }).success).toBe(true);
  });

  it('rejects unknown writable fields such as currency', () => {
    const item = { ...valid.items[0], currency: 'USD' };
    expect(ExtractionOutput.safeParse({ ...valid, items: [item] }).success).toBe(false);
  });

  it('rejects more than 20 candidates', () => {
    const items = Array.from({ length: 21 }, () => valid.items[0]);
    expect(ExtractionOutput.safeParse({ ...valid, items }).success).toBe(false);
  });
});

describe('StorefrontSnapshot', () => {
  it('validates the demo fixture within the size limit', () => {
    expect(StorefrontSnapshot.parse(demoShopSnapshot)).toEqual(demoShopSnapshot);
    expect(snapshotByteSize(demoShopSnapshot)).toBeLessThan(LIMITS.snapshotMaxBytes);
  });

  it('rejects items without a name', () => {
    const items = [{ ...demoShopSnapshot.items[0], name: '' }];
    expect(StorefrontSnapshot.safeParse({ ...demoShopSnapshot, items }).success).toBe(false);
  });
});
