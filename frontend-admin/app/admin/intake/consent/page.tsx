'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ConsentVersion } from '@/types/intakeAdmin';
import { listConsentVersions, addConsentVersion } from '@/services/intakeAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import { useIntakePermissions, INTAKE_PERMS } from '../_ui';

function Notice({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: tint(colors.info, 0.12), border: `1px solid ${tint(colors.info, 0.3)}`, color: colors.text, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 14, display: 'flex', gap: 8 }}>
      <span aria-hidden>ℹ︎</span>
      <span>{children}</span>
    </div>
  );
}

export default function ConsentPage() {
  const { can } = useIntakePermissions();
  const canManage = can(INTAKE_PERMS.manage);

  const [versions, setVersions] = useState<ConsentVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ConsentVersion>({ consent_key: 'intake_share', version: 1, locale: 'en', body: '', active: true });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const v = await listConsentVersions();
      setVersions(v);
      const max = v.reduce((m, c) => Math.max(m, c.version), 0);
      setForm((f) => ({ ...f, version: max + 1 }));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onAuthor = async () => {
    if (!form.body.trim()) { setError('Consent body is required.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      await addConsentVersion(form);
      setMessage(`Authored consent ${form.consent_key} v${form.version}.`);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(`Author failed: ${String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <Page>
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin/intake" style={{ fontSize: 13, color: colors.primary }}>← Intake console</Link>
      </div>
      <PageHeader
        title="A4 · Consent Versions"
        subtitle="Author and version the consent text patients accept before sharing intake with their assigned doctor. Each patient's accepted version is tracked."
        actions={
          <Button variant="primary" disabled={!canManage} title={!canManage ? 'Requires health.admin.intake' : 'Author a new version'} onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Close' : '+ New version'}
          </Button>
        }
      />
      <Notice>Publishing a new version does not retroactively re-consent patients — it applies to consent accepted going forward.</Notice>

      {message ? <p style={{ color: colors.success }}>{message}</p> : null}
      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      {showForm ? (
        <Card style={{ marginTop: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          <label style={{ fontSize: 12 }}>consent_key<Input style={{ width: '100%' }} value={form.consent_key} onChange={(e) => setForm((f) => ({ ...f, consent_key: e.target.value }))} /></label>
          <label style={{ fontSize: 12 }}>version<Input type="number" min={1} style={{ width: '100%' }} value={form.version} onChange={(e) => setForm((f) => ({ ...f, version: Number(e.target.value) }))} /></label>
          <label style={{ fontSize: 12 }}>locale<Input style={{ width: '100%' }} value={form.locale} onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))} /></label>
          <label style={{ fontSize: 12, gridColumn: 'span 3' }}>body<textarea className="vx-input" style={{ width: '100%', height: 120 }} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} /></label>
          <div style={{ gridColumn: 'span 3' }}>
            <Button variant="primary" disabled={busy || !canManage} onClick={() => void onAuthor()}>{busy ? 'Saving…' : 'Author version'}</Button>
            <span style={{ fontSize: 11, color: colors.muted, marginLeft: 8 }}>New version is published active; prior versions are retained.</span>
          </div>
        </Card>
      ) : null}

      {loading ? <p style={{ color: colors.muted, marginTop: 16 }}>Loading…</p> : (
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Key', 'Version', 'Locale', 'Body', 'Active'].map((h) => <th key={h} style={thCell}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={`${v.consent_key}-${v.version}-${v.locale}`}>
                  <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11 }}>{v.consent_key}</td>
                  <td style={tdCell}>v{v.version}</td>
                  <td style={tdCell}>{v.locale}</td>
                  <td style={{ ...tdCell, maxWidth: 520, color: colors.muted, fontSize: 12 }}>{v.body}</td>
                  <td style={tdCell}><Badge text={v.active ? 'active' : 'inactive'} color={v.active ? colors.success : colors.secondary} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
