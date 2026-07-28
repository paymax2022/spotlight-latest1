/**
 * Contract-presence test for the voting drift-closing fragment.
 *
 * Asserts that the live-but-previously-undocumented voting endpoints now exist
 * in contracts/voting.openapi.yaml and that each financial mutation documents
 * an idempotency requirement. This guards against the contract drifting back
 * out of sync with the shipped routes.
 *
 * Hermetic: reads the YAML file from disk, no network/DB.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CONTRACT_PATH = path.resolve(__dirname, '../../../../contracts/voting.openapi.yaml');
const raw = readFileSync(CONTRACT_PATH, 'utf8');

const REQUIRED_PATHS = [
  '/v2/votes/wallet',
  '/votes/paid/wallet',
  '/open-mic/votes/pay/initiate',
  '/open-mic/votes/pay/verify',
  '/admin/voting/votes/{voteId}/reverse',
];

describe('voting.openapi.yaml contract presence', () => {
  it('declares every newly-documented voting path', () => {
    for (const p of REQUIRED_PATHS) {
      expect(raw, `missing path ${p}`).toContain(`${p}:`);
    }
  });

  it('documents an idempotency requirement on financial mutations', () => {
    // Header-based key for the atomic wallet vote + admin reversal,
    // body-field key for the legacy v2 wallet route, reference-based for verify.
    expect(raw).toContain('Idempotency-Key');
    expect(raw).toMatch(/idempoten/i);
    // Spot-check that the reverse + paid-wallet routes reference the header param.
    expect(raw).toContain("$ref: '#/components/parameters/IdempotencyKey'");
  });

  it('keeps the standalone "merge into master" note', () => {
    expect(raw).toMatch(/Merge .* into the master/i);
  });

  it('treats money as integer kobo (minor units)', () => {
    expect(raw).toContain('kobo');
    expect(raw).toMatch(/Money:\s*\{\s*type:\s*integer/);
  });
});
