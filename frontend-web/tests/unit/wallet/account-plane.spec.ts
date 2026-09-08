/**
 * One wallet plane, one constant (ADR-045).
 *
 * The defect this guards: users had TWO spendable ledger accounts —
 * `ledger_accounts.type = 'wallet'` (this Next.js wallet) and `'user_wallet'`
 * (the Go finance ledger). Mutations went to whichever process ran, and the
 * balance read summed both, so nothing looked wrong until money had to cross the
 * boundary. It crossed when the card rail began funding checkouts: the top-up
 * credited 'wallet', the Go module escrow debited 'user_wallet', and a card-paid
 * order was charged, credited, then refused for insufficient funds.
 *
 * The fix is one constant. What made the bug possible — and what these tests
 * exist to prevent — is the string literal being re-typed in a fourth place.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WALLET_ACCOUNT_TYPE,
  LEGACY_WALLET_ACCOUNT_TYPE,
  SPENDABLE_WALLET_TYPES,
} from '@/src/server/wallet/account-type';

const root = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** Files that resolve a user's wallet account for a MUTATION. */
const MUTATION_SITES = [
  'src/server/wallet/service.ts',
  'src/server/tiers/service.ts',
  'src/server/transfers/bank-webhook.ts',
];

describe('the wallet plane constant', () => {
  it('is the account type the Go finance ledger creates', () => {
    // backend/internal/finance/ledger/model.go: AccountUserWallet = "user_wallet".
    // If these ever disagree, the two processes silently mutate different pots
    // again and a card-funded checkout cannot be spent.
    expect(WALLET_ACCOUNT_TYPE).toBe('user_wallet');
  });

  it('keeps the legacy plane readable but distinct', () => {
    expect(LEGACY_WALLET_ACCOUNT_TYPE).toBe('wallet');
    expect(LEGACY_WALLET_ACCOUNT_TYPE).not.toBe(WALLET_ACCOUNT_TYPE);
    // Balance/reconciliation reads must still see residue on the old plane, or a
    // straggler balance would appear to vanish rather than merely be unspendable.
    expect(SPENDABLE_WALLET_TYPES).toContain(WALLET_ACCOUNT_TYPE);
    expect(SPENDABLE_WALLET_TYPES).toContain(LEGACY_WALLET_ACCOUNT_TYPE);
  });
});

describe('no mutation site re-types the account type', () => {
  it.each(MUTATION_SITES)('%s resolves the account via the constant', (rel) => {
    const src = read(rel);
    // A literal type filter or insert is the exact shape of the original bug.
    expect(src).not.toMatch(/\.eq\(\s*'type'\s*,\s*'wallet'\s*\)/);
    expect(src).not.toMatch(/type:\s*'wallet'\s*[,}]/);
    expect(src).toContain('WALLET_ACCOUNT_TYPE');
  });

  it('the tier daily-limit projection reads the SAME plane the debit will hit', () => {
    // This one is not cosmetic. enforceWalletLimit projects today's spend from the
    // account it resolves; pointed at an empty plane it returns a daily total of 0,
    // so the limit never binds and every tier debits without a cap.
    const src = read('src/server/tiers/service.ts');
    const resolved = /\.from\('ledger_accounts'\)[\s\S]{0,240}?\.eq\('type',\s*([A-Za-z_]+|'[a-z_]+')\)/.exec(src);
    expect(resolved?.[1]).toBe('WALLET_ACCOUNT_TYPE');
  });
});

describe('the consolidation migration', () => {
  const raw = read('../supabase/migrations/20261209000100_consolidate_wallet_planes.sql');
  // Assert on STATEMENTS, not prose: the header comment legitimately contains the
  // words DROP and RENAME while promising not to do either.
  const sql = raw.replace(/^\s*--.*$/gm, '');

  it('moves balances as a balanced pair, never as a bare credit', () => {
    // A lone CREDIT on the new plane would mint money and leave the old plane
    // holding a phantom balance.
    expect(sql).toMatch(/'DEBIT'/);
    expect(sql).toMatch(/'CREDIT'/);
    expect(sql).toMatch(/ON CONFLICT \(idempotency_key\) DO NOTHING/);
  });

  it('only moves positive balances', () => {
    // amount_kobo has CHECK (> 0); a zero or negative balance must be skipped
    // rather than abort the migration.
    expect(sql).toMatch(/available_kobo > 0/);
  });

  it('is additive — no DROP, RENAME or UPDATE of existing entries', () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(sql).not.toMatch(/\bRENAME\b/i);
    // Ledger entries are immutable; a correction is a new balanced pair.
    expect(sql).not.toMatch(/UPDATE\s+public\.ledger_entries/i);
  });
});
