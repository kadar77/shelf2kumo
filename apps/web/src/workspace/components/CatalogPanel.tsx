import { useState } from 'react';
import type { ItemWithId, JobWithId } from '../data/catalog.ts';
import type { ShopWithId } from '../data/shops.ts';
import type { ImageWithId } from '../images/images.ts';
import { ItemList } from './ItemList.tsx';
import { PhotoSection } from './PhotoSection.tsx';
import { ShopProfileForm } from './ShopProfileForm.tsx';

interface Props {
  shop: ShopWithId;
  items: ItemWithId[] | null;
  images: ImageWithId[];
  imagesById: Map<string, ImageWithId>;
  jobs: JobWithId[];
}

export function CatalogPanel({ shop, items, images, imagesById, jobs }: Props) {
  // undefined: closed; null: new item without a photo; string: new item for that photo.
  const [draftImageId, setDraftImageId] = useState<string | null | undefined>(undefined);

  return (
    <div className="ws-panel-inner ws-catalog-inner">
      <PhotoSection shopId={shop.id} images={images} jobs={jobs} onManualAdd={(imageId) => setDraftImageId(imageId)} />
      <ItemList
        shopId={shop.id}
        items={items}
        imagesById={imagesById}
        draftImageId={draftImageId}
        onDraftDone={() => setDraftImageId(undefined)}
        onStartDraft={() => setDraftImageId(null)}
      />
      <ShopProfileForm key={shop.id} shop={shop} />
    </div>
  );
}
