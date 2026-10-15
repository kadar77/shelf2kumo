import { PaletteName } from '@shelf2kumo/contracts';
import { describe, expect, it } from 'vitest';
import { PALETTES, PRESETS, accessibleAccent, applyThemeChoice, checkThemeContrast, contrastRatio, paletteOf } from '../src/index.ts';

describe('palettes', () => {
  it.each(PaletteName.options)('%s passes WCAG AA', (name) => {
    expect(checkThemeContrast({ ...PRESETS.modern, colors: PALETTES[name].colors })).toEqual([]);
  });

  it('identifies a palette by its colors', () => {
    expect(paletteOf(PALETTES.warm.colors)).toBe('warm');
    expect(paletteOf({ ...PALETTES.warm.colors, accent: '#123456' })).toBeNull();
  });
});

describe('accessibleAccent', () => {
  it('keeps an accent that already passes', () => {
    expect(accessibleAccent('#1f4e5f', PALETTES.modern.colors)).toEqual({ accent: '#1f4e5f', accentText: '#ffffff', adjusted: false });
  });

  it('darkens a light logo color on a light background until it passes', () => {
    const result = accessibleAccent('#FFD700', PALETTES.modern.colors);
    expect(result.adjusted).toBe(true);
    expect(contrastRatio(result.accent, PALETTES.modern.colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(result.accent, result.accentText)).toBeGreaterThanOrEqual(4.5);
  });

  it('lightens a dark accent on the dark palette and accepts #rgb', () => {
    const result = accessibleAccent('#300', PALETTES.dark.colors);
    expect(contrastRatio(result.accent, PALETTES.dark.colors.background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('applyThemeChoice', () => {
  it('switches palette and keeps other tokens unless chosen', () => {
    const { tokens } = applyThemeChoice(PRESETS.modern, { palette: 'warm', fontPreset: 'mincho' });
    expect(tokens.colors).toEqual(PALETTES.warm.colors);
    expect(tokens.fontPreset).toBe('mincho');
    expect(tokens.density).toBe(PRESETS.modern.density);
    expect(checkThemeContrast(tokens)).toEqual([]);
  });

  it('always yields an accessible theme with a custom accent', () => {
    const { tokens, accentAdjusted } = applyThemeChoice(PRESETS.modern, { accent: '#ffff66' });
    expect(accentAdjusted).toBe(true);
    expect(checkThemeContrast(tokens)).toEqual([]);
  });
});
