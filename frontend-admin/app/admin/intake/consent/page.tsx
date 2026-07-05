'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConsentVersion } from '@/types/intakeAdmin';
import { listConsentVersions, addConsentVersion } from '@/services/intakeAdminService';
import { BackLink, PageHeader, Notice, card, th, td, btn, btnPrimary, input, ActiveBadge, useIntakePermissions, INTAKE_PERMS } from '../_ui';

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
    <div>
      <BackLink />
      <PageHeader
        title="A4 · Consent Versions"
        subtitle="Author and version the consent text patients accept before sharing intake with their assigned doctor. Each patient's accepted version is tracked."
        action={
          <button style={canManage ? btnPrimary : { ...btn, opacity: 0.5, cursor: 'not-allowed' }} disabled={!canManage} title={!canManage ? 'Requires health.admin.intake' : 'Author a new version'} onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Close' : '+ New version'}
          </button>
        }
      />
      <Notice kind="info">Publishing a new version does not retroactively re-consent patients — it applies to consent accepted going forward.</Notice>

      {message ? <p style={{ color: 'lightgreen' }}>{message}</p> : null}
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      {showForm ? (
        <div style={{ ...card, marginTop: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          <label style={{ fontSize: 12 }}>consent_key<input style={{ ...input, width: '100%' }} value={form.consent_key} onChange={(e) => setForm((f) => ({ ...f, consent_key: e.target.value }))} /></label>
          <label style={{ fontSize: 12 }}>version<input type="number" min={1} style={{ ...input, width: '100%' }} value={form.version} onChange={(e) => setForm((f) => ({ ...f, version: Number(e.target.value) }))} /></label>
          <label style={{ fontSize: 12 }}>locale<input style={{ ...input, width: '100%' }} value={form.locale} onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))} /></label>
          <label style={{ fontSize: 12, gridColumn: 'span 3' }}>body<textarea style={{ ...input, width: '100%', height: 120 }} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} /></label>
          <div style={{ gridColumn: 'span 3' }}>
            <button style={btnPrimary} disabled={busy || !canManage} onClick={() => void onAuthor()}>{busy ? 'Saving…' : 'Author version'}</button>
            <span style={{ fontSize: 11, opacity: 0.5, marginLeft: 8 }}>New version is published active; prior versions are retained.</span>
          </div>
        </div>
      ) : null}

      {loading ? <p style={{ opacity: 0.6, marginTop: 16 }}>Loading…</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
              {['Key', 'Version', 'Locale', 'Body', 'Active'].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={`${v.consent_key}-${v.version}-${v.locale}`} style={{ borderBottom: '1px solid #1c1c1c' }}>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{v.consent_key}</td>
                <td style={td}>v{v.version}</td>
                <td style={td}>{v.locale}</td>
                <td style={{ ...td, maxWidth: 520, opacity: 0.8, fontSize: 12 }}>{v.body}</td>
                <td style={td}><ActiveBadge active={v.active} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
