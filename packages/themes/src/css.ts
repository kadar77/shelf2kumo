import { ThemeTokens } from '@shelf2kumo/contracts';

/** System Japanese font stacks; no web font download (spec §9 font budget). */
export const FONT_STACKS: Record<ThemeTokens['fontPreset'], string> = {
  gothic:
    '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", YuGothic, "Noto Sans JP", Meiryo, system-ui, sans-serif',
  mincho: '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", serif',
};

const SPACING: Record<ThemeTokens['density'], string> = {
  compact: '12px',
  comfortable: '16px',
  spacious: '24px',
};

const RADIUS: Record<ThemeTokens['corners'], string> = {
  square: '0px',
  soft: '8px',
  round: '16px',
};

const ASPECT: Record<ThemeTokens['imageAspect'], string> = {
  '1:1': '1 / 1',
  '4:3': '4 / 3',
  '3:4': '3 / 4',
};

export type ThemeCssVars = Record<`--sf-${string}`, string>;

/** Maps validated tokens to CSS custom properties consumed by storefront.css. */
export function themeToCssVars(input: ThemeTokens): ThemeCssVars {
  const tokens = ThemeTokens.parse(input);
  return {
    '--sf-bg': tokens.colors.background,
    '--sf-surface': tokens.colors.surface,
    '--sf-text': tokens.colors.text,
    '--sf-muted': tokens.colors.mutedText,
    '--sf-accent': tokens.colors.accent,
    '--sf-accent-text': tokens.colors.accentText,
    '--sf-font': FONT_STACKS[tokens.fontPreset],
    '--sf-space': SPACING[tokens.density],
    '--sf-radius': RADIUS[tokens.corners],
    '--sf-aspect': ASPECT[tokens.imageAspect],
  };
}

/** Serializes CSS variables into a single rule for the storefront's inline token block. */
export function cssVarsToRule(vars: ThemeCssVars, selector = '.sf'): string {
  const body = Object.entries(vars)
    .map(([name, value]) => {
      if (/[;{}<>\\]/.test(value)) throw new Error(`Unsafe CSS value for ${name}`);
      return `${name}:${value};`;
    })
    .join('');
  return `${selector}{${body}}`;
}
