'use client';

// Small presentational pieces shared by the claims and referrals consoles. The
// leading underscore keeps this file out of the route tree.
import type { ReactNode } from 'react';
import { colors } from '@/components/ui/vuexy';
import { btn } from '../_ui';

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' }} role="dialog" aria-modal="true" aria-label={title}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.35)' }} />
      <aside style={{ position: 'relative', width: 'min(520px, 100vw)', background: colors.card, height: '100%', overflowY: 'auto', padding: '1.25rem', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: colors.text }}>{title}</h2>
          <button style={btn()} onClick={onClose}>Close</button>
        </div>
        {children}
      </aside>
    </div>
  );
}

export function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl style={{ margin: '0 0 1rem', display: 'grid', gridTemplateColumns: '150px 1fr', gap: '0.45rem 0.75rem', fontSize: '0.85rem' }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ color: colors.muted }}>{k}</dt>
          <dd style={{ margin: 0, color: colors.text, wordBreak: 'break-word' }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DetailJson({ detail }: { detail: Record<string, unknown> }) {
  const entries = Object.entries(detail ?? {});
  if (entries.length === 0) return <p style={{ color: colors.muted, fontSize: '0.82rem' }}>No additional detail on file.</p>;
  return (
    <pre style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: '0.4rem', padding: '0.7rem', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflow: 'auto', margin: '0 0 1rem' }}>
      {JSON.stringify(detail, null, 2)}
    </pre>
  );
}

export function Pager({ total, offset, limit, onPage }: { total: number; offset: number; limit: number; onPage: (offset: number) => void }) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.8rem', fontSize: '0.82rem', color: colors.muted }}>
      <button style={btn()} disabled={offset <= 0} onClick={() => onPage(Math.max(0, offset - limit))}>Previous</button>
      <span>{from}–{to} of {total.toLocaleString('en-NG')}</span>
      <button style={btn()} disabled={offset + limit >= total} onClick={() => onPage(offset + limit)}>Next</button>
    </div>
  );
}

export function SubTabs<T extends string>({ tabs, active, onChange }: { tabs: { key: T; label: string; count?: number }[]; active: T; onChange: (k: T) => void }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          style={{
            padding: '0.35rem 0.8rem', borderRadius: 9999, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${active === t.key ? colors.primary : colors.border}`,
            color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.card,
          }}
        >
          {t.label}{t.count !== undefined ? ` (${t.count.toLocaleString('en-NG')})` : ''}
        </button>
      ))}
    </div>
  );
}

export const humanize = (s: string) => s.replace(/_/g, ' ');
