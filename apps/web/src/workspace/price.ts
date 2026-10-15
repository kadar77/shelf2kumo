/** "1,320" / "１３２０" / "¥1320" / "864円" → integer yen; empty → null (unknown); anything else → undefined (invalid). */
export function parsePriceInput(input: string): number | null | undefined {
  const normalized = input.normalize('NFKC').replace(/[,\s円¥￥]/g, '');
  if (normalized === '') return null;
  return /^\d{1,9}$/.test(normalized) ? Number(normalized) : undefined;
}
