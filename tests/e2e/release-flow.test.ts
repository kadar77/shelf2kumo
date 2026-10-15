// Release browser test (spec Phase 6): login → describe shop in chat → upload → edit product →
// theme/preview → confirm and publish → verify public page → unpublish. Runs against the emulators
// with the labeled fixture extractor/planner (no paid AI calls). Screenshots go to tests/e2e/output/.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatFixtureKey } from '../../functions/src/chat/fixture.ts';
import { PALETTES } from '../../packages/themes/src/index.ts';
import { HOSTING_ORIGIN, PROJECT_ID } from '../support/emulators.ts';
import { chromePath, openPage, type Page } from './browser.ts';

const output = fileURLToPath(new URL('./output/', import.meta.url));
const db = getFirestore(initializeApp({ projectId: PROJECT_ID }, 'e2e'));
const DESCRIBE = '雑貨と器のお店です。営業時間は11時から18時、火曜定休です。';
const has = (text: string) => `document.body.innerText.includes(${JSON.stringify(text)})`;

let page: Page;
let photo: string;
const shots: Array<{ name: string; overflow: boolean }> = [];
const shot = async (name: string) => shots.push({ name, ...(await page.screenshot(join(output, `${name}.png`))) });

beforeAll(async () => {
  if (!chromePath()) return;
  mkdirSync(output, { recursive: true });
  photo = join(mkdtempSync(join(tmpdir(), 's2k-photo-')), 'product.jpg');
  writeFileSync(photo, await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 170, g: 120, b: 80 } } }).jpeg().toBuffer());
  await db.doc(`emulatorFixtures/${chatFixtureKey(DESCRIBE)}`).set({
    proposal: {
      message: '【フィクスチャ】お店の紹介と営業時間を更新しました。',
      clarification: null,
      actions: [{ type: 'updateProfile', changes: { description: '雑貨と器のお店です。', hours: '11:00〜18:00（火曜定休）' } }],
    },
  });
  page = await openPage();
});

afterAll(async () => {
  await page?.close();
  writeFileSync(join(output, 'screens.json'), JSON.stringify(shots, null, 2));
});

describe.skipIf(!chromePath())('release flow (P6 browser test)', () => {
  it('runs from sign-up to unpublish at 360px', async () => {
    // Sign up with the keyboard only (P6-4).
    await page.navigate(`${HOSTING_ORIGIN}/app/signup`);
    await page.waitFor(`document.querySelector('input[type=email]')`);
    await page.evaluate(`document.querySelector('input[type=email]').focus()`);
    await page.type(`e2e-${Date.now()}@example.test`);
    await page.press('Tab');
    await page.type('e2e-pass-12345');
    await page.press('Enter');
    await page.waitFor(`location.pathname === '/app' && ${has('あなたのショップ')}`);
    await page.waitFor(`[...document.querySelectorAll('label')].some((l) => l.textContent.trim() === '新しいお店の名前')`);

    await page.fill('新しいお店の名前', '器と道具 こもれび');
    await page.click('ショップを作成');
    await page.waitFor(`location.pathname.startsWith('/app/shops/')`);
    await page.waitFor(`document.querySelector('.ws-composer textarea')`);

    // Describe the shop in chat.
    await page.fill('メッセージ', DESCRIBE, '.ws-composer');
    await page.click('送信', '.ws-composer');
    await page.waitFor(has('営業時間：（なし） → 11:00〜18:00（火曜定休）'), 30_000);
    await shot('e2e-01-chat-profile');

    // Upload a photo → fixture extraction creates a draft item automatically.
    await page.click('カタログ');
    await page.click('写真を追加');
    await page.click('同意して写真を選ぶ');
    await page.setFile('input[data-testid="photo-input"]', photo);
    await page.waitFor(has('商品を追加しました'), 60_000);

    // Edit the product with the form.
    await page.click('編集', '.ws-item-list');
    await page.fill('商品名', 'ほうじ茶', '.ws-item-list');
    await page.fill('価格（円）', '864', '.ws-item-list');
    await page.fill('税区分', 'included', '.ws-item-list');
    await page.click('保存する', '.ws-item-list');
    await page.waitFor(has('864円（税込）'));

    // A nameless item blocks publication with a Japanese next step (P6-3), then is removed.
    await page.click('手動で追加', '.ws-section-header');
    await page.click('追加する', '.ws-items');
    await page.waitFor(has('商品名が未入力です'));
    await page.click('公開する', '.ws-mobile-publish');
    await page.waitFor(has('商品名が未入力の商品が 1 件あります'));
    await shot('e2e-02-publish-blocked');
    await page.press('Escape');
    await page.waitFor(`!document.querySelector('.ws-modal')`);
    await page.evaluate(`(() => { const card = [...document.querySelectorAll('.ws-item-card')].find((c) => c.innerText.includes('商品名が未入力です')); [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '削除').click(); })()`);
    await page.click('削除する', '.ws-item-list');
    await page.waitFor(`!${has('商品名が未入力です')}`);

    // Theme and preview.
    await page.evaluate(`[...document.querySelectorAll('.ws-palette')].find((b) => b.textContent.includes('あたたかみ')).click()`);
    await page.waitFor(`document.querySelector('.ws-palette[aria-pressed="true"]')?.textContent.includes('あたたかみ')`);
    await page.click('プレビュー');
    await page.waitFor(`getComputedStyle(document.querySelector('.ws-preview-frame .sf')).backgroundColor === 'rgb(250, 246, 240)'`);
    await page.waitFor(`document.querySelector('.ws-preview-frame').innerText.includes('864円（税込）')`);
    await shot('e2e-03-preview');

    // One confirmation publishes.
    await page.click('公開する', '.ws-mobile-publish');
    await page.waitFor(has('初めての公開です'));
    await shot('e2e-04-confirm');
    await page.click('公開する', '.ws-modal');
    await page.waitFor(has('公開しました'), 30_000);
    const url = await page.evaluate<string>(`document.querySelector('.ws-share-url input').value`);
    await shot('e2e-05-published');

    // The public page is plain server-rendered HTML with the confirmed data and photo.
    const response = await fetch(url);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('ほうじ茶');
    expect(html).toContain('864円（税込）');
    expect(html).toContain('11:00〜18:00（火曜定休）');
    expect(html).toContain(`--sf-bg:${PALETTES.warm.colors.background}`);
    expect(html).not.toContain('<script');
    const media = /\/media\/[a-z0-9-]+\/[a-f0-9]{64}\.jpg/.exec(html)?.[0];
    expect(media).toBeTruthy();
    expect((await fetch(`${HOSTING_ORIGIN}${media}`)).status).toBe(200);

    // Unpublish from the share panel; the page and its photo disappear.
    await page.click('公開を停止', '.ws-modal');
    await page.click('停止する', '.ws-modal');
    await page.waitFor(`!document.querySelector('.ws-modal')`);
    expect((await fetch(url)).status).toBe(404);
    expect((await fetch(`${HOSTING_ORIGIN}${media}`)).status).toBe(404);

    expect(shots.filter((s) => s.overflow)).toEqual([]);
  });
});
