import { normalizeHex, type PaletteName, type ThemeTokens } from '@shelf2kumo/contracts';
import { AA_TEXT_CONTRAST, checkThemeContrast, contrastRatio, relativeLuminance } from './contrast.ts';
import { PRESETS } from './presets.ts';

type Colors = ThemeTokens['colors'];

/** Named palettes for the Modern template. Every palette passes WCAG AA (unit-tested). */
export const PALETTES: Record<PaletteName, { label: string; colors: Colors }> = {
  modern: { label: 'モダン', colors: PRESETS.modern.colors },
  warm: {
    label: 'あたたかみ',
    colors: { background: '#faf6f0', surface: '#ffffff', text: '#2b2118', mutedText: '#6b5a4a', accent: '#9a4a24', accentText: '#ffffff' },
  },
  cool: {
    label: 'すっきり',
    colors: { background: '#f5f7fa', surface: '#ffffff', text: '#18212b', mutedText: '#4f5b67', accent: '#1f5fa8', accentText: '#ffffff' },
  },
  green: {
    label: 'ボタニカル',
    colors: { background: '#f4f7f1', surface: '#ffffff', text: '#1e281b', mutedText: '#4d5a48', accent: '#2f6b3a', accentText: '#ffffff' },
  },
  mono: {
    label: 'モノトーン',
    colors: { background: '#ffffff', surface: '#f7f7f7', text: '#111111', mutedText: '#555555', accent: '#111111', accentText: '#ffffff' },
  },
  dark: {
    label: 'ダーク',
    colors: { background: '#1a1a1c', surface: '#242427', text: '#f2f2f2', mutedText: '#b9b9be', accent: '#e2b65e', accentText: '#1a1a1c' },
  },
};

/** Returns the palette whose colors equal the given ones, if any. */
export function paletteOf(colors: Colors): PaletteName | null {
  for (const [name, palette] of Object.entries(PALETTES) as Array<[PaletteName, { colors: Colors }]>) {
    if (Object.entries(palette.colors).every(([key, value]) => colors[key as keyof Colors] === value)) return name;
  }
  return null;
}

function mix(hex: string, target: '#000000' | '#ffffff', amount: number): string {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const goal = target === '#000000' ? 0 : 255;
  return `#${channels.map((c) => Math.round(c + (goal - c) * amount).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Makes an owner- or model-supplied accent usable: picks white or near-black accent text, then moves
 * the accent toward black (light backgrounds) or white (dark backgrounds) until both the accent text
 * and the accent-on-background pairs reach WCAG AA.
 */
export function accessibleAccent(requested: string, colors: Colors): { accent: string; accentText: string; adjusted: boolean } {
  const base = normalizeHex(requested);
  const darkBackground = relativeLuminance(colors.background) < 0.2;
  for (let step = 0; step <= 20; step += 1) {
    const accent = step === 0 ? base : mix(base, darkBackground ? '#ffffff' : '#000000', step * 0.05);
    const accentText = contrastRatio(accent, '#ffffff') >= contrastRatio(accent, colors.text) ? '#ffffff' : colors.text;
    if (contrastRatio(accent, accentText) >= AA_TEXT_CONTRAST && contrastRatio(accent, colors.background) >= AA_TEXT_CONTRAST) {
      return { accent, accentText, adjusted: step > 0 };
    }
  }
  return { accent: colors.accent, accentText: colors.accentText, adjusted: true };
}

export interface ThemeChoice {
  palette?: PaletteName;
  accent?: string;
  fontPreset?: ThemeTokens['fontPreset'];
  density?: ThemeTokens['density'];
  corners?: ThemeTokens['corners'];
  imageAspect?: ThemeTokens['imageAspect'];
}

/** Applies a theme choice to the current tokens; the result always passes the contrast check. */
export function applyThemeChoice(current: ThemeTokens, choice: ThemeChoice): { tokens: ThemeTokens; accentAdjusted: boolean } {
  let colors: Colors = choice.palette ? { ...PALETTES[choice.palette].colors } : { ...current.colors };
  let accentAdjusted = false;
  if (choice.accent) {
    const result = accessibleAccent(choice.accent, colors);
    colors = { ...colors, accent: result.accent, accentText: result.accentText };
    accentAdjusted = result.adjusted;
  }
  const tokens: ThemeTokens = {
    ...current,
    colors,
    fontPreset: choice.fontPreset ?? current.fontPreset,
    density: choice.density ?? current.density,
    corners: choice.corners ?? current.corners,
    imageAspect: choice.imageAspect ?? current.imageAspect,
  };
  if (checkThemeContrast(tokens).length > 0) return { tokens: current, accentAdjusted: false };
  return { tokens, accentAdjusted };
}
