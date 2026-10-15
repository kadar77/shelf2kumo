import type { UpdateThemeRequest, UpdateThemeResponse } from '@shelf2kumo/contracts';
import { checkThemeContrast } from '@shelf2kumo/themes';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpError, notFound } from '../api/http.ts';
import { themeFrom, themeRef } from '../chat/apply.ts';

export interface ThemeService {
  update(ownerId: string, shopId: string, request: UpdateThemeRequest): Promise<UpdateThemeResponse>;
}

const PAIR_LABELS: Record<string, string> = {
  'text/background': '文字と背景',
  'text/surface': '文字とカード',
  'mutedText/background': '補足文字と背景',
  'mutedText/surface': '補足文字とカード',
  'accentText/accent': 'ボタン文字とアクセント',
  'accent/background': 'アクセントと背景',
};

/** Direct theme edits (picker / forms). Saved as a draft; public pages change only on publish. */
export function firestoreThemeService(db: Firestore): ThemeService {
  return {
    async update(ownerId, shopId, request) {
      const failures = checkThemeContrast(request.tokens);
      if (failures.length > 0) {
        const pairs = failures.map((failure) => PAIR_LABELS[failure.pair] ?? failure.pair).join('、');
        throw new HttpError(400, 'bad_request', `色の組み合わせが読みにくいため保存できません（${pairs}）。別の色を選んでください。`);
      }
      const shopRef = db.doc(`shops/${shopId}`);
      return db.runTransaction(async (tx) => {
        const shop = await tx.get(shopRef);
        if (!shop.exists || shop.get('ownerId') !== ownerId) throw notFound();
        const current = themeFrom(await tx.get(themeRef(db, shopId)));
        if (current.revision !== request.expectedRevision) {
          throw new HttpError(409, 'revision_conflict', 'テーマが別の操作で変更されました。最新の内容を確認してください。');
        }
        const revision = current.revision + 1;
        tx.set(themeRef(db, shopId), {
          templateId: request.tokens.templateId,
          templateVersion: request.tokens.templateVersion,
          tokens: request.tokens,
          revision,
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.update(shopRef, { contentRevision: Number(shop.get('contentRevision') ?? 0) + 1, updatedAt: FieldValue.serverTimestamp() });
        return { revision };
      });
    },
  };
}
