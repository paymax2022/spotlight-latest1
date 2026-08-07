'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ConsultFilters, ConsultStatus, NutritionistConsult } from '@/types/nutritionAdmin';
import { listConsults, transitionConsult, ageFromNow } from '@/services/nutritionAdminService';
import { ConsultStatusBadge } from '../statusBadge';
import { useNutritionPermissions, NUTRITION_PERMS } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_OPTIONS = ['', 'PENDING_REVIEW', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED', 'ESCALATED'];
const PRIORITY_OPTIONS = ['', 'high', 'normal', 'low'];

const PRIORITY_COLOR: Record<string, string> = { high: colors.danger, normal: colors.text, low: colors.muted };

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
    <Page>
      <p><Link href="/admin/nutrition">← Back to Nutrition console</Link></p>
      <PageHeader
        title="Nutritionist Consult Review"
        subtitle="Review nutritionist consults awaiting admin/clinical sign-off. Resolve with a note, close, or escalate. Writes are role-gated (nutrition.admin.resolve) and audited server-side."
      />
      <Card style={{ fontSize: 12, color: colors.warning, background: tint(colors.warning, 0.08), borderColor: colors.warning, marginBottom: 12 }}>
        ⚠ Mock surface — the Go nutrition module exposes only the food catalog + resolution engine.
        No consult backend exists yet; this queue runs on fixtures until
        /api/nutrition/admin/consults is delivered.
      </Card>

      {message ? <p style={{ color: colors.success }}>{message}</p> : null}
      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          {STATUS_OPTIONS.map((v) => <option key={v} value={v}>{v ? v.replace(/_/g, ' ') : 'All statuses'}</option>)}
        </select>
        <select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}>
          {PRIORITY_OPTIONS.map((v) => <option key={v} value={v}>{v ? `${v} priority` : 'Any priority'}</option>)}
        </select>
        <Input placeholder="Search client / nutritionist / topic…" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
        <Button variant="outline" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</Button>
        <Button variant="outline" onClick={() => setFilters(defaultFilters)} disabled={loading}>Reset</Button>
        <span style={{ fontSize: 12, color: colors.muted }}>{rows.length} consult(s) · {pending} pending</span>
      </div>

      {!loading && rows.length === 0 ? (
        <p style={{ color: colors.muted, marginTop: 24 }}>No consults match the current filters.</p>
      ) : null}

      {rows.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
          <thead>
            <tr>
              {['Client', 'Nutritionist', 'Topic', 'Channel', 'Priority', 'Status', 'Age', 'Actions'].map((h) => (
                <th key={h} style={thCell}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const terminal = r.status === 'RESOLVED' || r.status === 'CLOSED';
              return (
                <tr key={r.id} style={{ verticalAlign: 'top' }}>
                  <td style={tdCell}>
                    <strong>{r.clientName}</strong>
                    <div style={{ fontSize: 11, color: colors.muted, fontFamily: 'monospace' }}>{r.id}</div>
                  </td>
                  <td style={tdCell}>{r.nutritionistName}</td>
                  <td style={{ ...tdCell, maxWidth: 240 }}>
                    {r.topic}
                    <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{r.summary}</div>
                    {r.resolutionNote ? (
                      <div style={{ fontSize: 11, color: colors.success, marginTop: 4 }}>Resolution: {r.resolutionNote}</div>
                    ) : null}
                  </td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{r.channel}</td>
                  <td style={{ ...tdCell, color: PRIORITY_COLOR[r.priority], textTransform: 'capitalize' }}>{r.priority}</td>
                  <td style={tdCell}><ConsultStatusBadge status={r.status} /></td>
                  <td style={{ ...tdCell, color: colors.muted }}>{ageFromNow(r.createdAt)}</td>
                  <td style={{ ...tdCell, minWidth: 220 }}>
                    {terminal ? (
                      <span style={{ fontSize: 11, color: colors.muted }}>Closed {ageFromNow(r.resolvedAt)} ago</span>
                    ) : (
                      <div style={{ display: 'grid', gap: 6 }}>
                        <textarea
                          value={notes[r.id] ?? ''}
                          onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                          placeholder="Resolution note (required to resolve)"
                          rows={2}
                          style={{ width: '100%' }}
                          disabled={!canResolve}
                        />
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Button sm variant="outline" onClick={() => onResolve(r.id)} disabled={busyId === r.id || !canResolve} title={!canResolve ? 'Requires nutrition.admin.resolve' : ''}>
                            {busyId === r.id ? '…' : 'Resolve'}
                          </Button>
                          <Button sm variant="outline" onClick={() => onClose(r.id)} disabled={busyId === r.id || !canResolve}>Close</Button>
                          {r.status === 'PENDING_REVIEW' ? (
                            <Button sm variant="outline" onClick={() => onReview(r.id)} disabled={busyId === r.id || !canResolve}>Review</Button>
                          ) : null}
                          {r.status !== 'ESCALATED' ? (
                            <Button sm variant="outline" onClick={() => onEscalate(r.id)} disabled={busyId === r.id || !canResolve}>Escalate</Button>
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
    </Page>
  );
}
