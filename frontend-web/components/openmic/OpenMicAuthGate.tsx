'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js'; // still needed for useState type

type Props = {
  nextPath: string;
  children: React.ReactNode;
};

export default function OpenMicAuthGate({ nextPath, children }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      setReady(true);
      if (!sessionUser) {
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
    });

    return () => { active = false; subscription.unsubscribe(); };
  }, [supabase, router, nextPath]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (!ready) {
    return (
      <div style={{ background: '#fff', borderRadius: 8, padding: 20, border: '1px solid #e5e7eb' }}>
        <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>Checking authentication…</p>
      </div>
    );
  }

  // ── Not signed in — redirect is underway; show brief prompt ──────────────
  if (!user) {
    return (
      <div style={{ background: '#fff', borderRadius: 8, padding: 24, border: '1px solid #e5e7eb', textAlign: 'center' }}>
        <p style={{ margin: '0 0 12px', fontWeight: 600, color: '#111827' }}>Sign in to apply</p>
        <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="theme-btn" style={{ fontSize: 13 }}>
          Sign In
        </Link>
      </div>
    );
  }

  // ── Signed in — show identity banner then render form ────────────────────
  const displayName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split('@')[0] ||
    'Artist';

  const initials = displayName
    .split(' ')
    .map((w: string) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>

      {/* ── Identity banner ─────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #0f0d1d 0%, #1a1854 100%)',
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        {/* Avatar */}
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'linear-gradient(135deg, #f59e0b, #d97706)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 15, color: '#000', flexShrink: 0,
          border: '2px solid rgba(245,158,11,0.5)',
        }}>
          {initials}
        </div>

        {/* Name + email */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{displayName}</span>
            {/* Green "Signed in" dot */}
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)',
              borderRadius: 20, padding: '1px 8px', fontSize: 10, fontWeight: 700, color: '#10b981',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              Signed in
            </span>
          </div>
          {user.email && (
            <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.email}
            </p>
          )}
        </div>

        {/* Sign out */}
        <button
          onClick={signOut}
          style={{
            background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
            color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 600,
            padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          Sign out
        </button>
      </div>

      {/* ── Form area ───────────────────────────────────────────────────── */}
      <div style={{ padding: 20 }}>
        {children}
      </div>
    </div>
  );
}
