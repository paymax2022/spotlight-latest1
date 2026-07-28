'use client';

import { useCallback, useEffect, useState } from 'react';
import type { VocabEntry, VocabKind } from '@/types/intakeAdmin';
import { listVocab, addVocab } from '@/services/intakeAdminService';
import { BackLink, PageHeader, Notice, card, th, td, btn, btnPrimary, input, ActiveBadge, useIntakePermissions, INTAKE_PERMS } from '../_ui';

const KINDS: { kind: VocabKind; label: string }[] = [
  { kind: 'condition', label: 'Chronic conditions' },
  { kind: 'allergen', label: 'Allergens' },
  { kind: 'medication', label: 'Medications' },
];

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
    <div>
      <BackLink />
      <PageHeader title="A3 · Clinical Vocabularies" subtitle="Maintain the condition list, allergen vocabulary, and medication lookup source used by the intake multi-selects." />
      <Notice kind="info">Allergens are safety-critical (§5) — keep the list accurate; the intake surfaces these prominently to the doctor.</Notice>

      {message ? <p style={{ color: 'lightgreen' }}>{message}</p> : null}
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      <div style={{ ...card, marginTop: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12 }}>kind
          <select style={{ ...input, width: 160, display: 'block' }} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as VocabKind }))}>
            {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>code<input style={{ ...input, display: 'block' }} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} /></label>
        <label style={{ fontSize: 12 }}>label<input style={{ ...input, display: 'block', width: 220 }} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} /></label>
        <button style={canManage ? btnPrimary : { ...btn, opacity: 0.5, cursor: 'not-allowed' }} disabled={busy || !canManage} title={!canManage ? 'Requires health.admin.intake' : 'Add entry'} onClick={() => void onAdd()}>{busy ? '…' : '+ Add'}</button>
      </div>

      {loading ? <p style={{ opacity: 0.6, marginTop: 16 }}>Loading…</p> : KINDS.map(({ kind, label }) => {
        const rows = entries.filter((e) => e.kind === kind);
        return (
          <section key={kind} style={{ marginTop: 22 }}>
            <p style={{ fontSize: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label} ({rows.length})</p>
            {rows.length === 0 ? <p style={{ opacity: 0.5 }}>No entries.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
                    {['Code', 'Label', 'Active'].map((h) => <th key={h} style={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code} style={{ borderBottom: '1px solid #1c1c1c' }}>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.code}</td>
                      <td style={td}>{r.label}</td>
                      <td style={td}><ActiveBadge active={r.active} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
