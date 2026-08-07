'use client';

import { useEffect, useState } from 'react';
import { listContentModeration, moderateContent, formatNaira } from '@/services/creatorsAdminService';
import type { ContentModItem, ContentModAction, AgeRating } from '@/types/creatorsAdmin';
import { PageHeader, CreatorsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, input, label, select } from '../_ui';
import { colors } from '@/components/ui/vuexy';

const AGE_OPTS: { value: AgeRating; label: string }[] = [
  { value: 'all', label: 'All ages' },
  { value: 'teen', label: 'Teen (13+)' },
  { value: 'mature_18', label: 'Mature (18+)' },
];

export default function CreatorModerationPage() {
  const [rows, setRows] = useState<ContentModItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('pending');
  const [age, setAge] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // per-row pending age-rating selection
  const [ageSel, setAgeSel] = useState<Record<string, AgeRating>>({});

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listContentModeration({ status: status || undefined, age_rating: age || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, age]);

  async function moderate(item: ContentModItem, action: ContentModAction) {
    const rating = ageSel[item.id] ?? item.age_rating;
    const note = window.prompt(`${action} "${item.title}" (${item.id}) with age rating "${rating}"? This is an audited moderation decision (NL-11). Enter a note:`);
    if (note === null) return;
    setBusy(item.id); setMsg(null);
    try {
      const res = await moderateContent(item.id, action, rating, note || undefined);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Content moderation & age controls" subtitle="Review creator content (free, gated and paid) for policy and age safety before it goes live. Approve, reject, or flag — and set the correct age rating." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <CreatorsTabs active="moderation" />
      <DisclosureNote>
        <strong>NL-11 — content & age safety.</strong> The Spotlight audience skews young: never approve a path that could expose minors to unsafe or adult content,
        and never weaken these controls for engagement. Every decision sets an age rating and posts an immutable audit event (NL-12).
      </DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Title, creator or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="flagged">Flagged</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div>
          <label style={label()}>Age rating</label>
          <select style={select()} value={age} onChange={(e) => setAge(e.target.value)}>
            <option value="">All</option>
            {AGE_OPTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No content in this queue.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Content</th><th style={th()}>Creator</th><th style={th()}>Type</th><th style={th()}>Price</th>
              <th style={th()}>Auto-flags</th><th style={th()}>Reports</th><th style={th()}>Age rating</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.title}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id}</div></td>
                  <td style={td()}>{r.creator_handle_masked}</td>
                  <td style={td()}>{r.kind.replace(/_/g, ' ')}</td>
                  <td style={td()}>{r.is_paid ? formatNaira(r.price_kobo) : <span style={{ color: colors.muted }}>free</span>}</td>
                  <td style={td()}>
                    {r.auto_flags.length === 0 ? <span style={{ color: colors.muted }}>—</span> : r.auto_flags.map((f) => <div key={f} style={{ marginBottom: 3 }}><Badge status="flagged" label={f.replace(/_/g, ' ')} /></div>)}
                  </td>
                  <td style={td()}><span style={{ color: r.reports_count > 0 ? colors.danger : colors.muted, fontWeight: r.reports_count > 0 ? 700 : 400 }}>{r.reports_count}</span></td>
                  <td style={td()}>
                    <select
                      style={{ ...select(), width: 130 }}
                      value={ageSel[r.id] ?? r.age_rating}
                      onChange={(e) => setAgeSel((s) => ({ ...s, [r.id]: e.target.value as AgeRating }))}
                    >
                      {AGE_OPTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>
                    <div style={{ marginTop: 4 }}><Badge status={r.age_rating} label={`current: ${r.age_rating.replace(/_/g, ' ')}`} /></div>
                  </td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>
                    {(r.status === 'pending' || r.status === 'flagged') ? (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button style={btnPrimary()} disabled={busy === r.id} onClick={() => moderate(r, 'approve')}>{busy === r.id ? '…' : 'Approve'}</button>
                        <button style={btn()} disabled={busy === r.id} onClick={() => moderate(r, 'flag')}>Flag</button>
                        <button style={btnDanger()} disabled={busy === r.id} onClick={() => moderate(r, 'reject')}>Reject</button>
                      </div>
                    ) : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
