/**
 * AdminUserProfilePage: loading, loaded, not-found and error states.
 * Mocks usersService so no network calls are made.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

// Behaviour is swapped through a plain variable; configuring the rejection with
// mockRejectedValue/mockImplementation on the vi.fn failed the test with the
// rejected error itself even though the page caught it (cause not pinned down).
let getAdminUserImpl: (id: string) => Promise<unknown> = async () => null
const mockGetAdminUser = vi.fn((id: string) => getAdminUserImpl(id))

vi.mock('@/services/usersService', () => ({
  getAdminUser: (...args: unknown[]) => mockGetAdminUser(...args),
  lockAdminUser: vi.fn(),
  suspendAdminUser: vi.fn(),
  unlockAdminUser: vi.fn(),
  unsuspendAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
}))

import AdminUserProfilePage from './page'

const user = {
  id: 'u1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '08012345678',
  userType: 'contestant',
  status: 'active',
  profileCompleted: true,
  state: 'Lagos',
  country: 'Nigeria',
  createdAt: '2025-01-01T00:00:00Z',
}

// `use(params)` unwraps a thenable synchronously when it is already settled.
const params = (id: string) => {
  const p = Promise.resolve({ id }) as Promise<{ id: string }> & { status: string; value: { id: string } }
  p.status = 'fulfilled'
  p.value = { id }
  return p
}

describe('AdminUserProfilePage', () => {
  beforeEach(() => {
    mockGetAdminUser.mockClear()
    getAdminUserImpl = async () => null
  })
  afterEach(() => cleanup())

  it('loads the user by id and shows the profile', async () => {
    getAdminUserImpl = async () => user
    render(<AdminUserProfilePage params={params('u1')} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    expect(mockGetAdminUser).toHaveBeenCalledWith('u1')
    expect(screen.getAllByText('ada@example.com').length).toBeGreaterThan(0)
    expect(screen.getByText('Save Changes')).toBeTruthy()
  })

  it('says so when the user does not exist', async () => {
    getAdminUserImpl = async () => null
    render(<AdminUserProfilePage params={params('missing')} />)
    await waitFor(() => expect(screen.getByText('User not found.')).toBeTruthy())
  })

  it('surfaces a load failure with a retry instead of "not found"', async () => {
    getAdminUserImpl = async () => {
      throw new Error('Loading user failed (HTTP 403): forbidden')
    }
    render(<AdminUserProfilePage params={params('u1')} />)
    await waitFor(() => expect(screen.getByText(/HTTP 403/)).toBeTruthy())
    expect(screen.getByText('Retry')).toBeTruthy()
    expect(screen.queryByText('User not found.')).toBeNull()
  })
})
