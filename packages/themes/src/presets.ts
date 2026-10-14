import type { TemplateId, ThemeTokens } from '@shelf2kumo/contracts';

/** Current version of each shipped template. Saved themes record the version they were made with. */
export const TEMPLATE_VERSIONS: Record<TemplateId, number> = {
  modern: 1,
};

/** Starting tokens per template. Crisp neutrals and strong typography for specialty retail. */
export const PRESETS: Record<TemplateId, ThemeTokens> = {
  modern: {
    templateId: 'modern',
    templateVersion: 1,
    colors: {
      background: '#fafaf8',
      surface: '#ffffff',
      text: '#1c1c1a',
      mutedText: '#5c5c57',
      accent: '#1f4e5f',
      accentText: '#ffffff',
    },
    fontPreset: 'gothic',
    density: 'comfortable',
    corners: 'soft',
    imageAspect: '4:3',
  },
};
