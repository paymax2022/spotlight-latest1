'use client';

/**
 * Forgot password — email → code → new password, all on one page.
 *
 * WHY ONE SUBMIT DOES BOTH "VERIFY CODE" AND "SET PASSWORD"
 * -----------------------------------------------------------
 * The code is single-use (backend/internal/otp/service.go): the Go endpoint that
 * checks it (POST /api/auth/reset-password) consumes it in the same call that
 * sets the password. There is no "verify, then separately set" pair — calling a
 * standalone verify first would burn the code, and the following "set password"
 * call would then fail as already-used.
 *
 * So the code step below does NOT call the backend. It only checks the code
 * looks plausible (digits, right length) and moves to the password step. The
 * code and the new password are sent together in ONE call when that step is
 * submitted. If the code turns out to be wrong or expired, the error surfaces
 * there and the user is sent back to the code step to fix or resend it — the
 * three-screen feel is UI only, not three round trips.
 *
 * WHY PHONE IS DISABLED
 * ----------------------
 * There is no SMS/WhatsApp OTP provider wired anywhere in this backend (only
 * Brevo email — see backend/internal/otp/service.go's EmailSender). The tab is
 * shown so the layout doesn't need reworking again once one exists, but it does
 * nothing yet.
 *
 * WHY THE REQUEST STEP RESPONSE STAYS GENERIC
 * ----------------------------------------------
 * /api/auth/forgot-password answers identically whether or not the address has
 * an account, to prevent enumeration. This page must not undermine that: every
 * non-network outcome advances to the code step the same way, regardless of
 * whether a real code was actually sent.
 *
 * The request step also sends Supabase's own recovery LINK in the same email
 * (unchanged, see app/auth/reset-password/page.tsx for that path) — this page
 * only adds the code path that page's own top comment used to say didn't exist.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Step = 'request' | 'code' | 'password' | 'success';

function readableError(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  const lowered = message.toLowerCase();
  if (lowered.includes('failed to fetch') || lowered.includes('err_connection_refused')) {
    return 'The reset service is unreachable right now. Please try again shortly.';
  }
  return 'Something went wrong. Please try again.';
}

const CODE_LENGTH_MIN = 4;
const CODE_LENGTH_MAX = 8;

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  async function sendCode(targetEmail: string) {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: targetEmail }),
    });
    // Every non-network outcome — 200, 429, or a proxy-level 4xx/5xx — is
    // treated the same way by the caller. Branching UI on res.ok here would
    // leak exactly the enumeration signal the API was built to avoid.
    return res;
  }

  async function handleRequestSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await sendCode(email.trim().toLowerCase());
      setStep('code');
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }

  function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const digits = code.trim();
    if (digits.length < CODE_LENGTH_MIN || digits.length > CODE_LENGTH_MAX || !/^\d+$/.test(digits)) {
      setError('Enter the code exactly as it appears in the email.');
      return;
    }
    setError('');
    setStep('password');
  }

  async function handleResend() {
    if (resendBusy) return;
    setResendBusy(true);
    setResendMessage('');
    setError('');
    try {
      await sendCode(email.trim().toLowerCase());
      setResendMessage('A new code is on its way if that address has an account.');
    } catch (err) {
      setError(readableError(err));
    } finally {
      setResendBusy(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim(), password }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok) {
        setStep('success');
        setTimeout(() => router.replace('/login'), 2500);
        return;
      }

      const message = typeof body?.error === 'string' ? body.error : '';
      if (res.status === 503) {
        // Code-based reset is closed (feature off / Go unreachable). The link
        // in the same email is the working mechanism in that state.
        setError('Code-based reset is unavailable right now. Please use the link in the reset email instead.');
        return;
      }
      if (message.toLowerCase().includes('expired') || message.toLowerCase().includes('invalid code')) {
        setError('That code is invalid or expired. Check the email, or request a new one.');
        setStep('code');
        return;
      }
      if (res.status === 429) {
        setError('Too many attempts. Request a new code and try again.');
        setStep('code');
        return;
      }
      setError(message || 'Failed to update password. Please try again.');
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }

  const subtitle =
    step === 'request' ? "We'll help you get back in"
    : step === 'code' ? 'Check your inbox'
    : step === 'password' ? 'Choose a new password'
    : 'All set';

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ width: '100%', maxWidth: 440 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <Link href="/" style={{ textDecoration: 'none', display: 'inline-block' }}>
            <span style={{ fontSize: '2rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em' }}>
              Spotlight
            </span>
            <span style={{ fontSize: '2rem', fontWeight: 800, color: '#f59e0b' }}>.</span>
          </Link>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '0.5rem', marginBottom: 0 }}>
            {subtitle}
          </p>
        </div>

        {/* Card */}
        <div
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '1.25rem',
            padding: '2rem',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
          }}
        >
          {step === 'request' && (
            <RequestStep
              email={email}
              setEmail={setEmail}
              busy={busy}
              error={error}
              onSubmit={handleRequestSubmit}
            />
          )}

          {step === 'code' && (
            <CodeStep
              email={email}
              code={code}
              setCode={setCode}
              error={error}
              resendBusy={resendBusy}
              resendMessage={resendMessage}
              onSubmit={handleCodeSubmit}
              onResend={handleResend}
              onChangeEmail={() => { setStep('request'); setError(''); setCode(''); }}
            />
          )}

          {step === 'password' && (
            <PasswordStep
              password={password}
              setPassword={setPassword}
              confirm={confirm}
              setConfirm={setConfirm}
              busy={busy}
              error={error}
              onSubmit={handlePasswordSubmit}
              onBack={() => { setStep('code'); setError(''); }}
            />
          )}

          {step === 'success' && (
            <div
              style={{
                background: 'rgba(34,197,94,0.15)',
                border: '1px solid rgba(34,197,94,0.4)',
                borderRadius: '0.625rem',
                padding: '0.9rem 1rem',
                color: '#86efac',
                fontSize: '0.85rem',
                lineHeight: 1.5,
                textAlign: 'center',
              }}
            >
              Password updated. Redirecting you to sign in…
            </div>
          )}
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#94a3b8', marginTop: '1.25rem' }}>
          Remembered your password?{' '}
          <Link href="/login" style={{ color: '#f59e0b', textDecoration: 'none', fontWeight: 600 }}>
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

function ChannelTabs() {
  return (
    <div
      role="tablist"
      aria-label="Reset method"
      style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.25rem' }}
    >
      <div
        role="tab"
        aria-selected="true"
        style={{
          flex: 1,
          textAlign: 'center',
          padding: '0.55rem',
          borderRadius: '0.625rem',
          background: 'rgba(245,158,11,0.15)',
          border: '1px solid rgba(245,158,11,0.4)',
          color: '#f59e0b',
          fontSize: '0.82rem',
          fontWeight: 700,
        }}
      >
        Email
      </div>
      <div
        role="tab"
        aria-selected="false"
        aria-disabled="true"
        title="Phone reset is coming soon"
        style={{
          flex: 1,
          textAlign: 'center',
          padding: '0.55rem',
          borderRadius: '0.625rem',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: '#64748b',
          fontSize: '0.82rem',
          fontWeight: 700,
          cursor: 'not-allowed',
        }}
      >
        Phone · Coming soon
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      style={{
        background: 'rgba(239,68,68,0.15)',
        border: '1px solid rgba(239,68,68,0.4)',
        borderRadius: '0.625rem',
        padding: '0.75rem 1rem',
        color: '#fca5a5',
        fontSize: '0.85rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.5rem',
      }}
      role="alert"
    >
      <span style={{ flexShrink: 0, marginTop: '0.05rem' }}>⚠</span>
      {message}
    </div>
  );
}

function fieldLabelStyle(): React.CSSProperties {
  return {
    display: 'block',
    color: '#cbd5e1',
    fontSize: '0.8rem',
    fontWeight: 600,
    marginBottom: '0.4rem',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  };
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: '0.875rem',
    background: disabled ? 'rgba(245,158,11,0.4)' : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: disabled ? 'rgba(0,0,0,0.5)' : '#000000',
    border: 'none',
    borderRadius: '0.75rem',
    fontSize: '0.95rem',
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.2s',
    marginTop: '0.25rem',
    letterSpacing: '0.01em',
    boxShadow: disabled ? 'none' : '0 4px 15px rgba(245,158,11,0.35)',
  };
}

function RequestStep({
  email, setEmail, busy, error, onSubmit,
}: {
  email: string;
  setEmail: (v: string) => void;
  busy: boolean;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <ChannelTabs />
      <p style={{ color: '#cbd5e1', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
        Enter the email address on your account and we&apos;ll send you a code to reset
        your password.
      </p>

      <div>
        <label htmlFor="forgot-password-email" style={fieldLabelStyle()}>
          Email Address
        </label>
        <input
          id="forgot-password-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoFocus
          required
          style={inputStyle}
        />
      </div>

      <ErrorBanner message={error} />

      <button type="submit" disabled={busy || !email.trim()} style={primaryButtonStyle(busy || !email.trim())}>
        {busy ? 'Sending…' : 'Send Code'}
      </button>
    </form>
  );
}

function CodeStep({
  email, code, setCode, error, resendBusy, resendMessage, onSubmit, onResend, onChangeEmail,
}: {
  email: string;
  code: string;
  setCode: (v: string) => void;
  error: string;
  resendBusy: boolean;
  resendMessage: string;
  onSubmit: (e: React.FormEvent) => void;
  onResend: () => void;
  onChangeEmail: () => void;
}) {
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ color: '#cbd5e1', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
        If an account exists for <strong style={{ color: '#f1f5f9' }}>{email}</strong>, a code was
        sent to that address. Enter it below — it can take a few minutes, and check spam if you
        don&apos;t see it.
      </p>

      <div>
        <label htmlFor="forgot-password-code" style={fieldLabelStyle()}>
          Verification Code
        </label>
        <input
          id="forgot-password-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ''))}
          autoFocus
          required
          maxLength={CODE_LENGTH_MAX}
          style={{ ...inputStyle, letterSpacing: '0.3em', fontSize: '1.1rem', textAlign: 'center' }}
        />
      </div>

      <ErrorBanner message={error} />
      {resendMessage && !error && (
        <p style={{ color: '#86efac', fontSize: '0.8rem', margin: 0 }}>{resendMessage}</p>
      )}

      <button type="submit" disabled={!code.trim()} style={primaryButtonStyle(!code.trim())}>
        Continue
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
        <button
          type="button"
          onClick={onChangeEmail}
          style={secondaryLinkStyle}
        >
          Use a different email
        </button>
        <button
          type="button"
          onClick={onResend}
          disabled={resendBusy}
          style={{ ...secondaryLinkStyle, cursor: resendBusy ? 'not-allowed' : 'pointer' }}
        >
          {resendBusy ? 'Resending…' : 'Resend code'}
        </button>
      </div>
    </form>
  );
}

function PasswordStep({
  password, setPassword, confirm, setConfirm, busy, error, onSubmit, onBack,
}: {
  password: string;
  setPassword: (v: string) => void;
  confirm: string;
  setConfirm: (v: string) => void;
  busy: boolean;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}) {
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ color: '#cbd5e1', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
        Choose a new password for your account.
      </p>

      <div>
        <label htmlFor="forgot-password-new" style={fieldLabelStyle()}>
          New Password
        </label>
        <input
          id="forgot-password-new"
          type="password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus
          required
          minLength={8}
          style={inputStyle}
        />
      </div>

      <div>
        <label htmlFor="forgot-password-confirm" style={fieldLabelStyle()}>
          Confirm Password
        </label>
        <input
          id="forgot-password-confirm"
          type="password"
          placeholder="Re-enter your new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          style={inputStyle}
        />
      </div>

      <ErrorBanner message={error} />

      <button
        type="submit"
        disabled={busy || !password || !confirm}
        style={primaryButtonStyle(busy || !password || !confirm)}
      >
        {busy ? 'Updating…' : 'Update Password'}
      </button>

      <button type="button" onClick={onBack} style={secondaryLinkStyle}>
        Back
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.07)',
  border: '1.5px solid rgba(255,255,255,0.12)',
  borderRadius: '0.75rem',
  padding: '0.8rem 1rem',
  color: '#f1f5f9',
  fontSize: '0.95rem',
};

const secondaryLinkStyle: React.CSSProperties = {
  padding: '0.4rem',
  background: 'none',
  border: 'none',
  color: '#94a3b8',
  fontSize: '0.8rem',
  cursor: 'pointer',
  textDecoration: 'underline',
};
