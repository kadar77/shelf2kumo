import type { SavedTheme } from '../data/chat.ts';
import type { ItemWithId, JobWithId } from '../data/catalog.ts';
import type { ShopWithId } from '../data/shops.ts';
import type { ImageWithId } from '../images/images.ts';
import { ItemList } from './ItemList.tsx';
import { PhotoSection } from './PhotoSection.tsx';
import { ShopProfileForm } from './ShopProfileForm.tsx';
import { ThemePanel } from './ThemePanel.tsx';

interface Props {
  shop: ShopWithId;
  items: ItemWithId[] | null;
  images: ImageWithId[];
  imagesById: Map<string, ImageWithId>;
  jobs: JobWithId[];
  theme: SavedTheme;
  /** undefined: closed; null: new item without a photo; string: new item for that photo. */
  draftImageId: string | null | undefined;
  onDraftChange: (draft: string | null | undefined) => void;
}

/** Every required field is editable here without chat (spec P4-5). */
export function CatalogPanel({ shop, items, images, imagesById, jobs, theme, draftImageId, onDraftChange }: Props) {
  return (
    <div className="ws-panel-inner ws-catalog-inner">
      <PhotoSection shopId={shop.id} images={images} jobs={jobs} onManualAdd={(imageId) => onDraftChange(imageId)} />
      <div id="ws-section-items">
        <ItemList
          shopId={shop.id}
          items={items}
          imagesById={imagesById}
          draftImageId={draftImageId}
          onDraftDone={() => onDraftChange(undefined)}
          onStartDraft={() => onDraftChange(null)}
        />
      </div>
      <div id="ws-section-theme">
        <ThemePanel shopId={shop.id} theme={theme} />
      </div>
      <div id="ws-section-profile">
        <ShopProfileForm key={shop.id} shop={shop} />
      </div>
    </div>
  );
}
