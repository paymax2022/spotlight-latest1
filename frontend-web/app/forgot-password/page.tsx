'use client';

/**
 * Forgot password — the page login/page.tsx's "Forgot password?" link has
 * pointed to since before this page existed (AUTH-015). Only the API route
 * (app/api/auth/forgot-password/route.ts) existed; navigating here 404'd.
 *
 * The route's response is IDENTICAL whether or not the address has an
 * account, specifically to prevent enumeration — this page must not
 * undermine that by branching its own UI on the fetch outcome. Every non-busy
 * outcome except a genuine network failure shows the same generic message.
 *
 * The route sends both a Supabase recovery LINK and a code, but there is no
 * code-entry page yet (see app/auth/reset-password/page.tsx, which only
 * handles the link). So this page's copy only promises the link.
 */

import { useState } from 'react';
import Link from 'next/link';

function readableError(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  const lowered = message.toLowerCase();
  if (lowered.includes('failed to fetch') || lowered.includes('err_connection_refused')) {
    return 'The reset service is unreachable right now. Please try again shortly.';
  }
  return 'Something went wrong. Please try again.';
}

const SENT_MESSAGE = "If an account exists for that email, we've sent instructions to reset your password.";
const RATE_LIMITED_MESSAGE = 'Too many reset requests for that address. Please wait a while before trying again.';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [sentMessage, setSentMessage] = useState(SENT_MESSAGE);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      // A 429 here would be a rate limiter in front of this route itself
      // (AUTH_RESET_RATE_LIMIT_PER_HOUR gates the Go endpoint, but the proxy
      // deliberately folds every upstream status — including a limiter trip —
      // into the same 200 "accepted" response, so this branch is a defensive
      // fallback rather than the normal path). Distinguishing it is still
      // enumeration-safe: it says nothing about whether the account exists,
      // only that this address is being asked to slow down.
      if (res.status === 429) {
        setSentMessage(RATE_LIMITED_MESSAGE);
        setSent(true);
        return;
      }

      // Every other response — 200, and even a proxy-level 4xx/5xx — shows the
      // identical generic message. Branching UI on res.ok here would leak
      // exactly the enumeration signal the API was built to avoid.
      setSentMessage(SENT_MESSAGE);
      setSent(true);
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }

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
            {sent ? 'Check your inbox' : "We'll help you get back in"}
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
          {sent ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div
                style={{
                  background: 'rgba(34,197,94,0.15)',
                  border: '1px solid rgba(34,197,94,0.4)',
                  borderRadius: '0.625rem',
                  padding: '0.75rem 1rem',
                  color: '#86efac',
                  fontSize: '0.85rem',
                  lineHeight: 1.5,
                }}
              >
                {sentMessage}
              </div>
              <p style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.5, margin: 0 }}>
                If a link arrives, follow it to choose a new password. It can take a few minutes —
                check your spam folder if you don&apos;t see it.
              </p>
              <button
                type="button"
                onClick={() => { setSent(false); setError(''); }}
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Try a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ color: '#cbd5e1', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
                Enter the email address on your account and we&apos;ll send you a link to reset your
                password.
              </p>

              <div>
                <label
                  htmlFor="forgot-password-email"
                  style={{
                    display: 'block',
                    color: '#cbd5e1',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    marginBottom: '0.4rem',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
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

              {error && (
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
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy || !email.trim()}
                style={{
                  width: '100%',
                  padding: '0.875rem',
                  background: busy || !email.trim()
                    ? 'rgba(245,158,11,0.4)'
                    : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  color: busy || !email.trim() ? 'rgba(0,0,0,0.5)' : '#000000',
                  border: 'none',
                  borderRadius: '0.75rem',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  cursor: busy || !email.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  marginTop: '0.25rem',
                  letterSpacing: '0.01em',
                  boxShadow: busy || !email.trim() ? 'none' : '0 4px 15px rgba(245,158,11,0.35)',
                }}
              >
                {busy ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.07)',
  border: '1.5px solid rgba(255,255,255,0.12)',
  borderRadius: '0.75rem',
  padding: '0.8rem 1rem',
  color: '#f1f5f9',
  fontSize: '0.95rem',
  outline: 'none',
  transition: 'border-color 0.2s, background 0.2s',
  boxSizing: 'border-box',
};
