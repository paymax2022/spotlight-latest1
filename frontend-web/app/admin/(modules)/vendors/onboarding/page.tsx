'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { VendorApplication, VendorStatus } from '@/types/vendorsAdmin';
import { listVendorApplications, setVendorStatus, ageFromNow } from '@/services/vendorsAdminService';
import { VendorStatusBadge } from '../statusBadge';
import { useVendorPermissions, VENDOR_PERMS } from '../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

// SLA: applications older than 3 days breach the review SLA (mirrors merchant-onboarding).
function slaBreached(iso: string | null): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() > 3 * 24 * 60 * 60 * 1000;
}

export default function VendorOnboardingQueuePage() {
  const { can } = useVendorPermissions();
  const canManage = can(VENDOR_PERMS.manage);

  const [rows, setRows] = useState<VendorApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listVendorApplications());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (a: VendorApplication, status: VendorStatus, label: string) => {
    if (status === 'verified' && !a.bankProvided) {
      if (!confirm('This applicant has no bank/payout account on file. Approve anyway?')) return;
    } else if (!confirm(`${label} "${a.businessName}" in ${a.estateName}?`)) {
      return;
    }
    setBusyId(a.id);
    setError('');
    setMessage('');
    try {
      await setVendorStatus(a.estateId, a.id, status);
      setMessage(`${label} succeeded for ${a.businessName}.`);
      await load();
    } catch (e) {
      setError(`${label} failed: ${String(e)}`);
    } finally {
      setBusyId('');
    }
  };

  return (
    <Page>
      <p style={{ marginTop: 0 }}><Link href="/admin/vendors" style={{ color: colors.primary }}>← Back to Vendor Directory</Link></p>

      <PageHeader
        title="Vendor Onboarding / Approval"
        subtitle="Review queue for self-onboarded vendors (submitted from the mobile vendor-portal via POST /estate/:id/vendor/onboard). Approve → verified, or reject → suspended. Decisions are role-gated (estate.manage) and audited server-side."
      />

      <Card style={{ background: colors.card, borderColor: colors.warning, marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 12, color: colors.warning }}>
          ⚠ Approval maps onto the per-estate POST /estate/:id/vendors/:vendorId/verify endpoint. Mock
          by default until a cross-estate admin queue exists.
        </p>
      </Card>

      {message ? <p style={{ color: colors.success }}>{message}</p> : null}
      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      <p style={{ fontSize: 12, color: colors.muted, marginTop: 12 }}>{rows.length} pending application(s)</p>

      {!loading && rows.length === 0 ? (
        <p style={{ color: colors.muted, marginTop: 24 }}>No pending vendor applications.</p>
      ) : null}

      {rows.length > 0 ? (
        <Card style={{ padding: 0, overflow: 'auto', marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Applicant', 'Estate', 'Category', 'Payout account', 'Status', 'Age / SLA', 'Decision'].map((h) => (
                  <th key={h} style={thCell}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const breached = slaBreached(a.submittedAt);
                return (
                  <tr key={a.id}>
                    <td style={tdCell}>
                      <strong>{a.businessName}</strong>
                      <div style={{ fontSize: 11, color: colors.muted }}>{a.applicantName} · {a.phone}</div>
                      <div style={{ fontSize: 11, color: colors.muted }}>{a.specialties.join(', ') || '—'}</div>
                    </td>
                    <td style={tdCell}>{a.estateName}</td>
                    <td style={{ ...tdCell, textTransform: 'capitalize' }}>{a.category}</td>
                    <td style={tdCell}>
                      {a.bankProvided ? (
                        <span style={{ color: colors.success }}>On file</span>
                      ) : (
                        <span style={{ color: colors.danger }}>Missing</span>
                      )}
                    </td>
                    <td style={tdCell}><VendorStatusBadge status={a.status} /></td>
                    <td style={tdCell}>
                      {ageFromNow(a.submittedAt)}
                      {breached ? <span style={{ color: colors.danger, marginLeft: 6, fontSize: 11 }}>● SLA breach</span> : null}
                    </td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Button variant="primary" sm onClick={() => decide(a, 'verified', 'Approve')} disabled={busyId === a.id || !canManage} title={!canManage ? 'Requires estate.manage' : ''}>
                          {busyId === a.id ? '…' : 'Approve'}
                        </Button>
                        <Button variant="danger" sm onClick={() => decide(a, 'suspended', 'Reject')} disabled={busyId === a.id || !canManage}>Reject</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}
    </Page>
  );
}
