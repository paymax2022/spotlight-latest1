'use client';

import { useEffect, useState } from 'react';
import {
  listCredentialTemplates, createCredentialTemplate, listIssuedCredentials, revokeCredential,
  verifyCredential, listEarningOpportunities, createEarningOpportunity, listEarningApplications,
} from '@/services/academyAdminService';
import type {
  CredentialTemplate, IssuedCredential, CredentialVerification,
  EarningOpportunity, EarningApplication,
} from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, Kpi, StateBlock, AuditNote, DisclosureNote, FilterBar, btn, btnPrimary, btnDanger, th, td, input, label, select, fmtDate, timeAgo } from '../_ui';

export default function CredentialsPage() {
  const [templates, setTemplates] = useState<CredentialTemplate[]>([]);
  const [issued, setIssued] = useState<IssuedCredential[]>([]);
  const [opps, setOpps] = useState<EarningOpportunity[]>([]);
  const [apps, setApps] = useState<EarningApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [tplForm, setTplForm] = useState({ name: '', track: 'trade', issuer: 'Spotlight Academy', validity: '', authority: '' });
  const [oppForm, setOppForm] = useState({ title: '', trade_track: '', paymax_role: '', rule: '', min: 'active' });
  const [verifyQ, setVerifyQ] = useState('');
  const [verifyResult, setVerifyResult] = useState<CredentialVerification | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [t, i, o, a] = await Promise.all([listCredentialTemplates(), listIssuedCredentials(), listEarningOpportunities(), listEarningApplications()]);
      setTemplates(t); setIssued(i); setOpps(o); setApps(a);
      if (t[0] && !oppForm.trade_track) setOppForm((x) => ({ ...x, trade_track: t.find((tt) => tt.track === 'trade')?.name ?? t[0].name }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function addTemplate() {
    if (!tplForm.name || !tplForm.authority) { setNotice('Template name and signature authority are required.'); return; }
    setBusy('tpl'); setNotice(null);
    try {
      const t = await createCredentialTemplate({ name: tplForm.name, track: tplForm.track as CredentialTemplate['track'], issuer: tplForm.issuer, validity_months: tplForm.validity ? Number(tplForm.validity) : null, signature_authority: tplForm.authority });
      setNotice(`Created template "${t.name}" (draft).`);
      setTplForm({ name: '', track: 'trade', issuer: 'Spotlight Academy', validity: '', authority: '' });
      await load();
    } catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  async function revoke(c: IssuedCredential) {
    const reason = typeof window !== 'undefined' ? window.prompt(`Reason for revoking ${c.serial}?`, '') : '';
    if (!reason) { setNotice('A revocation reason is required.'); return; }
    setBusy(c.id); setNotice(null);
    try { const u = await revokeCredential({ id: c.id, reason }); setNotice(`Revoked ${u.serial}.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  async function runVerify() {
    if (!verifyQ.trim()) { setNotice('Enter a serial or learner ID to verify.'); return; }
    setBusy('verify'); setNotice(null);
    try { setVerifyResult(await verifyCredential(verifyQ)); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  async function addOpportunity() {
    if (!oppForm.title || !oppForm.trade_track || !oppForm.paymax_role || !oppForm.rule) { setNotice('Title, trade track, Paymax role and eligibility rule are required.'); return; }
    setBusy('opp'); setNotice(null);
    try {
      const o = await createEarningOpportunity({ title: oppForm.title, trade_track: oppForm.trade_track, paymax_role: oppForm.paymax_role, eligibility_rule: oppForm.rule, min_credential_status: oppForm.min as EarningOpportunity['min_credential_status'] });
      setNotice(`Created earning opportunity "${o.title}".`);
      setOppForm({ ...oppForm, title: '', paymax_role: '', rule: '' });
      await load();
    } catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  const activeTemplates = templates.filter((t) => t.status === 'active').length;
  const liveCredentials = issued.filter((c) => c.status === 'issued').length;
  const revoked = issued.filter((c) => c.status === 'revoked').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Credentials & earning bridge" subtitle="Certificate templates, issuance registry, verification lookup and revocation; trade-credential → Paymax earning-role mapping with eligibility rules and applicant routing." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="credentials" />
      <DisclosureNote>
        Requires <code>academy.credentials</code>. A <strong>trade-track credential</strong> maps to a Paymax earning role; learners apply, are checked against the eligibility rule, and routed onto the Paymax rail once eligible. Issuance &amp; revocation are recorded to the immutable audit log.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Active templates" value={activeTemplates.toString()} sub={`${templates.length} total`} accent="#340075" />
          <Kpi label="Live credentials" value={liveCredentials.toLocaleString('en-NG')} accent="#15803d" />
          <Kpi label="Revoked" value={revoked.toString()} accent={revoked > 0 ? '#b91c1c' : undefined} />
          <Kpi label="Earning opportunities" value={opps.filter((o) => o.status === 'open').length.toString()} sub={`${apps.length} applications`} />
        </div>

        <Card title="Verification registry">
          <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 0 }}>Look up a credential by serial number or learner ID to verify authenticity and status.</p>
          <FilterBar>
            <div style={{ flex: 1, minWidth: 220 }}><label style={label()}>Serial / Learner ID</label><input style={input()} value={verifyQ} onChange={(e) => setVerifyQ(e.target.value)} placeholder="SPL-SOLAR-2026-00112" /></div>
            <button onClick={runVerify} disabled={busy === 'verify'} style={btnPrimary()}>Verify</button>
          </FilterBar>
          {verifyResult && (
            verifyResult.found && verifyResult.credential ? (
              <div style={{ border: '1px solid #dcfce7', background: '#f0fdf4', borderRadius: '0.5rem', padding: '0.75rem 0.9rem', fontSize: '0.85rem' }}>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '0.4rem' }}><strong>Verified</strong><Badge status={verifyResult.credential.status} /></div>
                <div><strong>{verifyResult.credential.template_name}</strong> · {verifyResult.credential.learner_name} ({verifyResult.credential.learner_id})</div>
                <div style={{ color: '#6b7280' }}>Serial <code>{verifyResult.credential.serial}</code> · issued {fmtDate(verifyResult.credential.issued_at)} · expires {verifyResult.credential.expires_at ? fmtDate(verifyResult.credential.expires_at) : 'never'}</div>
                {verifyResult.credential.revoke_reason ? <div style={{ color: '#b91c1c', marginTop: '0.3rem' }}>Revoked: {verifyResult.credential.revoke_reason}</div> : null}
              </div>
            ) : (
              <div style={{ border: '1px solid #fee2e2', background: '#fef2f2', borderRadius: '0.5rem', padding: '0.75rem 0.9rem', fontSize: '0.85rem', color: '#b91c1c' }}>No credential found for &ldquo;{verifyResult.serial}&rdquo;.</div>
            )
          )}
        </Card>

        <Card title="Credential templates">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Template</th><th style={th()}>Track</th><th style={th()}>Issuer</th><th style={th()}>Validity</th><th style={th()}>Signature authority</th><th style={th()}>Issued</th><th style={th()}>Status</th></tr></thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td style={td()}><strong>{t.name}</strong></td>
                  <td style={td()}><Badge status={t.track === 'trade' ? 'core' : t.track === 'professional' ? 'open' : 'archived'} label={t.track} /></td>
                  <td style={td()}>{t.issuer}</td>
                  <td style={td()}>{t.validity_months === null ? 'Lifetime' : `${t.validity_months} mo`}</td>
                  <td style={td()}>{t.signature_authority}</td>
                  <td style={td()}>{t.issued_count.toLocaleString('en-NG')}</td>
                  <td style={td()}><Badge status={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
            <div><label style={label()}>Name</label><input style={input()} value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} /></div>
            <div><label style={label()}>Track</label><select style={select()} value={tplForm.track} onChange={(e) => setTplForm({ ...tplForm, track: e.target.value })}><option value="academic">academic</option><option value="trade">trade</option><option value="professional">professional</option></select></div>
            <div><label style={label()}>Issuer</label><input style={input()} value={tplForm.issuer} onChange={(e) => setTplForm({ ...tplForm, issuer: e.target.value })} /></div>
            <div><label style={label()}>Validity (months, blank = lifetime)</label><input type="number" style={input()} value={tplForm.validity} onChange={(e) => setTplForm({ ...tplForm, validity: e.target.value })} /></div>
            <div><label style={label()}>Signature authority</label><input style={input()} value={tplForm.authority} onChange={(e) => setTplForm({ ...tplForm, authority: e.target.value })} /></div>
            <div><button onClick={addTemplate} disabled={busy === 'tpl'} style={btnPrimary()}>Create template</button></div>
          </div>
        </Card>

        <Card title="Issued credentials">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Serial</th><th style={th()}>Credential</th><th style={th()}>Learner</th><th style={th()}>Issued</th><th style={th()}>Expires</th><th style={th()}>Status</th><th style={th()}>Action</th></tr></thead>
            <tbody>
              {issued.map((c) => (
                <tr key={c.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{c.serial}</code></td>
                  <td style={td()}>{c.template_name}</td>
                  <td style={td()}>{c.learner_name}<div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{c.learner_id}</div></td>
                  <td style={td()}>{fmtDate(c.issued_at)}</td>
                  <td style={td()}>{c.expires_at ? fmtDate(c.expires_at) : '—'}</td>
                  <td style={td()}><Badge status={c.status} />{c.revoke_reason ? <div style={{ color: '#b91c1c', fontSize: '0.72rem', marginTop: '0.2rem' }}>{c.revoke_reason}</div> : null}</td>
                  <td style={td()}>{c.status === 'issued' ? <button onClick={() => revoke(c)} disabled={busy === c.id} style={btnDanger()}>Revoke</button> : <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Earning opportunities (trade credential → Paymax role)">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Opportunity</th><th style={th()}>Required track</th><th style={th()}>Paymax role</th><th style={th()}>Eligibility rule</th><th style={th()}>Applicants</th><th style={th()}>Routed</th><th style={th()}>Status</th></tr></thead>
            <tbody>
              {opps.map((o) => (
                <tr key={o.id}>
                  <td style={td()}><strong>{o.title}</strong></td>
                  <td style={td()}>{o.trade_track}</td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{o.paymax_role}</code></td>
                  <td style={td()}>{o.eligibility_rule}<div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>min: {o.min_credential_status}</div></td>
                  <td style={td()}>{o.applicants}</td>
                  <td style={td()}>{o.routed}</td>
                  <td style={td()}><Badge status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
            <div><label style={label()}>Title</label><input style={input()} value={oppForm.title} onChange={(e) => setOppForm({ ...oppForm, title: e.target.value })} /></div>
            <div><label style={label()}>Required trade track</label><select style={select()} value={oppForm.trade_track} onChange={(e) => setOppForm({ ...oppForm, trade_track: e.target.value })}>{templates.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</select></div>
            <div><label style={label()}>Paymax role</label><input style={input()} value={oppForm.paymax_role} onChange={(e) => setOppForm({ ...oppForm, paymax_role: e.target.value })} placeholder="field_agent" /></div>
            <div><label style={label()}>Eligibility rule</label><input style={input()} value={oppForm.rule} onChange={(e) => setOppForm({ ...oppForm, rule: e.target.value })} placeholder="Active credential + Tier-2 KYC" /></div>
            <div><label style={label()}>Min credential status</label><select style={select()} value={oppForm.min} onChange={(e) => setOppForm({ ...oppForm, min: e.target.value })}><option value="issued">issued</option><option value="active">active</option></select></div>
            <div><button onClick={addOpportunity} disabled={busy === 'opp'} style={btnPrimary()}>Create opportunity</button></div>
          </div>
          {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Template creation, issuance, revocation, earning-opportunity mapping and applicant routing are recorded to the immutable audit log.</AuditNote>
        </Card>

        <Card title="Earning applications (submitted / routed)">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Learner</th><th style={th()}>Opportunity</th><th style={th()}>Credential serial</th><th style={th()}>Status</th><th style={th()}>Submitted</th></tr></thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id}>
                  <td style={td()}>{a.learner_name}<div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{a.learner_id}</div></td>
                  <td style={td()}>{a.opportunity_title}</td>
                  <td style={td()}>{a.credential_serial ? <code style={{ fontSize: '0.78rem' }}>{a.credential_serial}</code> : <span style={{ color: '#9ca3af' }}>none</span>}</td>
                  <td style={td()}><Badge status={a.status} /></td>
                  <td style={td()}>{timeAgo(a.submitted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </div>
  );
}
