'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminUsersRequestError } from '@/services/usersService';
import { approveKycCase, getUserKyc, rejectKycCase } from '@/services/userFinanceService';
import { Card, Button, Input, colors } from '@/components/ui/vuexy';

type Kyc = { tier: number; status: string; openCaseId: string | null };

/**
 * KYC panel for the admin user profile. Decision buttons are gated on an open
 * case only; the backend enforces finance.admin.kyc and failures show inline.
 */
export function KycPanel({ userId }: { userId: string }) {
  const [kyc, setKyc] = useState<Kyc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      setKyc(await getUserKyc(userId));
    } catch (err) {
      if (err instanceof AdminUsersRequestError && err.status === 403) {
        setForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : 'Loading KYC failed.');
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (label: 'Approve' | 'Reject', run: () => Promise<boolean>) => {
    setBusy(true);
    setActionError(null);
    try {
      if (await run()) {
        setRejecting(false);
        setReason('');
        await load();
      } else {
        setActionError(`${label} failed`);
      }
    } catch {
      setActionError(`${label} failed`);
    } finally {
      setBusy(false);
    }
  };

  const caseId = kyc?.openCaseId ?? null;

  let body;
  if (loading) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>Loading KYC…</p>;
  } else if (forbidden) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>You don&apos;t have permission to view this.</p>;
  } else if (error) {
    body = (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{error}</p>
        <Button variant="outline" sm onClick={() => void load()}>Retry</Button>
      </div>
    );
  } else if (kyc) {
    body = (
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 13, color: colors.muted, display: 'flex', gap: 16 }}>
          <span>Tier <strong data-testid="kyc-tier" style={{ color: colors.text }}>{kyc.tier}</strong></span>
          <span>Status <strong data-testid="kyc-status" style={{ color: colors.text }}>{kyc.status}</strong></span>
        </div>
        {caseId ? (
          <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" sm disabled={busy} onClick={() => void decide('Approve', () => approveKycCase(caseId))}>Approve</Button>
              <Button variant="danger" sm disabled={busy} onClick={() => setRejecting(true)}>Reject</Button>
            </div>
            {rejecting ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Input aria-label="Rejection reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button
                  variant="danger"
                  sm
                  disabled={busy}
                  onClick={() => {
                    const r = reason.trim();
                    if (!r) {
                      setActionError('A rejection reason is required');
                      return;
                    }
                    void decide('Reject', () => rejectKycCase(caseId, r));
                  }}
                >
                  Confirm reject
                </Button>
              </div>
            ) : null}
            {actionError ? <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{actionError}</p> : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div data-testid="kyc-panel">
      <Card title="KYC">
        <div style={{ marginTop: 8 }}>{body}</div>
      </Card>
    </div>
  );
}
