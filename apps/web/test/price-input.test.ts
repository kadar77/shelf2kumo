import { describe, expect, it } from 'vitest';
import { parsePriceInput } from '../src/workspace/price.ts';

describe('parsePriceInput', () => {
  it('accepts Japanese-style price input', () => {
    expect(parsePriceInput('1320')).toBe(1320);
    expect(parsePriceInput('1,320')).toBe(1320);
    expect(parsePriceInput('１，３２０')).toBe(1320);
    expect(parsePriceInput('¥864')).toBe(864);
    expect(parsePriceInput('864円')).toBe(864);
    expect(parsePriceInput(' 0 ')).toBe(0);
  });

  it('treats empty as unknown and rejects non-integers', () => {
    expect(parsePriceInput('')).toBeNull();
    expect(parsePriceInput('   ')).toBeNull();
    expect(parsePriceInput('12.5')).toBeUndefined();
    expect(parsePriceInput('-5')).toBeUndefined();
    expect(parsePriceInput('時価')).toBeUndefined();
  });
});
