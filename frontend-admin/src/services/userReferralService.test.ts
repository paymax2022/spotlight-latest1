import { describe, it, expect, vi, afterEach } from 'vitest'
import { getUserReferralCase } from './userReferralService'
import { adminApiBase } from './usersService'

afterEach(() => vi.unstubAllGlobals())

describe('getUserReferralCase', () => {
  it('reads the Go admin proxy at /api/finance/admin/referrals/:id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ referrer_id: 'u 1', tier: null, rewards: [], milestones: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const cv = await getUserReferralCase('u 1')
    expect(fetchMock.mock.calls[0][0]).toBe(`${adminApiBase()}/finance/admin/referrals/u%201`)
    expect(cv.rewards).toEqual([])
  })
})
