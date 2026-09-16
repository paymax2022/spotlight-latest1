'use client';

import { useState } from 'react';
import {
  settleWithdrawal,
  reverseWithdrawal,
  nairaLabel,
  type WithdrawalRow,
} from '@/services/restaurantAdminService';
import { RESTAURANT_PERMS, useRestaurantPermissions, AccessNotice } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

// Merchant withdrawal settle / reverse — MONEY PATH.
//
// Two deliberate limits, both server-side facts rather than UI shortcuts:
//
// 1. There is NO admin list endpoint. The backend exposes a merchant-scoped list
//    (the caller's own withdrawals) and these two id-keyed admin actions. So this
//    is an "act on a known id" tool: the operator gets the id from support or the
//    DB. A fabricated list would be worse than saying so plainly.
//
// 2. The routes are gated by FEATURE_RESTAURANT_WITHDRAWALS_ENABLED, default OFF.
//    With the flag off they are not registered and every call 404s — surfaced
//    below as an explicit hint rather than a bare "not found".
//
// Settle and reverse are mutually exclusive under a withdrawal-row lock, so a
// payout can never be both paid and reversed. Both carry an Idempotency-Key.

type Action = 'settle' | 'reverse';

export default function WithdrawalsPage() {
  const { can } = useRestaurantPermissions();
  const canPayouts = can(RESTAURANT_PERMS.payouts);

  const [id, setId] = useState('');
  const [providerRef, setProviderRef] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<Action | null>(null);
  const [result, setResult] = useState<WithdrawalRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: Action) {
    setBusy(action);
    setError(null);
    setResult(null);
    try {
      const w = action === 'settle'
        ? await settleWithdrawal(id.trim(), providerRef.trim())
        : await reverseWithdrawal(id.trim(), reason.trim());
      setResult(w);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Action failed';
      setError(
        /404|not found/i.test(msg)
          ? `${msg} — if this is a valid withdrawal id, the module is probably disabled: FEATURE_RESTAURANT_WITHDRAWALS_ENABLED defaults to false.`
          : msg,
      );
    } finally {
      setBusy(null);
    }
  }

  if (!canPayouts) {
    return (
      <Page>
        <PageHeader title="Merchant withdrawals" subtitle="Settle or reverse a merchant payout." />
        <AccessNotice perm="restaurant.admin.payouts" />
      </Page>
    );
  }

  const idValid = id.trim().length > 0;

  return (
    <Page>
      <PageHeader
        title="Merchant withdrawals"
        subtitle="Settle or reverse a merchant payout by id. Money path — every action posts to the ledger."
      />

      <Card style={{ marginBottom: 16, borderColor: colors.warning }}>
        <strong style={{ color: colors.warning }}>Act-on-id only.</strong>{' '}
        <span style={{ fontSize: '0.85rem', color: colors.muted }}>
          The backend exposes no admin list of withdrawals — only the two id-keyed actions
          below. Get the withdrawal id from the merchant, support, or the
          <code style={{ margin: '0 4px' }}>restaurant_withdrawals</code> table.
        </span>
      </Card>

      <Card title="Withdrawal" style={{ marginBottom: 16 }}>
        <label style={{ fontSize: '0.8rem', color: colors.muted, display: 'block', marginTop: 10 }}>
          Withdrawal ID
          <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="uuid" />
        </label>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <Card title="Mark paid">
          <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 8 }}>
            Records the provider&apos;s successful disbursement. Posts
            DR&nbsp;suspense → CR&nbsp;provider&nbsp;clearing.
          </p>
          <label style={{ fontSize: '0.8rem', color: colors.muted, display: 'block', marginTop: 10 }}>
            Provider reference
            <Input
              value={providerRef}
              onChange={(e) => setProviderRef(e.target.value)}
              placeholder="e.g. bank transfer ref"
            />
          </label>
          <Button
            style={{ marginTop: 12 }}
            disabled={!idValid || !providerRef.trim() || busy !== null}
            onClick={() => void run('settle')}
          >
            {busy === 'settle' ? 'Settling…' : 'Mark paid'}
          </Button>
        </Card>

        <Card title="Reverse">
          <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 8 }}>
            The disbursement failed. Posts a compensating reversal back to the merchant
            wallet. Mutually exclusive with &ldquo;Mark paid&rdquo;.
          </p>
          <label style={{ fontSize: '0.8rem', color: colors.muted, display: 'block', marginTop: 10 }}>
            Reason <span style={{ color: colors.danger }}>*</span>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="why the payout failed (audit trail)"
            />
          </label>
          <Button
            variant="outline"
            style={{ marginTop: 12 }}
            disabled={!idValid || !reason.trim() || busy !== null}
            onClick={() => void run('reverse')}
          >
            {busy === 'reverse' ? 'Reversing…' : 'Reverse'}
          </Button>
        </Card>
      </div>

      {error && (
        <Card style={{ marginTop: 16, borderColor: colors.danger, color: colors.danger }}>{error}</Card>
      )}

      {result && (
        <Card title="Result" style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gap: 6, fontSize: '0.85rem' }}>
            <div><span style={{ color: colors.muted }}>Status:</span>{' '}
              <strong style={{ color: result.status === 'paid' ? colors.success : result.status === 'reversed' ? colors.warning : colors.text }}>
                {result.status}
              </strong>
            </div>
            <div><span style={{ color: colors.muted }}>Amount:</span> <strong>{nairaLabel(result.amount_kobo)}</strong></div>
            <div><span style={{ color: colors.muted }}>Merchant:</span> {result.user_id}</div>
            {result.provider_reference && (
              <div><span style={{ color: colors.muted }}>Provider ref:</span> {result.provider_reference}</div>
            )}
            {result.ledger_ref && (
              <div><span style={{ color: colors.muted }}>Ledger ref:</span> <code>{result.ledger_ref}</code></div>
            )}
            {result.failure_reason && (
              <div><span style={{ color: colors.muted }}>Failure:</span> {result.failure_reason}</div>
            )}
          </div>
        </Card>
      )}

      <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: 16 }}>
        Amounts are integer kobo. The disburser seam defaults to a no-op, so enabling the
        feature flag alone does not send money to a bank — a real disburser must be wired
        over <code>provider/disbursement</code> first.
      </p>
    </Page>
  );
}
