'use client';

// A9 — Credential issuance / revocation. RBAC: arena.admin.manage (Competition
// Admin). Issue credentials (only from Merit-derived state), revoke with reason,
// view verification logs. Credentials are independently revocable without
// touching unrelated Paymax capabilities (NDC-7). Audited.

import { useCallback, useEffect, useState } from 'react';
import { listCompetitions, listCredentials, listCredentialVerifyLogs, issueCredential, revokeCredential } from '@/services/arenaAdminService';
import type { Competition, Credential, CredentialVerifyLog, CredentialType } from '@/types/arenaAdmin';
import {
  PageHeader, Card, btn, btnPrimary, btnDisabled, th, td, inputStyle, selectStyle, mono,
  CredentialBadge, timeAgo, Pill, AuditNote, PermissionBanner, ARENA_PERMS, useArenaPermission,
} from '../_ui';

const CREDENTIAL_TYPES: { value: CredentialType; label: string; note: string }[] = [
  { value: 'NAIJA_DRIVER', label: 'Naija Driver (crown)', note: 'issued on CROWNED transition' },
  { value: 'CERTIFIED_SAFE_DRIVER', label: 'Certified Safe Driver', note: 'Play-Along pass threshold' },
];

export default function ArenaCredentialsPage() {
  const { allowed } = useArenaPermission(ARENA_PERMS.admin);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [creds, setCreds] = useState<Credential[]>([]);
  const [logs, setLogs] = useState<CredentialVerifyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [issueUser, setIssueUser] = useState('');
  const [issueType, setIssueType] = useState<CredentialType>('CERTIFIED_SAFE_DRIVER');
  const [busy, setBusy] = useState(false);
  const [revokeReason, setRevokeReason] = useState<Record<string, string>>({});

  useEffect(() => {
    void listCompetitions().then((c) => { setCompetitions(c); if (c[0]) setCompetitionId(c[0].id); }).catch((e) => setError(String(e)));
  }, []);

  const load = useCallback(async () => {
    if (!competitionId) return;
    setLoading(true); setError(null);
    try {
      const [c, l] = await Promise.all([listCredentials(competitionId), listCredentialVerifyLogs(competitionId)]);
      setCreds(c); setLogs(l);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [competitionId]);

  useEffect(() => { void load(); }, [load]);

  const issue = useCallback(async () => {
    if (!issueUser.trim()) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const c = await issueCredential(competitionId, issueUser.trim(), issueType);
      setNotice(`Issued ${issueType} to ${c.user_id} (verifiable_hash ${c.verifiable_hash}).`);
      setIssueUser('');
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, [issueUser, issueType, competitionId, load]);

  const revoke = useCallback(async (cred: Credential) => {
    const reason = (revokeReason[cred.id] ?? '').trim();
    if (!reason) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await revokeCredential(competitionId, cred.id, reason);
      setNotice(`Revoked ${cred.type} ${cred.id}.`);
      setRevokeReason((r) => { const n = { ...r }; delete n[cred.id]; return n; });
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, [revokeReason, competitionId, load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Arena — Credentials (A9)"
        subtitle="Issue (from Merit-derived state) / revoke (reason) / verification logs. Credentials are the durable, verifiable asset — independently revocable (NDC-7). RBAC: arena.admin.manage."
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)} style={selectStyle()}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => void load()} style={btn()}>Refresh</button>
          </div>
        }
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.admin} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {notice && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#166534', marginBottom: '1.25rem' }}>{notice}</div>}

      <Card title="Issue credential">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: '#6b7280' }}>
            User ID
            <input value={issueUser} onChange={(e) => setIssueUser(e.target.value)} placeholder="usr_…" style={{ ...inputStyle(), minWidth: 200 }} disabled={!allowed} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: '#6b7280' }}>
            Type
            <select value={issueType} onChange={(e) => setIssueType(e.target.value as CredentialType)} style={selectStyle()} disabled={!allowed}>
              {CREDENTIAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <button onClick={() => void issue()} style={allowed && issueUser.trim() && !busy ? btnPrimary() : btnDisabled()} disabled={!allowed || !issueUser.trim() || busy}>
            {busy ? 'Issuing…' : 'Issue'}
          </button>
        </div>
        <AuditNote>Issuance is only valid from Merit-derived state — the backend rejects issuing a credential a contestant hasn&apos;t earned. Auto-issuance also fires on qualifying transitions (A5).</AuditNote>
      </Card>

      <Card title="Credential registry">
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading credentials…</p>
        ) : creds.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No credentials issued.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>User</th>
                  <th style={th()}>Type</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Verifiable hash</th>
                  <th style={th()}>Issued</th>
                  <th style={th()}>Revoke</th>
                </tr>
              </thead>
              <tbody>
                {creds.map((c) => (
                  <tr key={c.id}>
                    <td style={{ ...td(), ...mono() }}>{c.user_id}</td>
                    <td style={td()}>{c.type.replace(/_/g, ' ')}</td>
                    <td style={td()}>
                      <CredentialBadge status={c.status} />
                      {c.status === 'REVOKED' && c.revoke_reason ? <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{c.revoke_reason}</div> : null}
                    </td>
                    <td style={{ ...td(), ...mono(), color: '#15803d' }} title={c.verifiable_hash}>{c.verifiable_hash}</td>
                    <td style={td()}>{timeAgo(c.issued_at)}</td>
                    <td style={td()}>
                      {c.status === 'REVOKED' ? (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            value={revokeReason[c.id] ?? ''}
                            onChange={(e) => setRevokeReason((r) => ({ ...r, [c.id]: e.target.value }))}
                            placeholder="Reason"
                            style={{ ...inputStyle(), minWidth: 160 }}
                            disabled={!allowed}
                          />
                          <button
                            onClick={() => void revoke(c)}
                            style={allowed && (revokeReason[c.id] ?? '').trim() && !busy ? btnPrimary('#b91c1c') : btnDisabled()}
                            disabled={!allowed || !(revokeReason[c.id] ?? '').trim() || busy}
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Verification logs">
        {logs.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No verification activity.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Credential</th>
                  <th style={th()}>Verifier</th>
                  <th style={th()}>Result</th>
                  <th style={th()}>When</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td style={{ ...td(), ...mono() }}>{l.credential_id}</td>
                    <td style={td()}>{l.verifier ?? 'public'}</td>
                    <td style={td()}>
                      <Pill fg={l.result === 'valid' ? '#15803d' : l.result === 'revoked' ? '#b91c1c' : '#6b7280'} bg={l.result === 'valid' ? '#dcfce7' : l.result === 'revoked' ? '#fee2e2' : '#f3f4f6'}>{l.result}</Pill>
                    </td>
                    <td style={td()}>{timeAgo(l.verified_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
