'use client';

import Link from 'next/link';
import { useEffect, useState, type CSSProperties } from 'react';
import type { AdminMenuCounts } from '@/types/admin';
import { getAdminMenuCounts } from '@/services/adminApiClient';
import { canManageStem, canReadStem, getCurrentStemRole } from '@/config/stemAccess';
import { quickLinks } from './quickLinks';

// Vuexy-style palette mirroring the production admin (frontend-web/app/admin).
// frontend-admin ships no CSS framework, so the dashboard is styled inline — the
// house convention across every admin page here.
const C = {
  primary: '#7367f0',
  primaryDark: '#655bd8',
  green: '#28c76f',
  cyan: '#00cfe8',
  orange: '#ff9f43',
  red: '#ff4c51',
  text: '#2f2b3d',
  muted: '#6f6b7d',
  border: '#ebe9f1',
  bg: '#f8f7fa',
};

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function fmtNum(n?: number): string {
  return typeof n === 'number' ? n.toLocaleString('en-NG') : '—';
}

const card: CSSProperties = {
  background: '#fff',
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 18,
  boxShadow: '0 4px 18px rgba(47,43,61,0.06)',
};
const sectionTitle: CSSProperties = { margin: 0, fontSize: 17, fontWeight: 700, color: C.text };

export function AdminDashboard() {
  const [counts, setCounts] = useState<AdminMenuCounts | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const role = getCurrentStemRole();
  const visibleQuickLinks = quickLinks.filter((item) => {
    if (item.stemAccess === 'read') return canReadStem(role);
    if (item.stemAccess === 'manage') return canManageStem(role);
    return true;
  });

  useEffect(() => {
    let alive = true;
    getAdminMenuCounts()
      .then((c) => { if (alive) { setCounts(c); setLoaded(true); } })
      .catch(() => { if (alive) { setFailed(true); setLoaded(true); } });
    return () => { alive = false; };
  }, []);

  const total = counts
    ? counts.contestants + counts.auditions + counts.academy + counts.reality_tv +
      counts.sme_pitch + counts.stem + counts.bootcamp + counts.open_mic
    : undefined;

  const heroStats = [
    { label: 'Contestants', value: counts?.contestants, sub: 'Registered' },
    { label: 'Open Mic', value: counts?.open_mic, sub: 'Submissions' },
    { label: 'Auditions', value: counts?.auditions, sub: 'In queue' },
    { label: 'Reality TV', value: counts?.reality_tv, sub: 'Active' },
  ];

  const statCards = [
    { label: 'Academy', value: counts?.academy, icon: '🎓', tint: C.primary },
    { label: 'SME Pitch', value: counts?.sme_pitch, icon: '💼', tint: C.cyan },
    { label: 'STEM', value: counts?.stem, icon: '🔬', tint: C.orange },
    { label: 'Bootcamp', value: counts?.bootcamp, icon: '🚀', tint: C.green },
  ];

  return (
    <div style={{ color: C.text, background: C.bg, minHeight: '100%', margin: -24, padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800 }}>Spotlight Analytics</h1>
        <p style={{ margin: '4px 0 0', color: C.muted }}>Programs, contests, voting and applicant operations.</p>
      </div>

      {/* Hero + operations overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 16, marginBottom: 16 }}>
        <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 12, padding: 20, color: '#fff', minHeight: 208, background: `linear-gradient(135deg, ${C.primary} 0%, ${C.primaryDark} 100%)`, boxShadow: '0 12px 34px rgba(115,103,240,0.28)' }}>
          <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>Live overview</div>
          <div style={{ fontSize: 32, fontWeight: 800, marginTop: 6 }}>
            {loaded ? fmtNum(total) : '—'}
            <span style={{ fontSize: 14, fontWeight: 600, opacity: 0.85 }}> total entities</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 26, maxWidth: 640 }}>
            {heroStats.map((s) => (
              <div key={s.label}>
                <div style={{ fontSize: 12, opacity: 0.82, fontWeight: 600 }}>{s.label}</div>
                <div style={{ display: 'inline-block', marginTop: 8, background: 'rgba(255,255,255,0.16)', borderRadius: 8, padding: '6px 12px', fontWeight: 800 }}>
                  {loaded ? fmtNum(s.value) : '—'}
                </div>
                <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>{s.sub}</div>
              </div>
            ))}
          </div>
          <div aria-hidden style={{ position: 'absolute', right: 44, bottom: 26, width: 122, height: 122, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.5), rgba(255,255,255,0.08) 30%, rgba(47,43,61,0.16) 31%, rgba(47,43,61,0.06) 100%)', boxShadow: 'inset -20px -22px 40px rgba(47,43,61,0.18)' }} />
        </div>

        <div style={card}>
          <div style={{ color: C.muted, fontSize: 13 }}>Operations Overview</div>
          <div style={{ fontSize: 30, fontWeight: 800, marginTop: 4 }}>{loaded ? fmtNum(total) : '—'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
            <MiniStat icon="✅" tint={C.cyan} value={loaded ? fmtNum(counts?.contestants) : '—'} label="Contestants" />
            <MiniStat icon="🎤" tint={C.orange} value={loaded ? fmtNum(counts?.open_mic) : '—'} label="Open Mic" />
          </div>
          <div style={{ marginTop: 18, height: 8, borderRadius: 999, overflow: 'hidden', background: C.border }}>
            <div style={{ height: '100%', width: '72%', background: `linear-gradient(90deg, ${C.cyan}, ${C.primary})` }} />
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
        {statCards.map((s) => (
          <div key={s.label} style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, color: C.muted }}>{s.label}</div>
                <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8 }}>{loaded ? fmtNum(s.value) : '—'}</div>
              </div>
              <div style={{ width: 42, height: 42, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, background: rgba(s.tint, 0.13) }}>{s.icon}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick actions + status */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 16 }}>
        <div style={card}>
          <h2 style={sectionTitle}>Quick Actions</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {visibleQuickLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{ textDecoration: 'none', color: C.primary, border: `1px solid ${rgba(C.primary, 0.5)}`, borderRadius: 6, padding: '7px 11px', fontSize: 12, fontWeight: 600, background: rgba(C.primary, 0.05) }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        <div style={card}>
          <h2 style={sectionTitle}>System Status</h2>
          <ul style={{ margin: '14px 0 0', paddingLeft: 18, color: C.muted, fontSize: 13, lineHeight: 1.9 }}>
            <li>
              Live counts:{' '}
              <strong style={{ color: failed ? C.red : C.green }}>
                {!loaded ? 'loading…' : failed ? 'API unreachable' : 'connected'}
              </strong>
              {failed ? ' — check the backend API is running.' : ''}
            </li>
            <li>{visibleQuickLinks.length} modules available for your role (<strong style={{ color: C.text }}>{role}</strong>).</li>
            <li>Review pending applications and reconcile payments regularly.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ icon, tint, value, label }: { icon: string; tint: string; value: string; label: string }) {
  return (
    <div>
      <div style={{ width: 32, height: 32, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, background: rgba(tint, 0.14) }}>{icon}</div>
      <div style={{ fontWeight: 800, marginTop: 8, color: C.text }}>{value}</div>
      <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
    </div>
  );
}
