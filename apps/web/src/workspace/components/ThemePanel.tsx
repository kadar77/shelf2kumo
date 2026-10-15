import { PaletteName, type ThemeTokens, type UpdateThemeResponse } from '@shelf2kumo/contracts';
import { PALETTES, applyThemeChoice, paletteOf, type ThemeChoice } from '@shelf2kumo/themes';
import { useId, useState } from 'react';
import { ApiRequestError, apiFetch } from '../api.ts';
import type { SavedTheme } from '../data/chat.ts';

const FONT_OPTIONS: Array<[ThemeTokens['fontPreset'], string]> = [
  ['gothic', 'ゴシック'],
  ['mincho', '明朝'],
];
const DENSITY_OPTIONS: Array<[ThemeTokens['density'], string]> = [
  ['compact', 'コンパクト'],
  ['comfortable', '標準'],
  ['spacious', 'ゆったり'],
];
const CORNER_OPTIONS: Array<[ThemeTokens['corners'], string]> = [
  ['square', '四角'],
  ['soft', 'やや丸'],
  ['round', '丸'],
];
const ASPECT_OPTIONS: Array<[ThemeTokens['imageAspect'], string]> = [
  ['1:1', '正方形'],
  ['4:3', '横長'],
  ['3:4', '縦長'],
];

function Options<T extends string>({
  label,
  options,
  value,
  disabled,
  onPick,
}: {
  label: string;
  options: Array<[T, string]>;
  value: T;
  disabled: boolean;
  onPick: (v: T) => void;
}) {
  return (
    <div className="ws-field">
      <span className="ws-field-label">{label}</span>
      <div className="ws-segmented" role="group" aria-label={label}>
        {options.map(([option, text]) => (
          <button key={option} type="button" aria-pressed={value === option} disabled={disabled} onClick={() => onPick(option)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Theme picker: every choice is saved as a draft immediately (public pages change on publish). */
export function ThemePanel({ shopId, theme }: { shopId: string; theme: SavedTheme }) {
  const headingId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentPalette = paletteOf(theme.tokens.colors);

  async function choose(choice: ThemeChoice) {
    setError(null);
    setSaving(true);
    try {
      const { tokens } = applyThemeChoice(theme.tokens, choice);
      await apiFetch<UpdateThemeResponse>('PATCH', `/api/shops/${shopId}/theme`, { expectedRevision: theme.revision, tokens });
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'テーマを保存できませんでした。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby={headingId} className="ws-theme">
      <h2 id={headingId} className="ws-panel-title">
        デザイン
      </h2>
      <div className="ws-field">
        <span className="ws-field-label">配色</span>
        <div className="ws-palette-grid" role="group" aria-label="配色">
          {PaletteName.options.map((name) => {
            const colors = PALETTES[name].colors;
            return (
              <button key={name} type="button" className="ws-palette" aria-pressed={currentPalette === name} disabled={saving} onClick={() => choose({ palette: name })}>
                <span className="ws-swatch" style={{ background: colors.background, color: colors.text, borderColor: colors.accent }} aria-hidden="true">
                  <span style={{ background: colors.accent }} />
                </span>
                {PALETTES[name].label}
              </button>
            );
          })}
        </div>
        {!currentPalette && <p className="ws-hint">カスタムの配色を使用中です。</p>}
      </div>
      <Options label="文字" options={FONT_OPTIONS} value={theme.tokens.fontPreset} disabled={saving} onPick={(fontPreset) => choose({ fontPreset })} />
      <Options label="余白" options={DENSITY_OPTIONS} value={theme.tokens.density} disabled={saving} onPick={(density) => choose({ density })} />
      <Options label="角の形" options={CORNER_OPTIONS} value={theme.tokens.corners} disabled={saving} onPick={(corners) => choose({ corners })} />
      <Options label="写真の形" options={ASPECT_OPTIONS} value={theme.tokens.imageAspect} disabled={saving} onPick={(imageAspect) => choose({ imageAspect })} />
      {error && (
        <p className="ws-form-error" role="alert">
          {error}
        </p>
      )}
      <p className="ws-muted ws-small">チャットで「もっと温かい雰囲気に」のように頼むこともできます。</p>
    </section>
  );
}
