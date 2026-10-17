/**
 * stakeholderLabel() relabels a ledger_entries row's raw account_type into a
 * stakeholder name for the Transactions detail page's "Money flow" card —
 * see backend/internal/finance/ledger/model.go's AccountType constants for
 * the full set this must classify correctly.
 */
import { describe, it, expect } from 'vitest';
import { stakeholderLabel, type AdminTransactionRow } from './transactionsAdminService';

const MAIN_USER = 'user-main-001';
const OTHER_USER = 'user-other-002';

function row(overrides: Partial<AdminTransactionRow>): AdminTransactionRow {
  return {
    id: 'row-1',
    type: 'CREDIT',
    amount_kobo: 100000,
    reference: 'ref-1',
    source_inferred: 'utility',
    description: null,
    idempotency_key: null,
    metadata: null,
    created_at: new Date().toISOString(),
    account_id: 'acct-1',
    account_type: 'user_wallet',
    currency: 'NGN',
    user_id: null,
    user_name: null,
    user_email: null,
    user_phone: null,
    module_detail: null,
    ...overrides,
  };
}

describe('stakeholderLabel', () => {
  it.each(['commission', 'paymax_revenue', 'fx_spread_income', 'placement_revenue', 'edtech_fees_vault', 'trading_fee_income'])(
    'labels %s as Spotlight',
    (accountType) => {
      expect(stakeholderLabel(row({ account_type: accountType }), MAIN_USER).label).toBe('Spotlight');
    },
  );

  it('labels provider_clearing as Service Provider', () => {
    expect(stakeholderLabel(row({ account_type: 'provider_clearing' }), MAIN_USER).label).toBe('Service Provider');
  });

  it('labels referral_reward_expense as Referral Program', () => {
    expect(stakeholderLabel(row({ account_type: 'referral_reward_expense' }), MAIN_USER).label).toBe('Referral Program');
  });

  it("labels the main transaction's own user_wallet leg as Customer (Referred)", () => {
    const result = stakeholderLabel(row({ account_type: 'user_wallet', user_id: MAIN_USER }), MAIN_USER);
    expect(result.label).toBe('Customer (Referred)');
    expect(result.caveat).toBeUndefined();
  });

  it("labels a DIFFERENT user's wallet leg as Referrer, with a best-effort caveat", () => {
    const result = stakeholderLabel(row({ account_type: 'user_wallet', user_id: OTHER_USER }), MAIN_USER);
    expect(result.label).toBe('Referrer');
    expect(result.caveat).toBeTruthy();
  });

  it.each(['virtual_account', 'escrow', 'refund', 'settlement', 'failed_transfer_suspense', 'placement_escrow', 'trading_fund_clearing'])(
    'labels %s as an internal Spotlight clearing account, with a caveat',
    (accountType) => {
      const result = stakeholderLabel(row({ account_type: accountType }), MAIN_USER);
      expect(result.label).toBe('Spotlight (internal clearing)');
      expect(result.caveat).toContain(accountType);
    },
  );
});
