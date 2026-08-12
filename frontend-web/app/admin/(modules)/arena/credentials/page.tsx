'use client';

// A9 — Credential issuance / revocation. RBAC: arena.admin.manage (Competition
// Admin). Issue credentials (only from Merit-derived state), revoke with reason,
// view verification logs. Credentials are independently revocable without
// touching unrelated Paymax capabilities (NDC-7). Audited.

import { useCallback, useEffect, useState } from 'react';
import { listCompetitions, listCredentials, listCredentialVerifyLogs, issueCredential, revokeCredential } from '@/services/arenaAdminService';
import type { Competition, Credential, CredentialVerifyLog, CredentialType } from '@/types/arenaAdmin';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import {
  mono, CredentialBadge, timeAgo, AuditNote, PermissionBanner, ARENA_PERMS, useArenaPermission,
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
    <Page>
      <PageHeader
        title="Arena — Credentials (A9)"
        subtitle="Issue (from Merit-derived state) / revoke (reason) / verification logs. Credentials are the durable, verifiable asset — independently revocable (NDC-7). RBAC: arena.admin.manage."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button variant="outline" onClick={() => void load()}>Refresh</Button>
          </div>
        }
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.admin} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {notice && <div style={{ background: tint(colors.success, 0.12), border: `1px solid ${tint(colors.success, 0.35)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.success, marginBottom: '1.25rem' }}>{notice}</div>}

      <Card title="Issue credential" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 14 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: colors.muted }}>
            User ID
            <Input value={issueUser} onChange={(e) => setIssueUser(e.target.value)} placeholder="usr_…" style={{ minWidth: 200 }} disabled={!allowed} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: colors.muted }}>
            Type
            <select value={issueType} onChange={(e) => setIssueType(e.target.value as CredentialType)} disabled={!allowed}>
              {CREDENTIAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <Button variant="primary" onClick={() => void issue()} disabled={!allowed || !issueUser.trim() || busy}>
            {busy ? 'Issuing…' : 'Issue'}
          </Button>
        </div>
        <AuditNote>Issuance is only valid from Merit-derived state — the backend rejects issuing a credential a contestant hasn&apos;t earned. Auto-issuance also fires on qualifying transitions (A5).</AuditNote>
      </Card>

      <Card title="Credential registry" style={{ marginBottom: 20 }}>
        {loading ? (
          <p style={{ color: colors.muted }}>Loading credentials…</p>
        ) : creds.length === 0 ? (
          <p style={{ color: colors.muted }}>No credentials issued.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>User</th>
                  <th style={thCell}>Type</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Verifiable hash</th>
                  <th style={thCell}>Issued</th>
                  <th style={thCell}>Revoke</th>
                </tr>
              </thead>
              <tbody>
                {creds.map((c) => (
                  <tr key={c.id}>
                    <td style={{ ...tdCell, ...mono() }}>{c.user_id}</td>
                    <td style={tdCell}>{c.type.replace(/_/g, ' ')}</td>
                    <td style={tdCell}>
                      <CredentialBadge status={c.status} />
                      {c.status === 'REVOKED' && c.revoke_reason ? <div style={{ fontSize: '0.72rem', color: colors.muted }}>{c.revoke_reason}</div> : null}
                    </td>
                    <td style={{ ...tdCell, ...mono(), color: colors.success }} title={c.verifiable_hash}>{c.verifiable_hash}</td>
                    <td style={tdCell}>{timeAgo(c.issued_at)}</td>
                    <td style={tdCell}>
                      {c.status === 'REVOKED' ? (
                        <span style={{ color: colors.muted }}>—</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <Input
                            value={revokeReason[c.id] ?? ''}
                            onChange={(e) => setRevokeReason((r) => ({ ...r, [c.id]: e.target.value }))}
                            placeholder="Reason"
                            style={{ minWidth: 160 }}
                            disabled={!allowed}
                          />
                          <Button
                            variant="danger"
                            onClick={() => void revoke(c)}
                            disabled={!allowed || !(revokeReason[c.id] ?? '').trim() || busy}
                          >
                            Revoke
                          </Button>
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
          <p style={{ color: colors.muted }}>No verification activity.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Credential</th>
                  <th style={thCell}>Verifier</th>
                  <th style={thCell}>Result</th>
                  <th style={thCell}>When</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td style={{ ...tdCell, ...mono() }}>{l.credential_id}</td>
                    <td style={tdCell}>{l.verifier ?? 'public'}</td>
                    <td style={tdCell}>
                      <Badge text={l.result} color={l.result === 'valid' ? colors.success : l.result === 'revoked' ? colors.danger : colors.secondary} />
                    </td>
                    <td style={tdCell}>{timeAgo(l.verified_at)}</td>
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
