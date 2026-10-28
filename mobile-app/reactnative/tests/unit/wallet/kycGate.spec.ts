// The wallet balance endpoint answers 403 "This feature requires KYC Tier N. Your current
// tier is M." for an unverified user, and 403 "KYC verification check failed. Access
// denied." when its own tier lookup errors (it fails closed). Both mean "verify your
// identity"; any other 403, or any other status, does not.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { kycTierRequired } from '@/api/kycGate';

const err = (status: number | undefined, message: string) => ({ response: status ? { status } : undefined, message });

describe('kycTierRequired', () => {
  it('reads the required tier from the server message', () => {
    assert.equal(kycTierRequired(err(403, 'This feature requires KYC Tier 2. Your current tier is 0. Please complete identity verification to continue.')), 2);
  });

  it('is tier 1 for the standard wallet message', () => {
    assert.equal(kycTierRequired(err(403, 'This feature requires KYC Tier 1. Your current tier is 0.')), 1);
  });

  it('treats the fail-closed lookup failure as a KYC prompt for tier 1', () => {
    assert.equal(kycTierRequired(err(403, 'KYC verification check failed. Access denied.')), 1);
  });

  it('is case-insensitive about the word KYC', () => {
    assert.equal(kycTierRequired(err(403, 'requires kyc tier 3')), 3);
  });

  it('is null for a 403 that is not about KYC', () => {
    assert.equal(kycTierRequired(err(403, 'Forbidden')), null);
    assert.equal(kycTierRequired(err(403, 'Wallet feature is not available.')), null);
  });

  it('is null for non-403 statuses even if the text mentions KYC', () => {
    assert.equal(kycTierRequired(err(401, 'KYC Tier 1 required')), null);
    assert.equal(kycTierRequired(err(500, 'KYC verification check failed')), null);
    assert.equal(kycTierRequired(err(503, 'KYC Tier 1')), null);
  });

  it('is null for network errors, undefined and non-objects', () => {
    assert.equal(kycTierRequired(err(undefined, 'Network Error')), null);
    assert.equal(kycTierRequired(undefined), null);
    assert.equal(kycTierRequired(null), null);
    assert.equal(kycTierRequired('403'), null);
  });

  it('falls back to the response body when the message was not rewritten', () => {
    const e = { response: { status: 403, data: { error: 'This feature requires KYC Tier 2.' } }, message: 'Request failed with status code 403' };
    assert.equal(kycTierRequired(e), 2);
  });

  it('ignores an absurd tier number rather than trusting it', () => {
    assert.equal(kycTierRequired(err(403, 'requires KYC Tier 99')), 1);
  });
});
