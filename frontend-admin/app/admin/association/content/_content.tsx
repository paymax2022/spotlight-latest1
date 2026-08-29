'use client';

// Shared kit for the five content-authoring pages (announcements, meetings,
// documents, events, tasks).
//
// These five pages differ only in their form fields and their table columns —
// every one of them otherwise needs the same org scoping, the same
// load/create/edit/delete lifecycle, the same "this notifies everyone" warning
// and the same audit disclosure. Writing that five times is how the five drift
// apart, so it lives here once and each page supplies only what is genuinely
// its own.
//
// Everything is built on the existing primitives: <Page>/<Card>/<Button> from
// @/components/ui/vuexy and AssociationTabs/OrgPicker/PermissionBanner from
// ../_ui. Nothing here is a parallel design system.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AssociationTabs, OrgPicker, DisclosureNote, AuditNote, StateBlock,
  useAssociationPermissions, ASSOCIATION_PERMS, PermissionBanner,
} from '../_ui';
import { Page, PageHeader, Button, colors, tint } from '@/components/ui/vuexy';

export const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem',
};
export const selectStyle: React.CSSProperties = {
  padding: '0.45rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
  fontSize: '0.85rem', background: colors.card, cursor: 'pointer', width: '100%', boxSizing: 'border-box',
};
export const textareaStyle: React.CSSProperties = {
  padding: '0.45rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
  fontSize: '0.85rem', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};
export const formGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.8rem', marginTop: 12,
};

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div style={wide ? { gridColumn: '1 / -1' } : undefined}><label style={labelStyle}>{label}</label>{children}</div>;
}

export function Check({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: colors.text }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/**
 * The notify toggle, with the blast radius spelled out.
 *
 * `notify: true` inserts one assoc_notifications row per ACTIVE member of the
 * organisation (service_content.go notifyOrg) — for a 12,000-member union that
 * is 12,000 notifications from one checkbox, and it is only honoured on create,
 * so it cannot be undone by editing afterwards. A bare "Notify" label gives an
 * operator no way to know that.
 */
export function NotifyCheck({ checked, onChange, disabled, memberCount, what }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
  memberCount?: number | null; what: string;
}) {
  const who = memberCount != null && memberCount > 0
    ? `all ${memberCount.toLocaleString('en-NG')} active member(s)`
    : 'every active member';
  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <Check label={`Notify members about this ${what}`} checked={checked} onChange={onChange} disabled={disabled} />
      {checked && (
        <div style={{
          border: `1px solid ${tint(colors.warning, 0.4)}`, background: tint(colors.warning, 0.1),
          color: '#92400e', borderRadius: '0.375rem', padding: '0.45rem 0.6rem',
          fontSize: '0.75rem', marginTop: '0.4rem',
        }}>
          This sends an in-app notification to {who} of this organisation. It happens once, on save, and cannot be
          recalled by editing the {what} afterwards.
        </div>
      )}
    </div>
  );
}

/**
 * Editor for the two string-array fields in this module (meeting agenda, task
 * checklist). Both are stored as a JSON array, and both are replaced wholesale
 * on PATCH — there is no per-item route — so the editor works on a local copy
 * and the page sends the whole list.
 */
export function StringListEditor({ items, onChange, disabled, placeholder, addLabel }: {
  items: string[]; onChange: (next: string[]) => void; disabled?: boolean;
  placeholder: string; addLabel: string;
}) {
  const set = (i: number, v: string) => onChange(items.map((x, n) => (n === i ? v : x)));
  const remove = (i: number) => onChange(items.filter((_, n) => n !== i));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {items.length === 0 && <p style={{ margin: 0, fontSize: '0.8rem', color: colors.muted }}>No items yet.</p>}
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: colors.muted, width: 18, textAlign: 'right' }}>{i + 1}.</span>
          <input
            className="vx-input" style={{ flex: 1 }} value={it} disabled={disabled}
            placeholder={placeholder} onChange={(e) => set(i, e.target.value)}
          />
          <Button sm variant="outline" disabled={disabled || i === 0} onClick={() => move(i, -1)} title="Move up">↑</Button>
          <Button sm variant="outline" disabled={disabled || i === items.length - 1} onClick={() => move(i, 1)} title="Move down">↓</Button>
          <Button sm variant="danger" disabled={disabled} onClick={() => remove(i)} title="Remove">✕</Button>
        </div>
      ))}
      <div><Button sm variant="outline" disabled={disabled} onClick={() => onChange([...items, ''])}>{addLabel}</Button></div>
    </div>
  );
}

/** Small key/value strip used under a row title in the tables. */
export function MetaLine({ parts }: { parts: (string | null | undefined | false)[] }) {
  const shown = parts.filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (shown.length === 0) return null;
  return <div style={{ fontSize: '0.75rem', color: colors.muted, marginTop: 2 }}>{shown.join(' · ')}</div>;
}

/**
 * Load-and-reload for one org-scoped listing.
 *
 * The fetcher is held in a ref so a page can pass an inline arrow function
 * without the identity of that closure re-triggering the effect on every
 * render — the only real dependency is the organisation.
 */
export function useContentRows<T>(orgId: string | null, fetcher: (orgId: string) => Promise<T[]>) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const reload = useCallback(async () => {
    if (!orgId) { setRows([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try { setRows(await fetchRef.current(orgId)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { void reload(); }, [reload]);
  return { rows, loading, error, reload, setError };
}

/** The page chrome every content page shares. */
export function ContentScaffold({
  tab, title, subtitle, disclosure, orgId, loading, error, msg, canManage,
  onRefresh, children,
}: {
  tab: string; title: string; subtitle: string; disclosure: ReactNode;
  orgId: string | null; loading: boolean; error: string | null; msg: string | null;
  canManage: boolean; onRefresh: () => void; children: ReactNode;
}) {
  return (
    <Page>
      <PageHeader
        title={title} subtitle={subtitle}
        actions={<Button variant="outline" onClick={onRefresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>}
      />
      <AssociationTabs active={tab} />
      <OrgPicker />
      <DisclosureNote>{disclosure}</DisclosureNote>
      {!canManage && <PermissionBanner text="You have read-only access — your role can view this content but cannot author or delete it." />}
      {msg && <AuditNote>{msg}</AuditNote>}
      {error && <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p>}
      {!orgId
        ? <p style={{ color: colors.muted, fontSize: '0.85rem' }}>Select an organisation above to author its content.</p>
        : children}
    </Page>
  );
}

export { StateBlock, useAssociationPermissions, ASSOCIATION_PERMS };
