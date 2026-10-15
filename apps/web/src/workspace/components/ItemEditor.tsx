import { CreateItemRequest, ItemPatch, type CreateItemResponse, type TaxTreatment, type UpdateItemResponse } from '@shelf2kumo/contracts';
import { useId, useState, type FormEvent } from 'react';
import { ApiRequestError, apiFetch } from '../api.ts';
import type { ItemWithId } from '../data/catalog.ts';
import { parsePriceInput } from '../price.ts';

type Values = { name: string; price: string; taxTreatment: TaxTreatment; category: string; description: string };

const TAX_OPTIONS: Array<{ value: TaxTreatment; label: string }> = [
  { value: 'included', label: '税込' },
  { value: 'excluded', label: '税抜' },
  { value: 'unknown', label: '不明' },
];

function valuesOf(item: ItemWithId | null): Values {
  return {
    name: item?.name ?? '',
    price: item?.priceJpy === null || item?.priceJpy === undefined ? '' : String(item.priceJpy),
    taxTreatment: item?.taxTreatment ?? 'unknown',
    category: item?.category ?? '',
    description: item?.description ?? '',
  };
}

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

export function ItemEditor({
  shopId,
  item,
  imageId,
  onDone,
}: {
  shopId: string;
  /** Existing item to edit, or null to create a new one. */
  item: ItemWithId | null;
  /** Photo for a new item (manual entry after a failed or unclear extraction). */
  imageId?: string | null;
  onDone: () => void;
}) {
  const id = useId();
  const [values, setValues] = useState<Values>(() => valuesOf(item));
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (field: keyof Values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const priceJpy = parsePriceInput(values.price);
    if (priceJpy === undefined) {
      setErrors({ price: '価格は 0 以上の整数（円）で入力してください。わからない場合は空欄にしてください。' });
      return;
    }
    const fields = {
      name: orNull(values.name),
      priceJpy,
      taxTreatment: values.taxTreatment,
      category: orNull(values.category),
      description: orNull(values.description),
    };

    setSaving(true);
    try {
      if (item) {
        const original = valuesOf(item);
        const changes = Object.fromEntries(
          Object.entries(fields).filter(([key, value]) => {
            if (key === 'priceJpy') return value !== item.priceJpy;
            if (key === 'taxTreatment') return value !== item.taxTreatment;
            return (value ?? '') !== original[key as keyof Values];
          }),
        );
        if (Object.keys(changes).length === 0) {
          onDone();
          return;
        }
        const parsed = ItemPatch.safeParse(changes);
        if (!parsed.success) {
          setErrors({ name: '入力内容を確認してください（商品名は 200 文字まで、説明は 2,000 文字まで）。' });
          return;
        }
        await apiFetch<UpdateItemResponse>('PATCH', `/api/shops/${shopId}/items/${item.id}`, { expectedRevision: item.revision, changes: parsed.data });
      } else {
        const parsed = CreateItemRequest.safeParse({ ...fields, imageId: imageId ?? null });
        if (!parsed.success) {
          setErrors({ name: '入力内容を確認してください（商品名は 200 文字まで、説明は 2,000 文字まで）。' });
          return;
        }
        await apiFetch<CreateItemResponse>('POST', `/api/shops/${shopId}/items`, parsed.data);
      }
      onDone();
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.message : '保存できませんでした。もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ws-form ws-item-editor" onSubmit={submit} noValidate>
      <div className="ws-field">
        <label htmlFor={`${id}-name`}>商品名</label>
        <input id={`${id}-name`} type="text" value={values.name} onChange={set('name')} aria-invalid={errors.name ? true : undefined} />
        {!values.name.trim() && <p className="ws-hint">公開するには商品名が必要です。</p>}
        {errors.name && <p className="ws-field-error">{errors.name}</p>}
      </div>
      <div className="ws-field-row">
        <div className="ws-field">
          <label htmlFor={`${id}-price`}>価格（円）</label>
          <input
            id={`${id}-price`}
            type="text"
            inputMode="numeric"
            placeholder="空欄＝お問い合わせ"
            value={values.price}
            onChange={set('price')}
            aria-invalid={errors.price ? true : undefined}
            aria-describedby={errors.price ? `${id}-price-error` : undefined}
          />
          {errors.price && (
            <p id={`${id}-price-error`} className="ws-field-error">
              {errors.price}
            </p>
          )}
        </div>
        <div className="ws-field">
          <label htmlFor={`${id}-tax`}>税区分</label>
          <select id={`${id}-tax`} value={values.taxTreatment} onChange={set('taxTreatment')}>
            {TAX_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="ws-field">
        <label htmlFor={`${id}-category`}>カテゴリ</label>
        <input id={`${id}-category`} type="text" value={values.category} onChange={set('category')} placeholder="例：器、お茶" />
      </div>
      <div className="ws-field">
        <label htmlFor={`${id}-description`}>説明</label>
        <textarea id={`${id}-description`} rows={3} value={values.description} onChange={set('description')} />
      </div>
      {message && (
        <p className="ws-form-error" role="alert">
          {message}
        </p>
      )}
      <div className="ws-notice-actions">
        <button type="button" className="ws-button" onClick={onDone}>
          キャンセル
        </button>
        <button type="submit" className="ws-button ws-button-primary" disabled={saving}>
          {saving ? '保存中…' : item ? '保存する' : '追加する'}
        </button>
      </div>
    </form>
  );
}
