'use client';

import { useEffect, useState } from 'react';
import { listContent, transitionContent, listLocalizations } from '@/services/academyAdminService';
import type { ContentItem, ContentTransition, Localization } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, StateBlock, AuditNote, DisclosureNote, btn, btnPrimary, btnDanger, th, td, fmtDate, timeAgo } from '../_ui';

// Forward-only publish workflow. Each status exposes only the transitions that
// are valid from it; the UI renders exactly those buttons.
const ACTIONS_BY_STATUS: Record<ContentItem['status'], { action: ContentTransition; label: string; danger?: boolean }[]> = {
  draft: [{ action: 'submit_review', label: 'Submit for review' }],
  review: [{ action: 'approve', label: 'Approve' }, { action: 'send_back', label: 'Send back', danger: true }],
  approved: [{ action: 'publish', label: 'Publish (go live)' }, { action: 'send_back', label: 'Send back', danger: true }],
  live: [{ action: 'archive', label: 'Archive', danger: true }],
  archived: [],
};

export default function ContentPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [locs, setLocs] = useState<Localization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [c, l] = await Promise.all([listContent(), listLocalizations()]);
      setItems(c); setLocs(l);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function transition(id: string, action: ContentTransition, label: string) {
    setBusy(id); setNotice(null);
    try {
      const updated = await transitionContent({ id, action });
      setNotice(`"${updated.title}" → ${updated.status} (${label}).`);
      await load();
    } catch (e) { setNotice(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Content management (CMS)" subtitle="Lessons, episodic series and bundle content with a forward-only publish workflow, low-data media variants and localizations." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="content" />
      <DisclosureNote>Requires <code>academy.content</code>. Publish workflow is forward-only: <strong>draft → review → approved → live → archived</strong>. Archived content is read-only; corrections create a new version.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={items.length === 0}>
        <Card title="Content library">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Title</th><th style={th()}>Kind</th><th style={th()}>Subject / Class</th>
              <th style={th()}>Status</th><th style={th()}>Variants</th><th style={th()}>Localized</th>
              <th style={th()}>Ver</th><th style={th()}>Updated</th><th style={th()}>Workflow</th>
            </tr></thead>
            <tbody>
              {items.map((c) => {
                const readyVariants = c.variants.filter((v) => v.ready).length;
                const actions = ACTIONS_BY_STATUS[c.status];
                return (
                  <tr key={c.id}>
                    <td style={td()}><strong>{c.title}</strong></td>
                    <td style={td()}>{c.kind.replace(/_/g, ' ')}</td>
                    <td style={td()}>{c.subject} · {c.class_name}</td>
                    <td style={td()}><Badge status={c.status} /></td>
                    <td style={td()}>{readyVariants}/{c.variants.length}{c.variants.some((v) => v.quality === 'low_data' && v.ready) ? <span title="low-data variant ready" style={{ marginLeft: 6, color: '#15803d' }}>•lo</span> : null}</td>
                    <td style={td()}>{c.localizations.join(', ')}</td>
                    <td style={td()}>v{c.version}</td>
                    <td style={td()}>{timeAgo(c.updated_at)}</td>
                    <td style={td()}>
                      {actions.length === 0 ? <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>—</span> : (
                        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                          {actions.map((a) => (
                            <button key={a.action} onClick={() => transition(c.id, a.action, a.label)} disabled={busy === c.id} style={a.danger ? btnDanger() : btnPrimary()}>{a.label}</button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Every publish-workflow transition is recorded to the immutable audit log with actor and timestamp.</AuditNote>
        </Card>

        <Card title="Media variants & localization queue" right={<span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>English + Nigerian languages</span>}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Content</th><th style={th()}>Language</th><th style={th()}>Status</th><th style={th()}>Translator</th><th style={th()}>Coverage</th><th style={th()}>Updated</th></tr></thead>
            <tbody>
              {locs.map((l) => {
                const content = items.find((c) => c.id === l.content_id);
                return (
                  <tr key={l.id}>
                    <td style={td()}>{content?.title ?? l.content_id}</td>
                    <td style={td()}>{l.language}</td>
                    <td style={td()}><Badge status={l.status} /></td>
                    <td style={td()}>{l.translator ?? '—'}</td>
                    <td style={td()}>{Math.round(l.coverage_pct * 100)}%</td>
                    <td style={td()}>{fmtDate(l.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </div>
  );
}
