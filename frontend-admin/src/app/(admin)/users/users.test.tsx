/**
 * Integration test for the AdminUsersPage component.
 * Mocks the usersService so no network calls are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock the service module before importing the component
// ---------------------------------------------------------------------------
const mockListAdminUsers = vi.fn()
const mockGetAdminUser = vi.fn()

vi.mock('@/services/usersService', () => ({
  listAdminUsers: (...args: unknown[]) => mockListAdminUsers(...args),
  getAdminUser: (...args: unknown[]) => mockGetAdminUser(...args),
  lockAdminUser: vi.fn(),
  suspendAdminUser: vi.fn(),
  unlockAdminUser: vi.fn(),
  unsuspendAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
}))

import AdminUsersPage from './page'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeUser = (overrides: Partial<Record<string, unknown>> = {}) => ({
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
  ...overrides,
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('AdminUsersPage', () => {
  beforeEach(() => {
    mockListAdminUsers.mockResolvedValue([])
    mockGetAdminUser.mockResolvedValue(null)
  })

  it('renders the page heading', async () => {
    render(<AdminUsersPage />)
    expect(screen.getByText('Users Management')).toBeTruthy()
  })

  it('shows loading state initially', () => {
    // Keep the promise pending so we catch the loading flash
    mockListAdminUsers.mockReturnValue(new Promise(() => {}))
    render(<AdminUsersPage />)
    expect(screen.getByText('Loading...')).toBeTruthy()
  })

  it('renders a user row after loading', async () => {
    mockListAdminUsers.mockResolvedValue([makeUser()])
    render(<AdminUsersPage />)
    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    })
    expect(screen.getByText(/ada@example.com/)).toBeTruthy()
  })

  it('renders multiple users', async () => {
    mockListAdminUsers.mockResolvedValue([
      makeUser({ id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' }),
      makeUser({ id: 'u2', firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com' }),
    ])
    render(<AdminUsersPage />)
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeTruthy()
      expect(screen.getByText('Bob Jones')).toBeTruthy()
    })
  })

  it('shows total count in the stats bar', async () => {
    mockListAdminUsers.mockResolvedValue([
      makeUser({ id: 'u1' }),
      makeUser({ id: 'u2', status: 'suspended' }),
    ])
    render(<AdminUsersPage />)
    await waitFor(() => {
      expect(screen.getByText(/Total: 2/)).toBeTruthy()
    })
    expect(screen.getByText(/Suspended: 1/)).toBeTruthy()
  })
})
