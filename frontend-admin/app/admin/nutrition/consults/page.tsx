'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ConsultFilters, ConsultStatus, NutritionistConsult } from '@/types/nutritionAdmin';
import { listConsults, transitionConsult, ageFromNow } from '@/services/nutritionAdminService';
import { ConsultStatusBadge } from '../statusBadge';
import { useNutritionPermissions, NUTRITION_PERMS } from '../_ui';

const card = { border: '1px solid #2a2a2a', padding: 12, borderRadius: 6 } as const;
const th = { padding: '8px 6px', fontWeight: 600, opacity: 0.8 } as const;
const td = { padding: '8px 6px' } as const;
const input = { background: '#111', color: '#eee', border: '1px solid #2a2a2a', padding: '4px 6px', borderRadius: 4 } as const;

const STATUS_OPTIONS = ['', 'PENDING_REVIEW', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED', 'ESCALATED'];
const PRIORITY_OPTIONS = ['', 'high', 'normal', 'low'];

const PRIORITY_COLOR: Record<string, string> = { high: '#fca5a5', normal: '#d1d5db', low: '#9ca3af' };

const defaultFilters: ConsultFilters = { status: '', priority: '', q: '' };

export default function NutritionConsultsPage() {
  const { can } = useNutritionPermissions();
  const canResolve = can(NUTRITION_PERMS.consult);

  const [filters, setFilters] = useState<ConsultFilters>(defaultFilters);
  const [rows, setRows] = useState<NutritionistConsult[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // resolve/close note keyed by consult id (local input state)
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listConsults(filters));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, next: ConsultStatus, label: string) => {
    setBusyId(id);
    setError('');
    setMessage('');
    try {
      await transitionConsult(id, next, notes[id]);
      setMessage(`${label} succeeded for ${id}.`);
      setNotes((n) => ({ ...n, [id]: '' }));
      await load();
    } catch (e) {
      setError(`${label} failed: ${String(e)}`);
    } finally {
      setBusyId('');
    }
  };

  const onResolve = (id: string) => {
    if (!notes[id]?.trim()) {
      setError('A resolution note is required to resolve a consult.');
      return;
    }
    if (!confirm('Resolve this consult? The resolution note will be recorded.')) return;
    void act(id, 'RESOLVED', 'Resolve');
  };
  const onClose = (id: string) => {
    if (!confirm('Close this consult without resolution?')) return;
    void act(id, 'CLOSED', 'Close');
  };
  const onReview = (id: string) => void act(id, 'UNDER_REVIEW', 'Take under review');
  const onEscalate = (id: string) => void act(id, 'ESCALATED', 'Escalate');

  const pending = rows.filter((r) => r.status === 'PENDING_REVIEW').length;

  return (
    <div>
      <p><Link href="/admin/nutrition">← Back to Nutrition console</Link></p>
      <h1>Nutritionist Consult Review</h1>
      <p style={{ fontSize: 13, opacity: 0.7 }}>
        Review nutritionist consults awaiting admin/clinical sign-off. Resolve with a note,
        close, or escalate. Writes are role-gated (nutrition.admin.resolve) and audited server-side.
      </p>
      <p style={{ fontSize: 12, color: '#fde68a', ...card, background: '#1a1400', borderColor: '#78350f' }}>
        ⚠ Mock surface — the Go nutrition module exposes only the food catalog + resolution engine.
        No consult backend exists yet; this queue runs on fixtures until
        /api/nutrition/admin/consults is delivered.
      </p>

      {message ? <p style={{ color: 'lightgreen' }}>{message}</p> : null}
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} style={input}>
          {STATUS_OPTIONS.map((v) => <option key={v} value={v}>{v ? v.replace(/_/g, ' ') : 'All statuses'}</option>)}
        </select>
        <select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))} style={input}>
          {PRIORITY_OPTIONS.map((v) => <option key={v} value={v}>{v ? `${v} priority` : 'Any priority'}</option>)}
        </select>
        <input placeholder="Search client / nutritionist / topic…" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} style={input} />
        <button onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</button>
        <button onClick={() => setFilters(defaultFilters)} disabled={loading}>Reset</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{rows.length} consult(s) · {pending} pending</span>
      </div>

      {!loading && rows.length === 0 ? (
        <p style={{ opacity: 0.6, marginTop: 24 }}>No consults match the current filters.</p>
      ) : null}

      {rows.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
              {['Client', 'Nutritionist', 'Topic', 'Channel', 'Priority', 'Status', 'Age', 'Actions'].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const terminal = r.status === 'RESOLVED' || r.status === 'CLOSED';
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #1c1c1c', verticalAlign: 'top' }}>
                  <td style={td}>
                    <strong>{r.clientName}</strong>
                    <div style={{ fontSize: 11, opacity: 0.5, fontFamily: 'monospace' }}>{r.id}</div>
                  </td>
                  <td style={td}>{r.nutritionistName}</td>
                  <td style={{ ...td, maxWidth: 240 }}>
                    {r.topic}
                    <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{r.summary}</div>
                    {r.resolutionNote ? (
                      <div style={{ fontSize: 11, color: '#a7f3d0', marginTop: 4 }}>Resolution: {r.resolutionNote}</div>
                    ) : null}
                  </td>
                  <td style={{ ...td, textTransform: 'capitalize' }}>{r.channel}</td>
                  <td style={{ ...td, color: PRIORITY_COLOR[r.priority], textTransform: 'capitalize' }}>{r.priority}</td>
                  <td style={td}><ConsultStatusBadge status={r.status} /></td>
                  <td style={{ ...td, opacity: 0.6 }}>{ageFromNow(r.createdAt)}</td>
                  <td style={{ ...td, minWidth: 220 }}>
                    {terminal ? (
                      <span style={{ fontSize: 11, opacity: 0.5 }}>Closed {ageFromNow(r.resolvedAt)} ago</span>
                    ) : (
                      <div style={{ display: 'grid', gap: 6 }}>
                        <textarea
                          value={notes[r.id] ?? ''}
                          onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                          placeholder="Resolution note (required to resolve)"
                          rows={2}
                          style={{ ...input, width: '100%' }}
                          disabled={!canResolve}
                        />
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button onClick={() => onResolve(r.id)} disabled={busyId === r.id || !canResolve} title={!canResolve ? 'Requires nutrition.admin.resolve' : ''}>
                            {busyId === r.id ? '…' : 'Resolve'}
                          </button>
                          <button onClick={() => onClose(r.id)} disabled={busyId === r.id || !canResolve}>Close</button>
                          {r.status === 'PENDING_REVIEW' ? (
                            <button onClick={() => onReview(r.id)} disabled={busyId === r.id || !canResolve}>Review</button>
                          ) : null}
                          {r.status !== 'ESCALATED' ? (
                            <button onClick={() => onEscalate(r.id)} disabled={busyId === r.id || !canResolve}>Escalate</button>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
