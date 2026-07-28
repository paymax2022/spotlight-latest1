'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { VendorApplication, VendorStatus } from '@/types/vendorsAdmin';
import { listVendorApplications, setVendorStatus, ageFromNow } from '@/services/vendorsAdminService';
import { VendorStatusBadge } from '../statusBadge';
import { useVendorPermissions, VENDOR_PERMS } from '../_ui';

const card = { border: '1px solid #2a2a2a', padding: 12, borderRadius: 6 } as const;
const th = { padding: '8px 6px', fontWeight: 600, opacity: 0.8 } as const;
const td = { padding: '8px 6px' } as const;

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
    <div>
      <p><Link href="/admin/vendors">← Back to Vendor Directory</Link></p>
      <h1>Vendor Onboarding / Approval</h1>
      <p style={{ fontSize: 13, opacity: 0.7 }}>
        Review queue for self-onboarded vendors (submitted from the mobile vendor-portal via
        POST /estate/:id/vendor/onboard). Approve → verified, or reject → suspended. Decisions are
        role-gated (estate.manage) and audited server-side.
      </p>
      <p style={{ fontSize: 12, color: '#fde68a', ...card, background: '#1a1400', borderColor: '#78350f' }}>
        ⚠ Approval maps onto the per-estate POST /estate/:id/vendors/:vendorId/verify endpoint. Mock
        by default until a cross-estate admin queue exists.
      </p>

      {message ? <p style={{ color: 'lightgreen' }}>{message}</p> : null}
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 12 }}>{rows.length} pending application(s)</p>

      {!loading && rows.length === 0 ? (
        <p style={{ opacity: 0.6, marginTop: 24 }}>No pending vendor applications.</p>
      ) : null}

      {rows.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
              {['Applicant', 'Estate', 'Category', 'Payout account', 'Status', 'Age / SLA', 'Decision'].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const breached = slaBreached(a.submittedAt);
              return (
                <tr key={a.id} style={{ borderBottom: '1px solid #1c1c1c' }}>
                  <td style={td}>
                    <strong>{a.businessName}</strong>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>{a.applicantName} · {a.phone}</div>
                    <div style={{ fontSize: 11, opacity: 0.5 }}>{a.specialties.join(', ') || '—'}</div>
                  </td>
                  <td style={td}>{a.estateName}</td>
                  <td style={{ ...td, textTransform: 'capitalize' }}>{a.category}</td>
                  <td style={td}>
                    {a.bankProvided ? (
                      <span style={{ color: '#a7f3d0' }}>On file</span>
                    ) : (
                      <span style={{ color: '#fca5a5' }}>Missing</span>
                    )}
                  </td>
                  <td style={td}><VendorStatusBadge status={a.status} /></td>
                  <td style={td}>
                    {ageFromNow(a.submittedAt)}
                    {breached ? <span style={{ color: '#fca5a5', marginLeft: 6, fontSize: 11 }}>● SLA breach</span> : null}
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => decide(a, 'verified', 'Approve')} disabled={busyId === a.id || !canManage} title={!canManage ? 'Requires estate.manage' : ''}>
                        {busyId === a.id ? '…' : 'Approve'}
                      </button>
                      <button onClick={() => decide(a, 'suspended', 'Reject')} disabled={busyId === a.id || !canManage}>Reject</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
