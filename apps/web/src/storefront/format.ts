import type { TaxTreatment } from '@shelf2kumo/contracts';

export const PRICE_UNKNOWN_LABEL = '価格はお問い合わせください';

const yen = new Intl.NumberFormat('ja-JP');

const TAX_SUFFIX: Record<TaxTreatment, string> = {
  included: '（税込）',
  excluded: '（税抜）',
  unknown: '',
};

/** Formats an integer JPY price for display; null means the price is unknown. */
export function formatPrice(priceJpy: number | null, taxTreatment: TaxTreatment): string {
  if (priceJpy === null) return PRICE_UNKNOWN_LABEL;
  return `${yen.format(priceJpy)}円${TAX_SUFFIX[taxTreatment]}`;
}

/** Plain-text summary for meta descriptions, cut at a character boundary. */
export function summarize(text: string, maxLength = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(normalized);
  return chars.length <= maxLength ? normalized : `${chars.slice(0, maxLength - 1).join('')}…`;
}

/** Digits and a leading + only, for tel: links. */
export function telHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, '');
  return digits.length >= 6 ? `tel:${digits}` : null;
}
