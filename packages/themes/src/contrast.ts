import type { ThemeTokens } from '@shelf2kumo/contracts';

/** WCAG AA minimum for normal text. */
export const AA_TEXT_CONTRAST = 4.5;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Invalid color: ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => parseInt(part as string, 16)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

export interface ContrastFailure {
  pair: string;
  ratio: number;
  required: number;
}

const PAIRS: Array<[string, keyof ThemeTokens['colors'], keyof ThemeTokens['colors']]> = [
  ['text/background', 'text', 'background'],
  ['text/surface', 'text', 'surface'],
  ['mutedText/background', 'mutedText', 'background'],
  ['mutedText/surface', 'mutedText', 'surface'],
  ['accentText/accent', 'accentText', 'accent'],
  ['accent/background', 'accent', 'background'],
];

/** Returns every text/background pair below WCAG AA. An empty array means the theme may be saved. */
export function checkThemeContrast(tokens: ThemeTokens): ContrastFailure[] {
  return PAIRS.flatMap(([pair, fg, bg]) => {
    const ratio = contrastRatio(tokens.colors[fg], tokens.colors[bg]);
    return ratio < AA_TEXT_CONTRAST ? [{ pair, ratio: Math.round(ratio * 100) / 100, required: AA_TEXT_CONTRAST }] : [];
  });
}
