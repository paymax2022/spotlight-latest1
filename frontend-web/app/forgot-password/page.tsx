'use client';

/**
 * Forgot password — identifier → code → new password, all on one page.
 *
 * The reset is an emailed ONE-TIME CODE. There is no reset link.
 *
 *   request   email OR phone number → a code is emailed to the account's address
 *   code      the code is CHECKED HERE, against the server
 *   password  only now: new password + confirm  (shown only after the code passed)
 *   success   → /login
 *
 * WHY THE CODE IS CHECKED BEFORE THE PASSWORD FORM
 * -------------------------------------------------
 * Checking the code only at the final submit meant a typo'd code was discovered
 * after the user had typed a password, and the form was shown to people who had
 * not proved anything. So the code step calls /api/auth/verify-password-reset-otp,
 * which spends the code and returns a single-use `resetToken`. The password step
 * sends that token — not the code — which is how a single-use code can be checked
 * on one screen and used on the next. The token is held in memory only (never in
 * the URL, storage, or a cookie), so a reload starts the reset over.
 *
 * WHY PHONE WORKS BUT NOTHING IS SENT BY SMS
 * -------------------------------------------
 * A phone number is only a way to FIND the account. The code always goes to the
 * account's email (Brevo is the only provider wired). The page never shows or
 * receives that address: the server resolves it, because a phone → email lookup
 * the browser could read would let anyone harvest addresses.
 *
 * WHY THE REQUEST STEP RESPONSE STAYS GENERIC
 * ----------------------------------------------
 * /api/auth/forgot-password answers identically whether or not an account matched,
 * to prevent enumeration. This page must not undermine that: every non-network
 * outcome advances to the code step the same way, regardless of whether a real
 * code was actually sent. The only exceptions are "unavailable" (503, a property
 * of the environment) and "too many attempts" (429, per IP) — neither says
 * anything about a particular account.
 *
 * The code step uses the same per-digit segmented-box input as /verify-email
 * (app/verify-email/page.tsx, src/features/auth/otp.ts) rather than a single
 * text field, so the two OTP surfaces in this app feel like one design instead
 * of two. Resend also gets the same 60s client-side cooldown as that page.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { otpLength, distributeOtpInput, nextOtpFocus } from '@/src/features/auth/otp';

type Step = 'request' | 'code' | 'password' | 'success';

const RESEND_COOLDOWN_S = 60;

function readableError(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  const lowered = message.toLowerCase();
  if (lowered.includes('failed to fetch') || lowered.includes('err_connection_refused')) {
    return 'The reset service is unreachable right now. Please try again shortly.';
  }
  return 'Something went wrong. Please try again.';
}

export default function ForgotPasswordPage() {
  const router = useRouter();
  const CODE_LENGTH = otpLength();

  const [step, setStep] = useState<Step>('request');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  // Proof that the code was correct. In memory only — see the header comment.
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const clearCode = () => setCode(Array(CODE_LENGTH).fill(''));

  async function sendCode(target: string) {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: target }),
    });
    // 200 means "if an account matched, a code went out" — the same for every
    // identifier. Branching UI on anything finer would leak the enumeration
    // signal the API was built to avoid.
    return res;
  }

  /** Message for a request-step failure that is NOT about a specific account, or '' to proceed. */
  async function requestFailure(res: Response): Promise<string> {
    if (res.status === 503) return 'Password reset is unavailable right now. Please try again later.';
    if (res.status === 429) return 'Too many attempts. Please try again later.';
    if (res.status === 400) {
      const body = await res.json().catch(() => ({}));
      return typeof body?.error === 'string' ? body.error : 'Enter your email or phone number.';
    }
    return '';
  }

  async function handleRequestSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await sendCode(identifier.trim());
      const failure = await requestFailure(res);
      if (failure) {
        setError(failure);
        return;
      }
      setStep('code');
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (code.join('').length < CODE_LENGTH) {
      setError(`Enter all ${CODE_LENGTH} digits.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/verify-password-reset-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), code: code.join('') }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok && typeof body?.resetToken === 'string' && body.resetToken) {
        // The code passed. Only now does the new-password form appear.
        setResetToken(body.resetToken);
        setResendMessage('');
        setStep('password');
        return;
      }
      if (res.status === 503) {
        setError('Password reset is unavailable right now. Please try again later.');
        return;
      }
      if (res.status === 429) {
        setError('Too many attempts. Request a new code and try again.');
        clearCode();
        return;
      }
      const message = typeof body?.error === 'string' ? body.error.toLowerCase() : '';
      if (message.includes('expired')) {
        setError('That code has expired. Request a new one.');
      } else {
        setError('That code is not correct. Check the email and try again.');
      }
      clearCode();
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (resendBusy || cooldown > 0) return;
    setResendBusy(true);
    setResendMessage('');
    setError('');
    try {
      const res = await sendCode(identifier.trim());
      const failure = await requestFailure(res);
      if (failure) {
        setError(failure);
        return;
      }
      clearCode();
      setResendMessage('A new code is on its way if an account matches.');
      // The project allows very few of these per hour (see verify-email's same
      // constant) — make the wait explicit rather than letting people burn the
      // quota on retries.
      setCooldown(RESEND_COOLDOWN_S);
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
        body: JSON.stringify({ identifier: identifier.trim(), resetToken, password }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok) {
        setResetToken('');
        setStep('success');
        setTimeout(() => router.replace('/login'), 2500);
        return;
      }

      if (res.status === 503) {
        setError('Password reset is unavailable right now. Please try again later.');
        return;
      }
      if (res.status === 403) {
        setError('This account cannot be reset right now. Please contact support.');
        return;
      }
      if (res.status === 400 || res.status === 429) {
        // The token is single-use and short-lived, so a 400/429 here means it was
        // spent or has lapsed. The user has to start over; sending them back to
        // the code box would just fail again.
        setError('Your verification has expired. Please request a new code.');
        setResetToken('');
        setPassword('');
        setConfirm('');
        clearCode();
        setStep('request');
        return;
      }
      setError(typeof body?.error === 'string' && body.error ? body.error : 'Failed to update password. Please try again.');
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
              identifier={identifier}
              setIdentifier={setIdentifier}
              busy={busy}
              error={error}
              onSubmit={handleRequestSubmit}
            />
          )}

          {step === 'code' && (
            <CodeStep
              identifier={identifier}
              code={code}
              setCode={setCode}
              codeLength={CODE_LENGTH}
              busy={busy}
              error={error}
              resendBusy={resendBusy}
              resendMessage={resendMessage}
              cooldown={cooldown}
              onSubmit={handleCodeSubmit}
              onResend={handleResend}
              onChangeIdentifier={() => { setStep('request'); setError(''); clearCode(); }}
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
              onBack={() => { setStep('request'); setError(''); setResetToken(''); setPassword(''); setConfirm(''); clearCode(); }}
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
  identifier, setIdentifier, busy, error, onSubmit,
}: {
  identifier: string;
  setIdentifier: (v: string) => void;
  busy: boolean;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ color: '#cbd5e1', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
        Enter the email address or phone number on your account. We&apos;ll email a
        one-time code to the address we have on file.
      </p>

      <div>
        <label htmlFor="forgot-password-identifier" style={fieldLabelStyle()}>
          Email or Phone Number
        </label>
        <input
          id="forgot-password-identifier"
          type="text"
          placeholder="you@example.com or 0803 000 0000"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
          style={inputStyle}
        />
      </div>

      <ErrorBanner message={error} />

      <button type="submit" disabled={busy || !identifier.trim()} style={primaryButtonStyle(busy || !identifier.trim())}>
        {busy ? 'Sending…' : 'Send Reset Code'}
      </button>
    </form>
  );
}

function CodeStep({
  identifier, code, setCode, codeLength, busy, error, resendBusy, resendMessage, cooldown, onSubmit, onResend, onChangeIdentifier,
}: {
  identifier: string;
  code: string[];
  setCode: (v: string[]) => void;
  codeLength: number;
  busy: boolean;
  error: string;
  resendBusy: boolean;
  resendMessage: string;
  cooldown: number;
  onSubmit: (e: React.FormEvent) => void;
  onResend: () => void;
  onChangeIdentifier: () => void;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { inputs.current[0]?.focus(); }, []);

  function onChange(value: string, index: number) {
    const filled = distributeOtpInput(code, index, value);
    setCode(filled);
    if (value) inputs.current[nextOtpFocus(filled, index)]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Backspace' && !code[index] && index > 0) inputs.current[index - 1]?.focus();
    if (e.key === 'ArrowLeft' && index > 0) inputs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < codeLength - 1) inputs.current[index + 1]?.focus();
  }

  const complete = code.join('').length >= codeLength;

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ color: '#cbd5e1', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
        If an account matches <strong style={{ color: '#f1f5f9' }}>{identifier}</strong>, a{' '}
        {codeLength}-digit code was emailed to it. Enter the code below — it can take a few
        minutes, and check spam if you don&apos;t see it.
      </p>

      <div>
        <label style={fieldLabelStyle()}>Verification Code</label>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between' }}>
          {code.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { inputs.current[i] = el; }}
              value={digit}
              onChange={(e) => onChange(e.target.value, i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              // Not 1: autofill and paste deliver the whole code into one field.
              maxLength={codeLength}
              aria-label={`Digit ${i + 1} of ${codeLength}`}
              style={{ ...inputStyle, flex: 1, minWidth: 0, textAlign: 'center', fontSize: '1.1rem', padding: '0.8rem 0' }}
            />
          ))}
        </div>
      </div>

      <ErrorBanner message={error} />
      {resendMessage && !error && (
        <p style={{ color: '#86efac', fontSize: '0.8rem', margin: 0 }}>{resendMessage}</p>
      )}

      <button type="submit" disabled={!complete || busy} style={primaryButtonStyle(!complete || busy)}>
        {busy ? 'Checking…' : 'Verify Code'}
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
        <button
          type="button"
          onClick={onChangeIdentifier}
          style={secondaryLinkStyle}
        >
          Use a different email or phone
        </button>
        <button
          type="button"
          onClick={onResend}
          disabled={resendBusy || cooldown > 0}
          style={{ ...secondaryLinkStyle, cursor: resendBusy || cooldown > 0 ? 'not-allowed' : 'pointer' }}
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : resendBusy ? 'Resending…' : 'Resend code'}
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

      {/* The code was already spent to get here, so "back" restarts the reset. */}
      <button type="button" onClick={onBack} style={secondaryLinkStyle}>
        Start over
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
