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
  getLoginActivity: (...args: unknown[]) => mockGetLoginActivity(...args),
  getSecurityEvents: (...args: unknown[]) => mockGetSecurityEvents(...args),
  assignUserRole: (...args: unknown[]) => mockAssignUserRole(...args),
  removeUserRole: (...args: unknown[]) => mockRemoveUserRole(...args),
  AdminUsersRequestError: class extends Error {
    constructor(public readonly status: number, message: string) {
      super(message)
    }
  },
}))

const mockGetUserRoles = vi.fn()
const mockGetLoginActivity = vi.fn()
const mockGetSecurityEvents = vi.fn()
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
  getUserKyc: (...args: unknown[]) => mockGetUserKyc(...args),
  approveKycCase: (...args: unknown[]) => mockApproveKycCase(...args),
  rejectKycCase: (...args: unknown[]) => mockRejectKycCase(...args),
}))
const mockGetUserKyc = vi.fn()
const mockApproveKycCase = vi.fn()
const mockRejectKycCase = vi.fn()

import AdminUserProfilePage from './page'
import RolesPanel from './RolesPanel'
import { WalletPanel } from './WalletPanel'
import { KycPanel } from './KycPanel'
import { ActivityPanel } from './ActivityPanel'
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
    mockGetUserRoles.mockResolvedValue([])
    mockListRoles.mockResolvedValue([])
    mockGetWalletBalance.mockResolvedValue({ balanceKobo: 0 })
    mockGetWalletTransactions.mockResolvedValue([])
    mockGetUserKyc.mockResolvedValue({ tier: 0, status: 'none', openCaseId: null })
    mockGetLoginActivity.mockResolvedValue([])
    mockGetSecurityEvents.mockResolvedValue([])
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

describe('KycPanel', () => {
  const panel = () => within(screen.getByTestId('kyc-panel'))

  beforeEach(() => {
    mockGetUserKyc.mockReset()
    mockApproveKycCase.mockReset()
    mockRejectKycCase.mockReset()
  })
  afterEach(() => cleanup())

  it('shows tier and status, and no decision buttons when there is no open case', async () => {
    mockGetUserKyc.mockResolvedValue({ tier: 1, status: 'verified', openCaseId: null })
    render(<KycPanel userId="u1" />)
    await waitFor(() => expect(panel().getByTestId('kyc-status').textContent).toBe('verified'))
    expect(mockGetUserKyc).toHaveBeenCalledWith('u1')
    expect(panel().getByTestId('kyc-tier').textContent).toBe('1')
    expect(panel().queryByText('Approve')).toBeNull()
    expect(panel().queryByText('Reject')).toBeNull()
    expect(mockApproveKycCase).not.toHaveBeenCalled()
  })

  it('approves the open case then refetches', async () => {
    mockGetUserKyc.mockResolvedValueOnce({ tier: 0, status: 'pending', openCaseId: 'c9' })
    mockApproveKycCase.mockResolvedValue(true)
    render(<KycPanel userId="u1" />)
    await waitFor(() => expect(panel().getByText('Approve')).toBeTruthy())
    mockGetUserKyc.mockResolvedValue({ tier: 1, status: 'verified', openCaseId: null })
    fireEvent.click(panel().getByText('Approve'))
    await waitFor(() => expect(panel().getByTestId('kyc-status').textContent).toBe('verified'))
    expect(mockApproveKycCase).toHaveBeenCalledWith('c9')
    expect(mockGetUserKyc).toHaveBeenCalledTimes(2)
    expect(panel().queryByText('Approve')).toBeNull()
  })

  it('rejects with an inline reason then refetches', async () => {
    mockGetUserKyc.mockResolvedValueOnce({ tier: 0, status: 'pending', openCaseId: 'c9' })
    mockRejectKycCase.mockResolvedValue(true)
    render(<KycPanel userId="u1" />)
    await waitFor(() => expect(panel().getByText('Reject')).toBeTruthy())
    fireEvent.click(panel().getByText('Reject'))
    fireEvent.change(panel().getByLabelText('Rejection reason'), { target: { value: 'blurry ID' } })
    mockGetUserKyc.mockResolvedValue({ tier: 0, status: 'rejected', openCaseId: null })
    fireEvent.click(panel().getByText('Confirm reject'))
    await waitFor(() => expect(panel().getByTestId('kyc-status').textContent).toBe('rejected'))
    expect(mockRejectKycCase).toHaveBeenCalledWith('c9', 'blurry ID')
    expect(mockGetUserKyc).toHaveBeenCalledTimes(2)
  })

  it('does not call reject without a reason', async () => {
    mockGetUserKyc.mockResolvedValue({ tier: 0, status: 'pending', openCaseId: 'c9' })
    render(<KycPanel userId="u1" />)
    await waitFor(() => expect(panel().getByText('Reject')).toBeTruthy())
    fireEvent.click(panel().getByText('Reject'))
    fireEvent.click(panel().getByText('Confirm reject'))
    expect(mockRejectKycCase).not.toHaveBeenCalled()
  })

  it('shows an inline error and no success when approve returns false', async () => {
    mockGetUserKyc.mockResolvedValue({ tier: 0, status: 'pending', openCaseId: 'c9' })
    mockApproveKycCase.mockResolvedValue(false)
    render(<KycPanel userId="u1" />)
    await waitFor(() => expect(panel().getByText('Approve')).toBeTruthy())
    fireEvent.click(panel().getByText('Approve'))
    await waitFor(() => expect(panel().getByText('Approve failed')).toBeTruthy())
    expect(mockGetUserKyc).toHaveBeenCalledTimes(1)
    expect(panel().getByTestId('kyc-status').textContent).toBe('pending')
  })

  it('shows an inline error when reject returns false', async () => {
    mockGetUserKyc.mockResolvedValue({ tier: 0, status: 'pending', openCaseId: 'c9' })
    mockRejectKycCase.mockResolvedValue(false)
    render(<KycPanel userId="u1" />)
    await waitFor(() => expect(panel().getByText('Reject')).toBeTruthy())
    fireEvent.click(panel().getByText('Reject'))
    fireEvent.change(panel().getByLabelText('Rejection reason'), { target: { value: 'bad' } })
    fireEvent.click(panel().getByText('Confirm reject'))
    await waitFor(() => expect(panel().getByText('Reject failed')).toBeTruthy())
    expect(mockGetUserKyc).toHaveBeenCalledTimes(1)
  })

  it('shows an inline error and Retry refetches', async () => {
    mockGetUserKyc.mockRejectedValueOnce(new Error('boom'))
    render(<KycPanel userId="u1" />)
    await waitFor(() => expect(panel().getByText('boom')).toBeTruthy())
    mockGetUserKyc.mockResolvedValue({ tier: 2, status: 'verified', openCaseId: null })
    fireEvent.click(panel().getByText('Retry'))
    await waitFor(() => expect(panel().getByTestId('kyc-tier').textContent).toBe('2'))
    expect(mockGetUserKyc).toHaveBeenCalledTimes(2)
  })

  it('shows the permission placeholder on 403 with no Retry', async () => {
    mockGetUserKyc.mockRejectedValue(new AdminUsersRequestError(403, 'forbidden'))
    render(<KycPanel userId="u1" />)
    await waitFor(() => expect(panel().getByText("You don't have permission to view this.")).toBeTruthy())
    expect(panel().queryAllByRole('button').length).toBe(0)
  })
})

describe('ActivityPanel', () => {
  const panel = () => within(screen.getByTestId('activity-panel'))

  beforeEach(() => {
    mockGetLoginActivity.mockReset()
    mockGetSecurityEvents.mockReset()
  })
  afterEach(() => cleanup())

  it('renders a row per login entry and per security entry, preserving order', async () => {
    mockGetLoginActivity.mockResolvedValue([
      { id: 'l1', email: 'new@example.com', status: 'success', ip_address: '10.0.0.1', created_at: '2026-10-02T10:00:00Z' },
      { id: 'l2', email: 'old@example.com', status: 'failed', failure_reason: 'bad password', ip_address: '10.0.0.2', created_at: '2026-10-01T10:00:00Z' },
    ])
    mockGetSecurityEvents.mockResolvedValue([
      { id: 's1', action: 'role.assign', severity: 'high', created_at: '2026-10-02T09:00:00Z' },
      { type: 'failed_login', id: 's2', status: 'failed', ip_address: '10.0.0.9', created_at: '2026-10-01T09:00:00Z' },
    ])
    render(<ActivityPanel userId="u1" />)
    await waitFor(() => expect(panel().getAllByTestId('login-activity-row').length).toBe(2))
    expect(mockGetLoginActivity).toHaveBeenCalledWith('u1')
    expect(mockGetSecurityEvents).toHaveBeenCalledWith('u1')
    const logins = panel().getAllByTestId('login-activity-row')
    expect(logins[0].textContent).toContain('new@example.com')
    expect(logins[0].textContent).toContain('10.0.0.1')
    expect(logins[1].textContent).toContain('old@example.com')
    expect(logins[1].textContent).toContain('bad password')
    const events = panel().getAllByTestId('security-event-row')
    expect(events.length).toBe(2)
    expect(events[0].textContent).toContain('role.assign')
    expect(events[0].textContent).toContain('high')
    expect(events[1].textContent).toContain('failed_login')
    expect(events[1].textContent).toContain('10.0.0.9')
  })

  it('shows each empty label independently', async () => {
    mockGetLoginActivity.mockResolvedValue([])
    mockGetSecurityEvents.mockResolvedValue([{ id: 's1', action: 'x.y', created_at: '2026-10-02T09:00:00Z' }])
    render(<ActivityPanel userId="u1" />)
    await waitFor(() => expect(panel().getByText('No login activity')).toBeTruthy())
    expect(panel().queryByText('No security events')).toBeNull()
    expect(panel().getAllByTestId('security-event-row').length).toBe(1)
    cleanup()
    mockGetLoginActivity.mockResolvedValue([{ id: 'l1', status: 'success' }])
    mockGetSecurityEvents.mockResolvedValue([])
    render(<ActivityPanel userId="u1" />)
    await waitFor(() => expect(panel().getByText('No security events')).toBeTruthy())
    expect(panel().queryByText('No login activity')).toBeNull()
  })

  it('shows an inline error and Retry refetches', async () => {
    mockGetLoginActivity.mockRejectedValueOnce(new Error('boom'))
    mockGetSecurityEvents.mockResolvedValue([])
    render(<ActivityPanel userId="u1" />)
    await waitFor(() => expect(panel().getByText('boom')).toBeTruthy())
    mockGetLoginActivity.mockResolvedValue([{ id: 'l1', email: 'a@b.c', status: 'success' }])
    fireEvent.click(panel().getByText('Retry'))
    await waitFor(() => expect(panel().getAllByTestId('login-activity-row').length).toBe(1))
    expect(mockGetLoginActivity).toHaveBeenCalledTimes(2)
  })

  it('shows the permission placeholder on 403 with no Retry', async () => {
    mockGetLoginActivity.mockRejectedValue(new AdminUsersRequestError(403, 'forbidden'))
    mockGetSecurityEvents.mockResolvedValue([])
    render(<ActivityPanel userId="u1" />)
    await waitFor(() => expect(panel().getByText("You don't have permission to view this.")).toBeTruthy())
    expect(panel().queryAllByRole('button').length).toBe(0)
  })

  it('renders rows missing most fields without throwing', async () => {
    mockGetLoginActivity.mockResolvedValue([{}, { status: 42, created_at: 'not-a-date', ip_address: null }])
    mockGetSecurityEvents.mockResolvedValue([{}, { type: { a: 1 }, severity: undefined }])
    render(<ActivityPanel userId="u1" />)
    await waitFor(() => expect(panel().getAllByTestId('login-activity-row').length).toBe(2))
    expect(panel().getAllByTestId('security-event-row').length).toBe(2)
  })
})
