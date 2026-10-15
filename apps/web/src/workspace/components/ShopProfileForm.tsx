import { ShopProfilePatch, type UpdateShopResponse } from '@shelf2kumo/contracts';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { ApiRequestError, apiFetch } from '../api.ts';
import type { ShopWithId } from '../data/shops.ts';

type FieldName = 'name' | 'description' | 'hours' | 'address' | 'phone' | 'mapUrl' | 'slug';

const FIELDS: Array<{ name: FieldName; label: string; multiline?: boolean; hint?: string; placeholder?: string }> = [
  { name: 'name', label: 'お店の名前' },
  { name: 'description', label: 'お店の紹介', multiline: true },
  { name: 'hours', label: '営業時間', placeholder: '例：11:00〜18:00（火曜定休）' },
  { name: 'address', label: '住所' },
  { name: 'phone', label: '電話番号' },
  { name: 'mapUrl', label: 'Google マップのリンク', hint: 'https://maps.app.goo.gl/… の形式' },
  { name: 'slug', label: 'お店の URL', hint: '半角英小文字・数字・ハイフン。公開後は変更できません。' },
];

const FIELD_ERRORS: Record<FieldName, string> = {
  name: '1〜200 文字で入力してください。',
  description: '2,000 文字以内で入力してください。',
  hours: '300 文字以内で入力してください。',
  address: '300 文字以内で入力してください。',
  phone: '300 文字以内で入力してください。',
  mapUrl: 'Google マップの https リンクを入力してください。',
  slug: '3〜32 文字の半角英小文字・数字・ハイフンで入力してください（先頭と末尾は英数字）。',
};

type Values = Record<FieldName, string>;

function valuesFrom(shop: ShopWithId): Values {
  return {
    name: shop.name,
    description: shop.description ?? '',
    hours: shop.hours ?? '',
    address: shop.address ?? '',
    phone: shop.phone ?? '',
    mapUrl: shop.mapUrl ?? '',
    slug: shop.slug,
  };
}

/** Changed fields only; empty optional fields become null (cleared). */
function diff(shop: ShopWithId, values: Values): Record<string, string | null> {
  const original = valuesFrom(shop);
  const changes: Record<string, string | null> = {};
  for (const { name } of FIELDS) {
    const next = values[name].trim();
    if (next === original[name]) continue;
    changes[name] = next === '' && name !== 'name' && name !== 'slug' ? null : next;
  }
  return changes;
}

export function ShopProfileForm({ shop }: { shop: ShopWithId }) {
  const formId = useId();
  // `base` is the saved version the form was loaded from; edits are diffed against it.
  const [base, setBase] = useState<ShopWithId>(shop);
  const [values, setValues] = useState<Values>(() => valuesFrom(shop));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Move focus to the first invalid field so its message is visible and announced.
  useEffect(() => {
    const first = FIELDS.find((field) => fieldErrors[field.name]);
    if (first) document.getElementById(`${formId}-${first.name}`)?.focus();
  }, [fieldErrors, formId]);

  // Adopt newer saved data while the form is untouched; keep the user's edits otherwise.
  const dirty = Object.keys(diff(base, values)).length > 0;
  useEffect(() => {
    if (!dirty && !saving && shop.profileRevision > base.profileRevision) {
      setBase(shop);
      setValues(valuesFrom(shop));
    }
  }, [shop, dirty, saving, base.profileRevision]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const changes = diff(base, values);
    if (Object.keys(changes).length === 0) {
      setMessage({ kind: 'success', text: '変更はありません。' });
      return;
    }

    const parsed = ShopProfilePatch.safeParse(changes);
    if (!parsed.success) {
      const errors: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FieldName | undefined;
        if (field && FIELD_ERRORS[field]) errors[field] = FIELD_ERRORS[field];
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setSaving(true);
    try {
      const result = await apiFetch<UpdateShopResponse>('PATCH', `/api/shops/${shop.id}`, {
        expectedRevision: base.profileRevision,
        changes: parsed.data,
      });
      setBase({ ...base, ...parsed.data, slug: result.slug, profileRevision: result.profileRevision });
      setValues((current) => ({ ...current, slug: result.slug }));
      setMessage({ kind: 'success', text: '保存しました。公開中のページには「公開する」まで反映されません。' });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'slug_unavailable') setFieldErrors({ slug: error.message });
      else setMessage({ kind: 'error', text: error instanceof ApiRequestError ? error.message : '保存できませんでした。' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ws-form" onSubmit={submit} noValidate aria-labelledby={`${formId}-title`}>
      <h2 id={`${formId}-title`} className="ws-panel-title">
        店舗情報
      </h2>
      {FIELDS.map((field) => {
        const id = `${formId}-${field.name}`;
        const error = fieldErrors[field.name];
        const describedBy = [field.hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
        const common = {
          id,
          value: values[field.name],
          placeholder: field.placeholder,
          disabled: field.name === 'slug' && shop.slugLocked,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
          onChange: (event: { target: { value: string } }) => setValues((current) => ({ ...current, [field.name]: event.target.value })),
        };
        return (
          <div className="ws-field" key={field.name}>
            <label htmlFor={id}>{field.label}</label>
            {field.multiline ? <textarea rows={3} {...common} /> : <input type="text" {...common} />}
            {field.hint && (
              <p id={`${id}-hint`} className="ws-hint">
                {field.name === 'slug' ? `/s/${values.slug || '…'} — ${field.hint}` : field.hint}
              </p>
            )}
            {error && (
              <p id={`${id}-error`} className="ws-field-error">
                {error}
              </p>
            )}
          </div>
        );
      })}
      {message && (
        <p className={message.kind === 'error' ? 'ws-form-error' : 'ws-notice-success'} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      {shop.profileRevision > base.profileRevision && dirty && (
        <button
          type="button"
          className="ws-button"
          onClick={() => {
            setBase(shop);
            setValues(valuesFrom(shop));
            setFieldErrors({});
            setMessage(null);
          }}
        >
          最新の内容を読み込む（入力中の変更は破棄されます）
        </button>
      )}
      <button type="submit" className="ws-button ws-button-primary" disabled={saving}>
        {saving ? '保存中…' : '保存する'}
      </button>
    </form>
  );
}
