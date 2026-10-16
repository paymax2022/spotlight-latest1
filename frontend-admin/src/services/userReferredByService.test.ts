// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { describeReferrer, type ReferredBy } from './userReferredByService';

const base: ReferredBy = { user_id: 'u', attributed: true, is_house: false };

describe('describeReferrer', () => {
  it('a user with a real referrer shows their name and the code they entered', () => {
    const d = describeReferrer({ ...base, referrer_id: 'r1', referrer_name: 'Ada Obi', referrer_code: 'K7QX2', code_used: 'K7QX2', attribution_type: 'code' });
    expect(d.title).toBe('Ada Obi');
    expect(d.detail).toBe('entered K7QX2 · code K7QX2');
  });

  it('falls back to email, then id, when the referrer has no name', () => {
    expect(describeReferrer({ ...base, referrer_id: 'r1', referrer_email: 'a@b.co' }).title).toBe('a@b.co');
    expect(describeReferrer({ ...base, referrer_id: 'r1' }).title).toBe('r1');
  });

  it('a codeless user reads as Admin, never as a person', () => {
    const d = describeReferrer({ ...base, is_house: true, house_code: 'SPOT-HOUSE', house_owner_name: 'Super Admin', attribution_type: 'global_house' });
    expect(d.title).toBe('Admin (house account)');
    expect(d.detail).toBe('SPOT-HOUSE · Super Admin · no referral code was used');
  });

  it('an unattributed user says so instead of inventing a referrer', () => {
    const d = describeReferrer({ user_id: 'u', attributed: false, is_house: false });
    expect(d.title).toBe('Not attributed yet');
    expect(d.detail).toMatch(/Admin/);
  });
});
