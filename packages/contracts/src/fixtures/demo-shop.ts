import type { StorefrontSnapshot } from '../storefront.ts';

/**
 * FIXTURE: fictional demo shop for development, tests and the emulator storefront.
 * Not real inference output and not a real business. Always rendered with isDemo = true.
 */
export const demoShopSnapshot: StorefrontSnapshot = {
  schemaVersion: 1,
  shop: {
    slug: 'demo',
    name: '器と道具 こもれび（デモ）',
    description:
      '暮らしに寄り添う器と手仕事の道具を集めた小さなお店です。このページは開発用のサンプルで、実在の店舗ではありません。',
    address: null,
    phone: null,
    hours: '11:00〜18:00（火曜定休）',
    mapUrl: null,
    isDemo: true,
  },
  theme: {
    templateId: 'modern',
    templateVersion: 1,
    colors: {
      background: '#fafaf8',
      surface: '#ffffff',
      text: '#1c1c1a',
      mutedText: '#5c5c57',
      accent: '#1f4e5f',
      accentText: '#ffffff',
    },
    fontPreset: 'gothic',
    density: 'comfortable',
    corners: 'soft',
    imageAspect: '4:3',
  },
  items: [
    {
      id: 'demoItem01',
      name: '粉引の飯碗',
      description: 'やわらかな白が料理を引き立てる、手に馴染む大きさの飯碗です。',
      category: '器',
      priceJpy: 3300,
      taxTreatment: 'included',
      image: null,
    },
    {
      id: 'demoItem02',
      name: '真鍮のティースプーン',
      description: null,
      category: '道具',
      priceJpy: 1800,
      taxTreatment: 'excluded',
      image: null,
    },
    {
      id: 'demoItem03',
      name: '季節限定 手織りの麻ふきん（生成り・大判サイズ）',
      description: '吸水性がよく、使うほどに柔らかくなります。',
      category: '布もの',
      priceJpy: null,
      taxTreatment: 'unknown',
      image: null,
    },
  ],
};
