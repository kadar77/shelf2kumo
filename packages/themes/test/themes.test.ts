import type { ThemeTokens } from '@shelf2kumo/contracts';
import { describe, expect, it } from 'vitest';
import { PRESETS, checkThemeContrast, contrastRatio, cssVarsToRule, themeToCssVars } from '../src/index.ts';

describe('contrastRatio', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('presets', () => {
  it.each(Object.values(PRESETS))('$templateId passes WCAG AA', (preset) => {
    expect(checkThemeContrast(preset)).toEqual([]);
  });

  it('reports failing pairs', () => {
    const lowContrast: ThemeTokens = {
      ...PRESETS.modern,
      colors: { ...PRESETS.modern.colors, mutedText: '#cccccc' },
    };
    expect(checkThemeContrast(lowContrast).map((f) => f.pair)).toContain('mutedText/background');
  });
});

describe('themeToCssVars', () => {
  it('produces a single scoped rule from validated tokens', () => {
    const rule = cssVarsToRule(themeToCssVars(PRESETS.modern));
    expect(rule.startsWith('.sf{--sf-bg:#fafaf8;')).toBe(true);
    expect(rule.endsWith('}')).toBe(true);
    expect(rule).not.toMatch(/[<>]/);
  });

  it('rejects tokens that fail schema validation', () => {
    const bad = { ...PRESETS.modern, colors: { ...PRESETS.modern.colors, text: 'red' } };
    expect(() => themeToCssVars(bad)).toThrow();
  });
});
