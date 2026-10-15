import type { StorefrontImage, StorefrontSnapshot } from '@shelf2kumo/contracts';
import { themeToCssVars } from '@shelf2kumo/themes';
import { useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { ProductView, ShopView } from '../../storefront/components.tsx';
import type { StorefrontLinks } from '../../storefront/links.ts';
import { publicLinks } from '../../storefront/links.ts';
import '../../storefront/storefront.css';

/**
 * Live draft preview: the same storefront components as the public pages, rendered client-side.
 * Links are intercepted so the preview navigates internally instead of leaving the workspace.
 */
export function PreviewPane({
  snapshot,
  resolveImage,
}: {
  snapshot: StorefrontSnapshot;
  /** Private object URL for an item photo, or null while loading. */
  resolveImage: (image: StorefrontImage) => string | null;
}) {
  const [itemId, setItemId] = useState<string | null>(null);
  const style = useMemo(() => themeToCssVars(snapshot.theme) as CSSProperties, [snapshot.theme]);
  const item = itemId ? snapshot.items.find((candidate) => candidate.id === itemId) : undefined;

  // Item photos are private renditions loaded with getBlob(), never public URLs.
  const links: StorefrontLinks = { ...publicLinks, image: (_slug, image) => resolveImage(image) };

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;
    event.preventDefault();
    if (anchor.dataset.sfItem) setItemId(anchor.dataset.sfItem);
    else if (anchor.dataset.sfHome !== undefined) setItemId(null);
  }

  return (
    <div className="ws-preview-layout">
      <div className="ws-preview-header">
        <h2 className="ws-panel-title">プレビュー</h2>
        <span className="ws-muted ws-small">公開前の下書き</span>
      </div>
      <div className="ws-preview-frame">
        <div className="sf" style={style} onClickCapture={handleClick}>
          {item ? <ProductView snapshot={snapshot} links={links} item={item} /> : <ShopView snapshot={snapshot} links={links} />}
        </div>
      </div>
    </div>
  );
}
