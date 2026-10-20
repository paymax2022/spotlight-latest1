'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { listPayoutRuns } from '@/services/restaurantAdminService';
import { payoutApprovals, payoutStep, CONFIG_PERMS, type PayoutApproval } from '@/services/restaurantConfigAdminService';
import type { PayoutRun } from '@/types/restaurantAdmin';
import { naira, useRestaurantPermissions, AccessNotice } from '../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

// Dual approval: request -> endorse -> approve, three DISTINCT admins; processing a run
// is refused by the server until an approval from a different user than the requester
// and endorser exists.
export default function PayoutApprovalsPage() {
  const { can } = useRestaurantPermissions();
  const [runs, setRuns] = useState<PayoutRun[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [steps, setSteps] = useState<PayoutApproval[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRuns((await listPayoutRuns('')).filter((r) => r.status === 'draft' || r.status === 'pending')); setErr(null); } catch (e) { setErr(String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    try { setSteps(await payoutApprovals(id)); } catch (e) { setErr(String(e)); }
  }
  async function act(id: string, step: 'request' | 'endorse' | 'approve') {
    try { setSteps(await payoutStep(id, step)); setErr(null); } catch (e) { setErr(String(e)); }
  }

  if (!can(CONFIG_PERMS.payoutView)) return <Page><AccessNotice perm={CONFIG_PERMS.payoutView[0]} /></Page>;
  const canApprove = can(CONFIG_PERMS.payoutApprove);
  return (
    <Page>
      <PageHeader title="Payout approvals" subtitle="Draft runs awaiting request / endorsement / final approval by distinct admins." />
      {err && <div style={{ color: colors.danger, marginBottom: 8 }}>{err}</div>}
      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Run', 'Payee', 'Period', 'Net', 'Status', ''].map((h) => <th key={h} style={thCell}>{h}</th>)}</tr></thead>
          <tbody>
            {runs.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td style={tdCell}><code>{r.id.slice(0, 8)}</code></td><td style={tdCell}>{r.payee_type}</td><td style={tdCell}>{r.period_start}</td>
                  <td style={tdCell}>{naira(r.total_net_kobo)}</td><td style={tdCell}><Badge text={r.status} /></td>
                  <td style={tdCell}><Button sm onClick={() => toggle(r.id)}>{open === r.id ? 'Hide' : 'Approvals'}</Button></td>
                </tr>
                {open === r.id && (
                  <tr><td style={tdCell} colSpan={6}>
                    {steps.length === 0 ? <em>No steps recorded yet.</em> : steps.map((s) => (
                      <div key={s.step}><Badge text={s.step} /> by <code>{s.actor_user_id}</code> · {new Date(s.created_at).toLocaleString()} {s.note ? `— ${s.note}` : ''}</div>
                    ))}
                    {canApprove && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                        <Button sm onClick={() => act(r.id, 'request')}>Request</Button>
                        <Button sm onClick={() => act(r.id, 'endorse')}>Endorse</Button>
                        <Button sm variant="primary" onClick={() => act(r.id, 'approve')}>Approve</Button>
                      </div>
                    )}
                  </td></tr>
                )}
              </Fragment>
            ))}
            {runs.length === 0 && <tr><td style={tdCell} colSpan={6}>No draft or pending runs.</td></tr>}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
