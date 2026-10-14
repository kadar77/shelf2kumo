import { z } from 'zod';

/** Shipped templates. Natural and Botanical are Should-tier and join this enum when implemented. */
export const TemplateId = z.enum(['modern']);
export type TemplateId = z.infer<typeof TemplateId>;

export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/, 'Lowercase #rrggbb color');

export const FontPreset = z.enum(['gothic', 'mincho']);
export const Density = z.enum(['compact', 'comfortable', 'spacious']);
export const Corners = z.enum(['square', 'soft', 'round']);
export const ImageAspect = z.enum(['1:1', '4:3', '3:4']);

/** Allowlisted design tokens. AI may propose values; only validated tokens are saved. */
export const ThemeTokens = z.strictObject({
  templateId: TemplateId,
  templateVersion: z.number().int().positive(),
  colors: z.strictObject({
    background: HexColor,
    surface: HexColor,
    text: HexColor,
    mutedText: HexColor,
    accent: HexColor,
    accentText: HexColor,
  }),
  fontPreset: FontPreset,
  density: Density,
  corners: Corners,
  imageAspect: ImageAspect,
});
export type ThemeTokens = z.infer<typeof ThemeTokens>;
