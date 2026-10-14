declare const __STOREFRONT_CSS_HREF__: string | undefined;

/** Injected by build.mjs from the Vite manifest; the fallback applies only to unbundled tests. */
export const STOREFRONT_CSS_HREF =
  typeof __STOREFRONT_CSS_HREF__ === 'string' ? __STOREFRONT_CSS_HREF__ : '/assets/storefront.css';
