'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { VocabEntry, VocabKind } from '@/types/intakeAdmin';
import { listVocab, addVocab } from '@/services/intakeAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import { useIntakePermissions, INTAKE_PERMS } from '../_ui';

const KINDS: { kind: VocabKind; label: string }[] = [
  { kind: 'condition', label: 'Chronic conditions' },
  { kind: 'allergen', label: 'Allergens' },
  { kind: 'medication', label: 'Medications' },
];

function Notice({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: tint(colors.info, 0.12), border: `1px solid ${tint(colors.info, 0.3)}`, color: colors.text, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 14, display: 'flex', gap: 8 }}>
      <span aria-hidden>ℹ︎</span>
      <span>{children}</span>
    </div>
  );
}

export default function VocabPage() {
  const { can } = useIntakePermissions();
  const canManage = can(INTAKE_PERMS.manage);

  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<VocabEntry>({ kind: 'condition', code: '', label: '', active: true });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setEntries(await listVocab());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onAdd = async () => {
    if (!form.code.trim() || !form.label.trim()) { setError('code and label are required.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      await addVocab(form);
      setMessage(`Added ${form.kind} ${form.code}.`);
      setForm((f) => ({ ...f, code: '', label: '' }));
      await load();
    } catch (e) {
      setError(`Add failed: ${String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <Page>
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin/intake" style={{ fontSize: 13, color: colors.primary }}>← Intake console</Link>
      </div>
      <PageHeader title="A3 · Clinical Vocabularies" subtitle="Maintain the condition list, allergen vocabulary, and medication lookup source used by the intake multi-selects." />
      <Notice>Allergens are safety-critical (§5) — keep the list accurate; the intake surfaces these prominently to the doctor.</Notice>

      {message ? <p style={{ color: colors.success }}>{message}</p> : null}
      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      <Card style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12 }}>kind
          <select className="vx-input" style={{ width: 160, display: 'block' }} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as VocabKind }))}>
            {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>code<Input style={{ display: 'block' }} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} /></label>
        <label style={{ fontSize: 12 }}>label<Input style={{ display: 'block', width: 220 }} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} /></label>
        <Button variant="primary" disabled={busy || !canManage} title={!canManage ? 'Requires health.admin.intake' : 'Add entry'} onClick={() => void onAdd()}>{busy ? '…' : '+ Add'}</Button>
      </Card>

      {loading ? <p style={{ color: colors.muted, marginTop: 16 }}>Loading…</p> : KINDS.map(({ kind, label }) => {
        const rows = entries.filter((e) => e.kind === kind);
        return (
          <section key={kind} style={{ marginTop: 22 }}>
            <p style={{ fontSize: 12, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label} ({rows.length})</p>
            {rows.length === 0 ? <p style={{ color: colors.muted }}>No entries.</p> : (
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Code', 'Label', 'Active'].map((h) => <th key={h} style={thCell}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.code}>
                        <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11 }}>{r.code}</td>
                        <td style={tdCell}>{r.label}</td>
                        <td style={tdCell}><Badge text={r.active ? 'active' : 'inactive'} color={r.active ? colors.success : colors.secondary} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </section>
        );
      })}
    </Page>
  );
}
