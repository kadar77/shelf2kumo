import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { auth } from '../firebase.ts';
import { LoadingScreen, useAuth } from './AuthProvider.tsx';
import { MIN_PASSWORD_LENGTH, authErrorMessage } from './authErrors.ts';

function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <main className="ws-auth">
      <div className="ws-auth-card">
        <Link className="ws-brand" to="/">
          Shelf2Kumo
        </Link>
        <h1>{title}</h1>
        {children}
        <div className="ws-auth-footer">{footer}</div>
      </div>
    </main>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  label: string;
  type: 'email' | 'password';
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="ws-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <p id={`${id}-hint`} className="ws-hint">
          {hint}
        </p>
      )}
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="ws-form-error" role="alert">
      {message}
    </p>
  );
}

/** Where to go after signing in: the page that required login, or the shop list. */
function useReturnPath(): string {
  const state = useLocation().state as { from?: unknown } | null;
  return typeof state?.from === 'string' && state.from.startsWith('/app') ? state.from : '/app';
}

export function LoginPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const returnPath = useReturnPath();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <LoadingScreen />;
  if (user) return <Navigate to={returnPath} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate(returnPath, { replace: true });
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="ログイン"
      footer={
        <>
          <Link to="/app/reset">パスワードをお忘れの方</Link>
          <span>
            はじめての方は <Link to="/app/signup">新規登録</Link>
          </span>
        </>
      }
    >
      <form className="ws-form" onSubmit={submit} noValidate>
        <Field label="メールアドレス" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="パスワード" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <FormError message={error} />
        <button type="submit" className="ws-button ws-button-primary ws-button-block" disabled={submitting}>
          {submitting ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <LoadingScreen />;
  if (user && !submitting) return <Navigate to="/app" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`パスワードは ${MIN_PASSWORD_LENGTH} 文字以上にしてください。`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      // Verification gates paid extraction and publishing later (spec §6, Should tier).
      await sendEmailVerification(credential.user).catch(() => undefined);
      navigate('/app', { replace: true, state: { welcome: true } });
    } catch (caught) {
      setError(authErrorMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="新規登録"
      footer={
        <span>
          登録済みの方は <Link to="/app/login">ログイン</Link>
        </span>
      }
    >
      <form className="ws-form" onSubmit={submit} noValidate>
        <Field label="メールアドレス" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          label="パスワード"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={`${MIN_PASSWORD_LENGTH} 文字以上`}
        />
        <FormError message={error} />
        <button type="submit" className="ws-button ws-button-primary ws-button-block" disabled={submitting}>
          {submitting ? '登録中…' : '登録する'}
        </button>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setSent(true);
    } catch (caught) {
      const code = typeof caught === 'object' && caught && 'code' in caught ? String(caught.code) : '';
      // Do not reveal whether an account exists.
      if (code === 'auth/user-not-found') setSent(true);
      else setError(authErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="パスワードの再設定" footer={<Link to="/app/login">ログインに戻る</Link>}>
      {sent ? (
        <p className="ws-notice-success" role="status">
          入力されたメールアドレス宛てに、再設定用のリンクを送信しました。メールが届かない場合は迷惑メールフォルダもご確認ください。
        </p>
      ) : (
        <form className="ws-form" onSubmit={submit} noValidate>
          <p className="ws-muted">登録したメールアドレスを入力してください。再設定用のリンクをお送りします。</p>
          <Field label="メールアドレス" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <FormError message={error} />
          <button type="submit" className="ws-button ws-button-primary ws-button-block" disabled={submitting}>
            {submitting ? '送信中…' : '再設定リンクを送る'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
