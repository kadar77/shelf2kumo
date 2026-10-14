import type { StorefrontImage } from '@shelf2kumo/contracts';

/** URL builders injected into storefront components so the preview can supply its own image URLs. */
export interface StorefrontLinks {
  shop(slug: string): string;
  product(slug: string, itemId: string): string;
  /** Null when the image is not available yet; components then render the placeholder. */
  image(slug: string, image: StorefrontImage): string | null;
}

export const publicLinks: StorefrontLinks = {
  shop: (slug) => `/s/${slug}`,
  product: (slug, itemId) => `/s/${slug}/p/${itemId}`,
  image: (slug, image) => `/media/${slug}/${image.contentHash}.jpg`,
};
