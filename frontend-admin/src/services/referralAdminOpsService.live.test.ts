import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function live() {
  vi.stubEnv('NEXT_PUBLIC_REFERRAL_USE_MOCK', 'false')
  vi.resetModules()
  return import('./referralAdminOpsService')
}

describe('getReferralUser360 (live branch)', () => {
  it('requests the only backend route, /users/<id>/referral-360', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ user: { user_id: 'u1', referred_count: 2, total_earned_kobo: 900, paid_kobo: 400, clawed_back_kobo: 0, fraud_standing: 'clear' } }), { status: 200 }))
    vi.stubGlobal('fetch', f)
    const { getReferralUser360 } = await live()
    const r = await getReferralUser360('u1')
    expect(String((f.mock.calls[0] as unknown[])[0]).endsWith('/users/u1/referral-360')).toBe(true)
    // The page reads these arrays unconditionally; the backend sends none of them.
    expect(r?.id).toBe('u1')
    expect(r?.referrals).toEqual([])
    expect(r?.earnings).toEqual([])
    expect(r?.audit).toEqual([])
    expect(r?.total_earned_kobo).toBe(900)
    expect(r?.referrals_count).toBe(2)
  })
})
