'use client';

import { useCallback, useEffect, useState } from 'react';
import { listUsers, setUserStatus } from '@/services/crowdfundingAdminService';
import type { CfUser, CfRiskLevel } from '@/types/crowdfunding';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const RISK_COLOR: Record<CfRiskLevel, string> = { LOW: colors.success, MEDIUM: colors.warning, HIGH: colors.danger };
const STATUS_BADGE: Record<string, string> = { ACTIVE: colors.success, SUSPENDED: colors.danger, RESTRICTED: colors.warning };

function naira(kobo: number): string {
  const n = kobo / 100;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toLocaleString('en-NG')}`;
}

export default function UsersPage() {
  const [items, setItems] = useState<CfUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CfUser | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<{ id: string; to: 'ACTIVE' | 'SUSPENDED'; name: string; note: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await listUsers(role || undefined, status || undefined, search || undefined)); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [role, status, search]);
  useEffect(() => { load(); }, [load]);

  async function confirm() {
    if (!modal) return;
    if (modal.to === 'SUSPENDED' && !modal.note.trim()) { setError('A reason is required to suspend.'); return; }
    setBusy(modal.id); setError(null);
    try { await setUserStatus(modal.id, modal.to, modal.note); setModal(null); setSelected(null); await load(); }
    catch (e) { setError(String(e)); } finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="User & Creator Management" subtitle="Search users and creators, review activity, suspend or restore accounts." />

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email…" style={{ minWidth: 220 }} />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={sel()}>
          <option value="">All roles</option><option value="CONTRIBUTOR">Contributor</option><option value="CREATOR">Creator</option><option value="ORGANISATION">Organisation</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={sel()}>
          <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="RESTRICTED">Restricted</option>
        </select>
        <Button variant="outline" sm style={{ marginLeft: 'auto' }} onClick={load}>Refresh</Button>
      </div>

      {error && <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p>}

      {loading ? <p style={{ color: colors.muted }}>Loading users…</p> : items.length === 0 ? <p style={{ color: colors.muted }}>No users match.</p> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
            <thead><tr>
              <th style={thCell}>User</th><th style={thCell}>Role</th><th style={thCell}>Verification</th><th style={thCell}>Raised / Given</th><th style={thCell}>Risk</th><th style={thCell}>Status</th><th style={thCell}></th>
            </tr></thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td style={tdCell}><strong>{u.name}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{u.email}</div></td>
                  <td style={tdCell}>{u.role[0] + u.role.slice(1).toLowerCase()}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{u.type}</div></td>
                  <td style={tdCell}>{u.verification}</td>
                  <td style={tdCell}>{u.role === 'CONTRIBUTOR' ? naira(u.totalContributedKobo) : naira(u.totalRaisedKobo)}</td>
                  <td style={tdCell}><span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, padding: '0.1rem 0.5rem', borderRadius: '9999px', color: RISK_COLOR[u.riskLevel], border: `1px solid ${RISK_COLOR[u.riskLevel]}` }}>{u.riskLevel}</span></td>
                  <td style={tdCell}><Badge text={u.status} color={STATUS_BADGE[u.status]} /></td>
                  <td style={tdCell}><Button variant="outline" sm onClick={() => setSelected(u)}>View</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Detail drawer */}
      {selected && (
        <div style={overlay()} onClick={() => setSelected(null)}>
          <div style={{ ...sheet(), maxWidth: '34rem' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontWeight: 700, margin: 0 }}>{selected.name}</h2>
                <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0.2rem 0 0' }}>{selected.email} · {selected.type} · joined {new Date(selected.joinedAt).toLocaleDateString()}</p>
              </div>
              <Badge text={selected.status} color={STATUS_BADGE[selected.status]} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', margin: '1rem 0' }}>
              <Mini label="Campaigns" value={String(selected.campaignsCreated)} />
              <Mini label="Raised" value={naira(selected.totalRaisedKobo)} />
              <Mini label="Contributed" value={naira(selected.totalContributedKobo)} />
            </div>

            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Activity log</h3>
            <div style={{ maxHeight: 200, overflowY: 'auto', border: `1px solid ${colors.border}`, borderRadius: '0.5rem' }}>
              {selected.activity.map((a) => (
                <div key={a.id} style={{ padding: '0.5rem 0.75rem', borderBottom: `1px solid ${colors.border}`, fontSize: '0.8rem' }}>
                  <code style={{ background: colors.headBg, padding: '0.05rem 0.3rem', borderRadius: '0.25rem', fontSize: '0.72rem' }}>{a.action}</code>
                  <span style={{ color: colors.text }}> {a.detail}</span>
                  <div style={{ color: colors.muted, fontSize: '0.7rem' }}>{new Date(a.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>

            {error && <p style={{ color: colors.danger, fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
              {selected.status === 'SUSPENDED'
                ? <Button variant="primary" disabled={busy === selected.id} onClick={() => { setModal({ id: selected.id, to: 'ACTIVE', name: selected.name, note: '' }); setError(null); }}>Restore account</Button>
                : <Button variant="danger" disabled={busy === selected.id} onClick={() => { setModal({ id: selected.id, to: 'SUSPENDED', name: selected.name, note: '' }); setError(null); }}>Suspend account</Button>}
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {modal && (
        <div style={overlay()}>
          <div style={sheet()}>
            <h2 style={{ fontWeight: 700, marginTop: 0 }}>{modal.to === 'SUSPENDED' ? 'Suspend account' : 'Restore account'}</h2>
            <p style={{ fontSize: '0.85rem', color: colors.text }}>{modal.to === 'SUSPENDED' ? `${modal.name} will be blocked from creating campaigns and withdrawing.` : `${modal.name} will regain full access.`}</p>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600 }}>
              {modal.to === 'SUSPENDED' ? 'Reason (required)' : 'Note (optional)'}
              <textarea value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} rows={3} style={textarea()} />
            </label>
            {error && <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <Button variant="outline" onClick={() => { setModal(null); setError(null); }}>Cancel</Button>
              <Button variant={modal.to === 'SUSPENDED' ? 'danger' : 'primary'} disabled={!!busy} onClick={confirm}>{busy ? 'Working…' : 'Confirm'}</Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (<div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}><div style={{ fontSize: '0.68rem', color: colors.muted, textTransform: 'uppercase' }}>{label}</div><div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{value}</div></div>);
}

const sel = (): React.CSSProperties => ({ padding: '0.4rem 0.6rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', background: colors.card });
const overlay = (): React.CSSProperties => ({ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 });
const sheet = (): React.CSSProperties => ({ background: colors.card, borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '28rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' });
const textarea = (): React.CSSProperties => ({ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' });
