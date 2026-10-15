import { RESERVED_SLUGS, SLUG_PATTERN } from '@shelf2kumo/contracts';
import { randomInt } from 'node:crypto';

/** Lowercase letters and digits without look-alikes (no l, o, 0, 1). */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function randomSlug(length = 8, pick: (max: number) => number = randomInt): string {
  let slug = '';
  for (let i = 0; i < length; i += 1) slug += ALPHABET[pick(ALPHABET.length)];
  return slug;
}

export function isClaimableSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug);
}
