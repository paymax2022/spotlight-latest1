'use client';

/**
 * Stages & Evictions — reality-show season list (admin consolidation slice 4;
 * see docs/adr/ADR-047-admin-console-consolidation-path-a.md and
 * realityShowAdminService.ts for the data-path notes).
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  listSeasons,
  createSeason,
  type ShowSeason,
} from '@/services/realityShowAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_BADGE: Record<string, string> = {
  draft: colors.muted,
  active: colors.success,
  completed: colors.secondary,
};

const inputStyle: CSSProperties = { width: '100%' };
const labelStyle: CSSProperties = { display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 };
const fieldStyle: CSSProperties = { marginBottom: 12 };

export default function StagesEvictionsAdminPage() {
  const [seasons, setSeasons] = useState<ShowSeason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    seasonName: '', seasonNumber: '1', contestSlug: 'reality-tv-show', notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSeasons(await listSeasons());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load seasons');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submit = useCallback(async () => {
    if (!form.seasonName.trim()) { setFormError('Season name is required'); return; }
    setSaving(true);
    setFormError(null);
    try {
      await createSeason({
        seasonName: form.seasonName.trim(),
        seasonNumber: Number(form.seasonNumber) || 1,
        contestSlug: form.contestSlug.trim() || 'reality-tv-show',
        notes: form.notes.trim() || undefined,
      });
      setForm({ seasonName: '', seasonNumber: '1', contestSlug: 'reality-tv-show', notes: '' });
      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create season');
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  return (
    <Page>
      <PageHeader
        title="Stages & Evictions"
        subtitle="Reality-show seasons, bootcamp contestants and weekly eviction voting. Served from the web app over the admin web proxy."
        actions={
          <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New season'}
          </Button>
        }
      />

      {showForm && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Season name</label>
              <Input style={inputStyle} value={form.seasonName}
                onChange={(e) => setForm((f) => ({ ...f, seasonName: e.target.value }))} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Season number</label>
              <Input style={inputStyle} type="number" min={1} value={form.seasonNumber}
                onChange={(e) => setForm((f) => ({ ...f, seasonNumber: e.target.value }))} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Contest slug</label>
              <Input style={inputStyle} value={form.contestSlug}
                onChange={(e) => setForm((f) => ({ ...f, contestSlug: e.target.value }))} />
            </div>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Notes</label>
            <Input style={inputStyle} value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          {formError && <p style={{ color: colors.danger, fontSize: 13, margin: '0 0 12px' }}>{formError}</p>}
          <Button variant="primary" disabled={saving} onClick={() => void submit()}>
            {saving ? 'Creating…' : 'Create season'}
          </Button>
        </Card>
      )}

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card>
        {loading ? (
          <p style={{ color: colors.muted, margin: 0 }}>Loading seasons…</p>
        ) : seasons.length === 0 ? (
          <p style={{ color: colors.muted, margin: 0 }}>No seasons yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Season</th>
                  <th style={thCell}>Contest</th>
                  <th style={thCell}>Phase</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Updated</th>
                  <th style={thCell} />
                </tr>
              </thead>
              <tbody>
                {seasons.map((s) => (
                  <tr key={s.id}>
                    <td style={tdCell}>
                      <strong>{s.seasonName}</strong>
                      <div style={{ fontSize: 12, color: colors.muted }}>Season {s.seasonNumber}</div>
                    </td>
                    <td style={tdCell}>{s.contestSlug}</td>
                    <td style={tdCell}>{s.currentPhase || '—'}</td>
                    <td style={tdCell}><Badge text={s.status} color={STATUS_BADGE[s.status] ?? colors.muted} /></td>
                    <td style={tdCell}>{s.updatedAt ? new Date(s.updatedAt).toLocaleString() : '—'}</td>
                    <td style={tdCell}>
                      <Link href={`/admin/stages-evictions/${s.id}`}>
                        <Button sm>Open</Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
