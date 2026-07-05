/**
 * §7A Attribution & Default-Referrer — signup-side wiring.
 *
 * attributeSignup applies the SAME fallback-to-house logic the Go engine uses,
 * against Supabase: every signup is attributed. A valid, non-self referral code
 * → that referrer; otherwise (missing / invalid / self) → the seeded global house
 * account ('SPOT-HOUSE'). Idempotent: referral_attributions has UNIQUE
 * (referred_user_id), so a re-run is a safe no-op.
 *
 * This never throws fatally on the caller path — callers wrap it in try/catch so
 * attribution failure can never block signup.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { resolveCodeToReferrer } from '@/src/server/referrals/service';

const GLOBAL_HOUSE_CODE = 'SPOT-HOUSE';
const DEFAULT_GRACE_WINDOW_HOURS = 72;

export interface AttributeSignupInput {
  referralCode?: string | null;
}

export interface AttributeSignupResult {
  attributed: boolean;
  isHouse: boolean;
  attributionType: 'code' | 'global_house';
  riskFlag?: 'self_referral' | 'invalid_code';
}

export async function attributeSignup(
  referredUserId: string,
  { referralCode }: AttributeSignupInput,
): Promise<AttributeSignupResult> {
  const supabase = createAdminClient();

  // Idempotency: already attributed → no-op.
  const { data: existing } = await supabase
    .from('referral_attributions')
    .select('id, is_house, attribution_type, risk_flag')
    .eq('referred_user_id', referredUserId)
    .maybeSingle();

  if (existing) {
    const row = existing as {
      is_house: boolean;
      attribution_type: 'code' | 'global_house';
      risk_flag?: 'self_referral' | 'invalid_code';
    };
    return {
      attributed: true,
      isHouse: row.is_house,
      attributionType: row.attribution_type,
      riskFlag: row.risk_flag ?? undefined,
    };
  }

  // Resolve grace window from config (fall back to default).
  const { data: cfg } = await supabase
    .from('referral_config')
    .select('grace_window_hours')
    .eq('id', true)
    .maybeSingle();
  const graceHours =
    (cfg as { grace_window_hours?: number } | null)?.grace_window_hours ?? DEFAULT_GRACE_WINDOW_HOURS;
  const graceExpiresAt = new Date(Date.now() + graceHours * 3600 * 1000).toISOString();

  // Run the (simplest) fallback chain: valid non-self code → referrer; else house.
  let referrerId: string | null = null;
  let riskFlag: 'self_referral' | 'invalid_code' | undefined;
  const code = referralCode?.trim() ? referralCode.trim().toUpperCase() : '';

  if (code) {
    const resolved = await resolveCodeToReferrer(code);
    if (!resolved) {
      riskFlag = 'invalid_code';
    } else if (resolved === referredUserId) {
      riskFlag = 'self_referral';
    } else {
      referrerId = resolved;
    }
  }

  if (referrerId) {
    const { error } = await supabase.from('referral_attributions').insert({
      referred_user_id: referredUserId,
      referrer_id: referrerId,
      attribution_type: 'code',
      code_used: code,
      is_house: false,
      status: 'grace',
      grace_expires_at: graceExpiresAt,
    });
    // 23505 = concurrent attribution already written — treat as success.
    if (error && error.code !== '23505') throw error;
    return { attributed: true, isHouse: false, attributionType: 'code' };
  }

  // Fallback to the seeded global house account.
  const { data: house } = await supabase
    .from('referral_house_accounts')
    .select('id')
    .eq('code', GLOBAL_HOUSE_CODE)
    .maybeSingle();
  const houseAccountId = (house as { id: string } | null)?.id ?? null;

  const { error: houseErr } = await supabase.from('referral_attributions').insert({
    referred_user_id: referredUserId,
    house_account_id: houseAccountId,
    attribution_type: 'global_house',
    code_used: code || null,
    is_house: true,
    risk_flag: riskFlag ?? null,
    status: 'grace',
    grace_expires_at: graceExpiresAt,
  });
  if (houseErr && houseErr.code !== '23505') throw houseErr;

  return { attributed: true, isHouse: true, attributionType: 'global_house', riskFlag };
}
