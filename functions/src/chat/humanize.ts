import { PALETTES } from '@shelf2kumo/themes';

const WORDS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(PALETTES).map(([name, palette]) => [name, palette.label])),
  gothic: 'ゴシック',
  mincho: '明朝',
  compact: 'コンパクト',
  comfortable: '標準',
  spacious: 'ゆったり',
};

const PATTERN = new RegExp(`(?<![A-Za-z])(${Object.keys(WORDS).join('|')})(?![A-Za-z])`, 'g');

/** Replaces internal theme identifiers the model may echo (e.g. 「warm」) with the owner-facing Japanese names. */
export function humanizeReply(text: string): string {
  return text.replace(PATTERN, (word) => WORDS[word] ?? word);
}
