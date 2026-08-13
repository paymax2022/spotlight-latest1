'use client';

// 9.B.3 — Due-diligence & title verification (role: fractionalre.title_verify).
// Checklist, registry check, decision (clear/query/reject), title-verified toggle.
// SoD: independent of the Asset Manager.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getTitleVerification, titleVerify } from '@/services/fractionalreAdminService';
import type { TitleCheckDecision, TitleCheckItem, TitleVerification } from '@/types/fractionalreAdmin';
import { FractionalReTabs, SodNote } from '../../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors } from '@/components/ui/vuexy';

const labelStyle = { fontSize: '0.78rem', fontWeight: 600, color: colors.text, display: 'block', marginBottom: 4 } as const;

export default function TitleVerificationPage() {
  const { id } = useParams<{ id: string }>() ?? { id: '' };
  const [tv, setTv] = useState<TitleVerification | null>(null);
  const [checklist, setChecklist] = useState<TitleCheckItem[]>([]);
  const [registryRef, setRegistryRef] = useState('');
  const [decision, setDecision] = useState<TitleCheckDecision | ''>('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const t = await getTitleVerification(id);
      setTv(t); setChecklist(t.checklist); setRegistryRef(t.registryCheckRef ?? ''); setDecision(t.decision ?? '');
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id]);

  const toggle = (i: number) => setChecklist((c) => c.map((x, idx) => idx === i ? { ...x, passed: !x.passed } : x));
  const setItemNote = (i: number, v: string) => setChecklist((c) => c.map((x, idx) => idx === i ? { ...x, note: v } : x));

  async function submit() {
    if (!decision) return;
    setSaving(true); setError(null);
    try {
      const res = await titleVerify(id, { checklist, registryCheckRef: registryRef || undefined, decision, note: note || undefined });
      setTv(res); setDone(true);
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  }

  const titleVerified = decision === 'clear';

  return (
    <Page>
      <PageHeader title="Title verification" subtitle="Independent legal/title due diligence." actions={<Link href={`/admin/fractionalre/assets/${id}`}><Button>← Asset</Button></Link>} />
      <FractionalReTabs active="assets" />
      <SodNote>This screen is restricted to the <strong>Title Verifier</strong> role (fractionalre.title_verify) and must be performed independently of the Asset Manager who onboarded the asset.</SodNote>
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {done && <p style={{ color: colors.success }}>Decision recorded: <strong>{decision}</strong>. Title-verified badge {titleVerified ? 'enabled' : 'left off'}.</p>}

      {loading || !tv ? <p style={{ color: colors.muted }}>Loading checklist…</p> : (
        <>
          <Card title="Due-diligence checklist">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {checklist.map((c, i) => (
                  <tr key={c.key}>
                    <td style={{ padding: '0.5rem 0.5rem', borderTop: `1px solid ${colors.border}`, width: 36 }}>
                      <input type="checkbox" checked={c.passed} onChange={() => toggle(i)} />
                    </td>
                    <td style={{ padding: '0.5rem 0.5rem', borderTop: `1px solid ${colors.border}`, fontSize: '0.85rem', fontWeight: 600 }}>{c.label}</td>
                    <td style={{ padding: '0.5rem 0.5rem', borderTop: `1px solid ${colors.border}` }}>
                      <Input placeholder="Evidence / note" value={c.note ?? ''} onChange={(e) => setItemNote(i, e.target.value)} style={{ maxWidth: 360 }} />
                    </td>
                    <td style={{ padding: '0.5rem 0.5rem', borderTop: `1px solid ${colors.border}` }}>{c.passed ? <Badge text="ok" color={colors.success} /> : <Badge text="pending" color={colors.warning} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Registry / geospatial check">
            <div style={{ maxWidth: 480 }}>
              <label style={labelStyle}>Registry check reference</label>
              <Input value={registryRef} onChange={(e) => setRegistryRef(e.target.value)} placeholder="REG-…" />
            </div>
          </Card>

          <Card title="Decision">
            <div style={{ display: 'grid', gap: '0.8rem', maxWidth: 480 }}>
              <div>
                <label style={labelStyle}>Outcome</label>
                <select value={decision} onChange={(e) => setDecision(e.target.value as TitleCheckDecision)} className="vx-input">
                  <option value="">Select…</option>
                  <option value="clear">Clear — set title-verified badge</option>
                  <option value="query">Query — needs more evidence</option>
                  <option value="reject">Reject</option>
                </select>
              </div>
              <div><label style={labelStyle}>Note (logged)</label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Title-verified badge:</span>
                <Badge text={titleVerified ? 'will enable' : 'off'} color={titleVerified ? colors.success : colors.warning} />
              </div>
              <Button variant={decision === 'reject' ? 'danger' : 'primary'} onClick={submit} disabled={!decision || saving}>{saving ? 'Recording…' : 'Record decision'}</Button>
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}
