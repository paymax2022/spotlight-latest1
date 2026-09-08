'use client';

/**
 * Email verification — the code-entry screen the web app never had.
 *
 * Both cloud projects require email confirmation (mailer_autoconfirm = false), so
 * a web sign-up returns NO session. Until now there was nowhere to go: the login
 * page told users to "check your email to confirm, then sign in" — but signing in
 * before confirming fails — and open-mic/register sent them to a login they could
 * not pass. Every web registration was a dead end.
 *
 * Verification is CODES, not links (decided 2026-08-25), so this takes the digits
 * from the email and calls verifyOtp with type 'signup'.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { otpLength, distributeOtpInput, nextOtpFocus } from '@/src/features/auth/otp';

const RESEND_COOLDOWN_S = 60;

function readableError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : '';
  const lowered = message.toLowerCase();
  if (lowered.includes('failed to fetch')) return 'Verification service is unreachable. Please try again shortly.';
  // Supabase reports an expired code and a wrong code identically; say so rather
  // than asserting which one it was.
  if (lowered.includes('expired') || lowered.includes('invalid')) {
    return 'That code is incorrect or has expired. Request a new one below.';
  }
  if (lowered.includes('rate') || lowered.includes('too many')) {
    return 'Too many attempts. Please wait a moment before trying again.';
  }
  return message || fallback;
}

function VerifyEmailInner() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const params = useSearchParams();
  const email = (params?.get('email') || '').trim().toLowerCase();
  const next = params?.get('next') || '/user-dashboard';

  const LENGTH = otpLength();
  const [code, setCode] = useState<string[]>(Array(LENGTH).fill(''));
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => { inputs.current[0]?.focus(); }, []);

  // Refocus AFTER the failed attempt finishes. Calling focus() inside the catch
  // does nothing: the inputs are still `disabled` at that point, and a disabled
  // input cannot take focus — so a wrong code left the user with no cursor and
  // nowhere obvious to retype.
  useEffect(() => {
    if (!busy && error) inputs.current[0]?.focus();
  }, [busy, error]);

  function onChange(value: string, index: number) {
    const filled = distributeOtpInput(code, index, value);
    setCode(filled);
    if (value) inputs.current[nextOtpFocus(filled, index)]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Backspace' && !code[index] && index > 0) inputs.current[index - 1]?.focus();
    if (e.key === 'ArrowLeft' && index > 0) inputs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < LENGTH - 1) inputs.current[index + 1]?.focus();
  }

  async function verify() {
    const token = code.join('');
    if (token.length < LENGTH) { setError(`Enter all ${LENGTH} digits.`); return; }
    if (!email) { setError('We do not know which address to verify. Please sign up again.'); return; }
    setBusy(true); setError(''); setInfo('');
    try {
      // 'signup', not 'email' — 'email' is for an email CHANGE confirmation.
      const { error: e } = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
      if (e) throw e;
      router.replace(next);
    } catch (err) {
      setError(readableError(err, 'Verification failed. Please try again.'));
      setCode(Array(LENGTH).fill(''));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!email || cooldown > 0) return;
    setResending(true); setError(''); setInfo('');
    try {
      const { error: e } = await supabase.auth.resend({ type: 'signup', email });
      if (e) throw e;
      setInfo('A new code is on its way. It can take a minute to arrive.');
      // The project allows very few verification emails per hour, so make the
      // wait explicit rather than letting people burn the quota on retries.
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      setError(readableError(err, 'Could not resend the code. Please try again.'));
    } finally {
      setResending(false);
    }
  }

  if (!email) {
    return (
      <main style={styles.wrap}>
        <div style={styles.card}>
          <h1 style={styles.h1}>Check your link</h1>
          <p style={styles.sub}>
            This page needs to know which address to verify, and no address was provided.
          </p>
          <Link href="/login" style={styles.primary}>Back to sign in</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Confirm your email</h1>
        <p style={styles.sub}>
          We sent a {LENGTH}-digit code to <strong>{email}</strong>. Enter it below to finish
          creating your account.
        </p>

        <div style={styles.boxes}>
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
              maxLength={LENGTH}
              aria-label={`Digit ${i + 1} of ${LENGTH}`}
              disabled={busy}
              style={styles.box}
            />
          ))}
        </div>

        {error ? <p role="alert" style={styles.error}>{error}</p> : null}
        {info ? <p role="status" style={styles.info}>{info}</p> : null}

        <button onClick={verify} disabled={busy} style={styles.primary}>
          {busy ? 'Verifying…' : 'Verify email'}
        </button>

        <div style={styles.footer}>
          <button
            onClick={resend}
            disabled={resending || cooldown > 0}
            style={{ ...styles.link, opacity: resending || cooldown > 0 ? 0.5 : 1 }}
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : resending ? 'Sending…' : 'Resend code'}
          </button>
          <Link href="/login" style={styles.link}>Back to sign in</Link>
        </div>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  // useSearchParams requires a Suspense boundary in the app router.
  return (
    <Suspense fallback={<main style={styles.wrap} />}>
      <VerifyEmailInner />
    </Suspense>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, padding: 32, borderRadius: 12, border: '1px solid rgba(148,163,184,0.25)' },
  h1: { fontSize: 24, fontWeight: 700, margin: '0 0 8px' },
  sub: { fontSize: 14, opacity: 0.7, margin: '0 0 24px', lineHeight: 1.5 },
  boxes: { display: 'flex', gap: 8, marginBottom: 16, justifyContent: 'space-between' },
  box: {
    flex: 1, minWidth: 0, height: 52, textAlign: 'center', fontSize: 20, fontWeight: 700,
    borderRadius: 8, border: '1px solid rgba(148,163,184,0.4)', background: 'transparent',
  },
  primary: {
    display: 'block', width: '100%', padding: '12px 16px', borderRadius: 8, border: 'none',
    background: '#f59e0b', color: '#000', fontWeight: 700, fontSize: 15, cursor: 'pointer',
    textAlign: 'center', textDecoration: 'none',
  },
  footer: { display: 'flex', justifyContent: 'space-between', marginTop: 16 },
  link: { background: 'none', border: 'none', padding: 0, color: 'inherit', opacity: 0.7, fontSize: 13, cursor: 'pointer', textDecoration: 'underline' },
  error: { color: '#ef4444', fontSize: 13, margin: '0 0 12px' },
  info: { color: '#10b981', fontSize: 13, margin: '0 0 12px' },
};
