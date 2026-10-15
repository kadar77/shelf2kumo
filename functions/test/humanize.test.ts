import { describe, expect, it } from 'vitest';
import { humanizeReply } from '../src/chat/humanize.ts';

describe('humanizeReply', () => {
  it('replaces internal theme identifiers with Japanese names', () => {
    expect(humanizeReply('テーマを「warm」に変更して、より温かい雰囲気にしました。')).toBe('テーマを「あたたかみ」に変更して、より温かい雰囲気にしました。');
    expect(humanizeReply('文字を mincho にしました')).toBe('文字を 明朝 にしました');
  });

  it('leaves ordinary words and product names alone', () => {
    expect(humanizeReply('Warmer は商品名です。darkness と modernize')).toBe('Warmer は商品名です。darkness と modernize');
  });
});
