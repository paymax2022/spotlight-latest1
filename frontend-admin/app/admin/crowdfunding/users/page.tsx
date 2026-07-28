'use client';

import { useCallback, useEffect, useState } from 'react';
import { listUsers, setUserStatus } from '@/services/crowdfundingAdminService';
import type { CfUser, CfRiskLevel } from '@/types/crowdfunding';

const RISK_COLOR: Record<CfRiskLevel, string> = { LOW: '#16a34a', MEDIUM: '#d97706', HIGH: '#dc2626' };
const STATUS_BADGE: Record<string, string> = { ACTIVE: '#16a34a', SUSPENDED: '#dc2626', RESTRICTED: '#d97706' };

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>User & Creator Management</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.25rem', fontSize: '0.85rem' }}>Search users and creators, review activity, suspend or restore accounts.</p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email…" style={{ padding: '0.4rem 0.7rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', minWidth: 220 }} />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={sel()}>
          <option value="">All roles</option><option value="CONTRIBUTOR">Contributor</option><option value="CREATOR">Creator</option><option value="ORGANISATION">Organisation</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={sel()}>
          <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="RESTRICTED">Restricted</option>
        </select>
        <button onClick={load} style={{ marginLeft: 'auto', ...btn() }}>Refresh</button>
      </div>

      {error && <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>}

      {loading ? <p style={{ color: '#6b7280' }}>Loading users…</p> : items.length === 0 ? <p style={{ color: '#6b7280' }}>No users match.</p> : (
        <div style={{ ...card(), padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
            <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
              <th style={th()}>User</th><th style={th()}>Role</th><th style={th()}>Verification</th><th style={th()}>Raised / Given</th><th style={th()}>Risk</th><th style={th()}>Status</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td()}><strong>{u.name}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{u.email}</div></td>
                  <td style={td()}>{u.role[0] + u.role.slice(1).toLowerCase()}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{u.type}</div></td>
                  <td style={td()}>{u.verification}</td>
                  <td style={td()}>{u.role === 'CONTRIBUTOR' ? naira(u.totalContributedKobo) : naira(u.totalRaisedKobo)}</td>
                  <td style={td()}><span style={{ ...badge('#fff'), color: RISK_COLOR[u.riskLevel], border: `1px solid ${RISK_COLOR[u.riskLevel]}` }}>{u.riskLevel}</span></td>
                  <td style={td()}><span style={badge(STATUS_BADGE[u.status])}>{u.status}</span></td>
                  <td style={td()}><button onClick={() => setSelected(u)} style={btn()}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <div style={overlay()} onClick={() => setSelected(null)}>
          <div style={{ ...sheet(), maxWidth: '34rem' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontWeight: 700, margin: 0 }}>{selected.name}</h2>
                <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0.2rem 0 0' }}>{selected.email} · {selected.type} · joined {new Date(selected.joinedAt).toLocaleDateString()}</p>
              </div>
              <span style={badge(STATUS_BADGE[selected.status])}>{selected.status}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', margin: '1rem 0' }}>
              <Mini label="Campaigns" value={String(selected.campaignsCreated)} />
              <Mini label="Raised" value={naira(selected.totalRaisedKobo)} />
              <Mini label="Contributed" value={naira(selected.totalContributedKobo)} />
            </div>

            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Activity log</h3>
            <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #f3f4f6', borderRadius: '0.5rem' }}>
              {selected.activity.map((a) => (
                <div key={a.id} style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f3f4f6', fontSize: '0.8rem' }}>
                  <code style={{ background: '#f3f4f6', padding: '0.05rem 0.3rem', borderRadius: '0.25rem', fontSize: '0.72rem' }}>{a.action}</code>
                  <span style={{ color: '#374151' }}> {a.detail}</span>
                  <div style={{ color: '#9ca3af', fontSize: '0.7rem' }}>{new Date(a.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>

            {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button onClick={() => setSelected(null)} style={btn()}>Close</button>
              {selected.status === 'SUSPENDED'
                ? <button disabled={busy === selected.id} onClick={() => { setModal({ id: selected.id, to: 'ACTIVE', name: selected.name, note: '' }); setError(null); }} style={primaryBtn('#16a34a')}>Restore account</button>
                : <button disabled={busy === selected.id} onClick={() => { setModal({ id: selected.id, to: 'SUSPENDED', name: selected.name, note: '' }); setError(null); }} style={primaryBtn('#dc2626')}>Suspend account</button>}
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {modal && (
        <div style={overlay()}>
          <div style={sheet()}>
            <h2 style={{ fontWeight: 700, marginTop: 0 }}>{modal.to === 'SUSPENDED' ? 'Suspend account' : 'Restore account'}</h2>
            <p style={{ fontSize: '0.85rem', color: '#374151' }}>{modal.to === 'SUSPENDED' ? `${modal.name} will be blocked from creating campaigns and withdrawing.` : `${modal.name} will regain full access.`}</p>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600 }}>
              {modal.to === 'SUSPENDED' ? 'Reason (required)' : 'Note (optional)'}
              <textarea value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} rows={3} style={textarea()} />
            </label>
            {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <button onClick={() => { setModal(null); setError(null); }} style={btn()}>Cancel</button>
              <button onClick={confirm} disabled={!!busy} style={primaryBtn(modal.to === 'SUSPENDED' ? '#dc2626' : '#16a34a')}>{busy ? 'Working…' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (<div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}><div style={{ fontSize: '0.68rem', color: '#6b7280', textTransform: 'uppercase' }}>{label}</div><div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{value}</div></div>);
}

const card = (): React.CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
const btn = (): React.CSSProperties => ({ padding: '0.35rem 0.7rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.8rem' });
const primaryBtn = (bg: string): React.CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' });
const sel = (): React.CSSProperties => ({ padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', background: '#fff' });
const th = (): React.CSSProperties => ({ padding: '0.5rem 0.75rem', fontWeight: 600 });
const td = (): React.CSSProperties => ({ padding: '0.55rem 0.75rem', color: '#374151' });
const overlay = (): React.CSSProperties => ({ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 });
const sheet = (): React.CSSProperties => ({ background: '#fff', borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '28rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' });
const textarea = (): React.CSSProperties => ({ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' });
function badge(bg: string): React.CSSProperties {
  return { background: bg, color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '9999px', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 };
}
