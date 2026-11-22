import { describe, it, expect, vi, afterEach } from 'vitest'
import { getUserReferralCode, getReferral360, getReferralLedger } from './userReferralActivityService'
import { adminApiBase, AdminUsersRequestError } from './usersService'

afterEach(() => vi.unstubAllGlobals())

const stub = (status: number, body: unknown) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('getUserReferralCode', () => {
  it('reads the code and its source', async () => {
    const f = stub(200, { code: 'K7QX2', source: 'finance_referral_codes' })
    expect(await getUserReferralCode('u 1')).toEqual({ code: 'K7QX2', source: 'finance_referral_codes' })
    expect(f.mock.calls[0][0]).toBe(`${adminApiBase()}/finance/admin/referrals/u%201/code`)
  })
  it('maps 404 to null', async () => {
    stub(404, { error: 'no referral code' })
    expect(await getUserReferralCode('u1')).toBeNull()
  })
  it('treats a 200 with an empty or absent code as no code', async () => {
    stub(200, { code: '   ', source: 'referral_links' })
    expect(await getUserReferralCode('u1')).toBeNull()
    stub(200, { source: 'referral_links' })
    expect(await getUserReferralCode('u1')).toBeNull()
  })
  it('throws with status on 403', async () => {
    stub(403, { error: 'forbidden' })
    await expect(getUserReferralCode('u1')).rejects.toMatchObject({ status: 403 })
    await expect(getUserReferralCode('u1')).rejects.toBeInstanceOf(AdminUsersRequestError)
  })

  // The backend reports the code the account was issued when an admin has since
  // customised it. The user record has to show both, so the read carries the
  // original through instead of collapsing to the current value.
  it('carries the original code when the backend reports one', async () => {
    stub(200, { code: 'JIDE1', source: 'referral_links', original_code: '94JQ7' })
    expect(await getUserReferralCode('u1')).toEqual({
      code: 'JIDE1',
      source: 'referral_links',
      original: '94JQ7',
    })
  })

  // Never customised: no second row on the page, so no key on the object.
  it('omits the original when the code was never customised', async () => {
    stub(200, { code: 'K7QX2', source: 'referral_links' })
    expect(await getUserReferralCode('u1')).toEqual({ code: 'K7QX2', source: 'referral_links' })
  })

  it('ignores a blank or non-string original_code', async () => {
    stub(200, { code: 'K7QX2', source: 'referral_links', original_code: '   ' })
    expect(await getUserReferralCode('u1')).toEqual({ code: 'K7QX2', source: 'referral_links' })
    stub(200, { code: 'K7QX2', source: 'referral_links', original_code: 42 })
    expect(await getUserReferralCode('u1')).toEqual({ code: 'K7QX2', source: 'referral_links' })
  })
})

describe('getReferral360', () => {
  it('reads the user object', async () => {
    const f = stub(200, { user: { user_id: 'u1', referrer_id: 'r1', referred_count: 3, total_earned_kobo: 500, paid_kobo: 200, clawed_back_kobo: 50, fraud_standing: 'clear' } })
    expect(await getReferral360('u1')).toEqual({ referrer_id: 'r1', referred_count: 3, total_earned_kobo: 500, paid_kobo: 200, clawed_back_kobo: 50, fraud_standing: 'clear' })
    expect(f.mock.calls[0][0]).toBe(`${adminApiBase()}/referral/admin/users/u1/referral-360`)
  })
  it('defaults missing referrer to null', async () => {
    stub(200, { user: { user_id: 'u1', fraud_standing: 'clear' } })
    const r = await getReferral360('u1')
    expect(r.referrer_id).toBeNull()
    expect(r.total_earned_kobo).toBe(0)
  })
  it('throws with status on 403', async () => {
    stub(403, {})
    await expect(getReferral360('u1')).rejects.toMatchObject({ status: 403 })
  })
})

describe('getReferralLedger', () => {
  it('returns entries', async () => {
    const f = stub(200, { entries: [{ id: 'e1', kind: 'reward', state: 'paid', amount_kobo: 100, currency: 'NGN', is_house: false }] })
    const rows = await getReferralLedger('u1')
    expect(rows).toHaveLength(1)
    expect(f.mock.calls[0][0]).toBe(`${adminApiBase()}/referral/admin/ledger?beneficiary=u1`)
  })
  it('tolerates a missing entries key', async () => {
    stub(200, {})
    expect(await getReferralLedger('u1')).toEqual([])
  })
  it('throws with status on 403', async () => {
    stub(403, {})
    await expect(getReferralLedger('u1')).rejects.toMatchObject({ status: 403 })
  })
})
