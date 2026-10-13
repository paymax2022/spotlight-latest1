/**
 * AdminUserProfilePage: loading, loaded, not-found and error states.
 * Mocks usersService so no network calls are made.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

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
  getUserRoles: (...args: unknown[]) => mockGetUserRoles(...args),
  assignUserRole: (...args: unknown[]) => mockAssignUserRole(...args),
  removeUserRole: (...args: unknown[]) => mockRemoveUserRole(...args),
  AdminUsersRequestError: class extends Error {
    constructor(public readonly status: number, message: string) {
      super(message)
    }
  },
}))

const mockGetUserRoles = vi.fn()
const mockAssignUserRole = vi.fn()
const mockRemoveUserRole = vi.fn()
const mockListRoles = vi.fn()
vi.mock('@/services/rbacAdminService', () => ({
  listRoles: (...args: unknown[]) => mockListRoles(...args),
}))

const mockGetWalletBalance = vi.fn()
const mockGetWalletTransactions = vi.fn()
vi.mock('@/services/userFinanceService', () => ({
  getWalletBalance: (...args: unknown[]) => mockGetWalletBalance(...args),
  getWalletTransactions: (...args: unknown[]) => mockGetWalletTransactions(...args),
}))

import AdminUserProfilePage from './page'
import RolesPanel from './RolesPanel'
import { WalletPanel } from './WalletPanel'
import { AdminUsersRequestError } from '@/services/usersService'

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

describe('RolesPanel', () => {
  const catalog = [
    { id: 'r-admin', slug: 'admin', name: 'Administrator' },
    { id: 'r-mod', slug: 'moderator', name: 'Moderator' },
    { id: 'r-fin', slug: 'finance', name: 'Finance' },
  ]
  beforeEach(() => {
    mockGetUserRoles.mockReset()
    mockAssignUserRole.mockReset()
    mockRemoveUserRole.mockReset()
    mockListRoles.mockReset()
    mockListRoles.mockResolvedValue(catalog)
  })
  afterEach(() => cleanup())

  it('shows a chip with the catalog name per current role', async () => {
    mockGetUserRoles.mockResolvedValue(['admin', 'moderator'])
    render(<RolesPanel userId="u1" />)
    await waitFor(() => expect(screen.getByText('Administrator')).toBeTruthy())
    expect(screen.getByText('Moderator')).toBeTruthy()
    expect(mockGetUserRoles).toHaveBeenCalledWith('u1')
  })

  it('shows an empty label, not an error, when the user has no roles', async () => {
    mockGetUserRoles.mockResolvedValue([])
    render(<RolesPanel userId="u1" />)
    await waitFor(() => expect(screen.getByText('No roles assigned')).toBeTruthy())
    expect(screen.queryByText('Retry')).toBeNull()
  })

  it('shows an inline error with Retry that refetches', async () => {
    mockGetUserRoles.mockRejectedValueOnce(new AdminUsersRequestError(500, 'boom'))
    render(<RolesPanel userId="u1" />)
    await waitFor(() => expect(screen.getByText(/boom/)).toBeTruthy())
    mockGetUserRoles.mockResolvedValueOnce(['admin'])
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(screen.getByText('Administrator')).toBeTruthy())
  })

  it('shows a permission placeholder with no Retry on 403', async () => {
    mockGetUserRoles.mockRejectedValue(new AdminUsersRequestError(403, 'forbidden'))
    render(<RolesPanel userId="u1" />)
    await waitFor(() => expect(screen.getByText(/don't have permission to view this/)).toBeTruthy())
    expect(screen.queryByText('Retry')).toBeNull()
  })

  it('remove calls removeUserRole with the resolved id (not slug) then refetches', async () => {
    mockGetUserRoles.mockResolvedValueOnce(['admin']).mockResolvedValue([])
    mockRemoveUserRole.mockResolvedValue(true)
    render(<RolesPanel userId="u1" />)
    await waitFor(() => expect(screen.getByText('Administrator')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Remove Administrator'))
    await waitFor(() => expect(mockRemoveUserRole).toHaveBeenCalledWith('u1', 'r-admin'))
    await waitFor(() => expect(mockGetUserRoles).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('No roles assigned')).toBeTruthy())
  })

  it('assign calls assignUserRole with the role id then refetches', async () => {
    mockGetUserRoles.mockResolvedValueOnce(['admin']).mockResolvedValue(['admin', 'finance'])
    mockAssignUserRole.mockResolvedValue(true)
    render(<RolesPanel userId="u1" />)
    await waitFor(() => expect(screen.getByText('Administrator')).toBeTruthy())
    const select = screen.getByLabelText('Assign role') as HTMLSelectElement
    // roles already held are not offered
    expect(Array.from(select.options).map((o) => o.value)).not.toContain('r-admin')
    fireEvent.change(select, { target: { value: 'r-fin' } })
    fireEvent.click(screen.getByText('Assign'))
    await waitFor(() => expect(mockAssignUserRole).toHaveBeenCalledWith('u1', 'r-fin'))
    await waitFor(() => expect(mockGetUserRoles).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('Finance')).toBeTruthy())
  })

  it('surfaces an assign failure inline', async () => {
    mockGetUserRoles.mockResolvedValue([])
    mockAssignUserRole.mockRejectedValue(new AdminUsersRequestError(403, 'Assigning role failed (HTTP 403)'))
    render(<RolesPanel userId="u1" />)
    await waitFor(() => expect(screen.getByText('No roles assigned')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Assign role'), { target: { value: 'r-fin' } })
    fireEvent.click(screen.getByText('Assign'))
    await waitFor(() => expect(screen.getByText(/HTTP 403/)).toBeTruthy())
  })

  it('explains a missing catalog and disables removal', async () => {
    mockListRoles.mockResolvedValue([])
    mockGetUserRoles.mockResolvedValue(['admin'])
    render(<RolesPanel userId="u1" />)
    await waitFor(() => expect(screen.getByText('admin')).toBeTruthy())
    expect(screen.getByText(/Role catalog unavailable/)).toBeTruthy()
    const x = screen.getByLabelText('Remove admin') as HTMLButtonElement
    expect(x.disabled).toBe(true)
    fireEvent.click(x)
    expect(mockRemoveUserRole).not.toHaveBeenCalled()
  })

  it('shows an inline error when assign resolves false (real failure signal)', async () => {
    mockGetUserRoles.mockResolvedValue([])
    mockAssignUserRole.mockResolvedValue(false)
    render(<RolesPanel userId="u1" />)
    await waitFor(() => expect(screen.getByText('No roles assigned')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Assign role'), { target: { value: 'r-fin' } })
    fireEvent.click(screen.getByText('Assign'))
    await waitFor(() => expect(screen.getByText(/Assigning role failed/)).toBeTruthy())
    expect(mockGetUserRoles).toHaveBeenCalledTimes(1)
    expect(screen.getByText('No roles assigned')).toBeTruthy()
  })

  it('shows an inline error when remove resolves false and keeps the chip', async () => {
    mockGetUserRoles.mockResolvedValue(['admin'])
    mockRemoveUserRole.mockResolvedValue(false)
    render(<RolesPanel userId="u1" />)
    await waitFor(() => expect(screen.getByText('Administrator')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Remove Administrator'))
    await waitFor(() => expect(screen.getByText(/Removing role failed/)).toBeTruthy())
    expect(mockGetUserRoles).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Administrator')).toBeTruthy()
  })
})

describe('WalletPanel', () => {
  const txs = [
    { id: 't1', type: 'credit', amount_kobo: 150000, reference: 'ref-aaa', created_at: '2025-01-02T10:00:00Z' },
    { id: 't2', type: 'debit', amount_kobo: 2550, reference: 'ref-bbb', created_at: '2025-01-03T10:00:00Z' },
  ]
  const panel = () => within(screen.getByTestId('wallet-panel'))

  beforeEach(() => {
    mockGetWalletBalance.mockReset()
    mockGetWalletTransactions.mockReset()
  })
  afterEach(() => cleanup())

  it('shows the balance in naira and a row per transaction', async () => {
    mockGetWalletBalance.mockResolvedValue({ balanceKobo: 150000 })
    mockGetWalletTransactions.mockResolvedValue(txs)
    render(<WalletPanel userId="u1" />)
    await waitFor(() => expect(panel().getByTestId('wallet-balance').textContent).toBe('₦1,500.00'))
    expect(mockGetWalletBalance).toHaveBeenCalledWith('u1')
    expect(mockGetWalletTransactions).toHaveBeenCalledWith('u1')
    expect(panel().getByText('ref-aaa')).toBeTruthy()
    expect(panel().getByText('ref-bbb')).toBeTruthy()
    expect(panel().getByText('₦25.50')).toBeTruthy()
    expect(panel().getAllByRole('row').length).toBe(3) // header + 2
    for (const h of ['Type', 'Amount (₦)', 'Reference', 'Date']) expect(panel().getByText(h)).toBeTruthy()
    expect(panel().queryAllByRole('button').length).toBe(0)
    expect(panel().queryAllByRole('textbox').length).toBe(0)
  })

  it('shows an empty label but still the balance when there are no transactions', async () => {
    mockGetWalletBalance.mockResolvedValue({ balanceKobo: 50 })
    mockGetWalletTransactions.mockResolvedValue([])
    render(<WalletPanel userId="u1" />)
    await waitFor(() => expect(panel().getByText('No transactions')).toBeTruthy())
    expect(panel().getByTestId('wallet-balance').textContent).toBe('₦0.50')
  })

  it('shows an inline error and Retry refetches', async () => {
    mockGetWalletBalance.mockRejectedValueOnce(new Error('boom'))
    mockGetWalletTransactions.mockResolvedValue([])
    render(<WalletPanel userId="u1" />)
    await waitFor(() => expect(panel().getByText('boom')).toBeTruthy())
    expect(panel().getAllByRole('button').length).toBe(1)
    mockGetWalletBalance.mockResolvedValue({ balanceKobo: 150000 })
    fireEvent.click(panel().getByText('Retry'))
    await waitFor(() => expect(panel().getByTestId('wallet-balance').textContent).toBe('₦1,500.00'))
    expect(mockGetWalletBalance).toHaveBeenCalledTimes(2)
  })

  it('shows the permission placeholder on 403 with no Retry', async () => {
    mockGetWalletBalance.mockRejectedValue(new AdminUsersRequestError(403, 'forbidden'))
    mockGetWalletTransactions.mockResolvedValue([])
    render(<WalletPanel userId="u1" />)
    await waitFor(() => expect(panel().getByText("You don't have permission to view this.")).toBeTruthy())
    expect(panel().queryAllByRole('button').length).toBe(0)
  })
})
