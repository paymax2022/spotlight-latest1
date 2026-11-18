/**
 * Integration test for the AdminUsersPage component.
 * Mocks the usersService so no network calls are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

// Mock the service module before importing the component
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

// Helpers
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

// Tests
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
    // The page renders a Unicode ellipsis ("Loading…"), not three ASCII dots.
    expect(screen.getByText('Loading…')).toBeTruthy()
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

  it('has a Profile column whose link goes to the user profile page', async () => {
    mockListAdminUsers.mockResolvedValue([makeUser()])
    render(<AdminUsersPage />)
    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    })
    expect(screen.getByRole('columnheader', { name: 'Profile' })).toBeTruthy()
    const link = screen.getByRole('link', { name: /view profile/i })
    expect(link.getAttribute('href')).toBe('/admin/users/u1')
  })

  it('still opens the side panel when a row is clicked', async () => {
    mockListAdminUsers.mockResolvedValue([makeUser()])
    mockGetAdminUser.mockResolvedValue(makeUser())
    render(<AdminUsersPage />)
    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('Ada Lovelace'))
    await waitFor(() => {
      expect(screen.getByDisplayValue('Ada')).toBeTruthy()
    })
  })

  it('renders retry and error detail when loading fails', async () => {
    mockListAdminUsers.mockRejectedValue(new Error('HTTP 401 Not authenticated'))
    render(<AdminUsersPage />)
    await waitFor(() => {
      expect(screen.getByText(/— failed to load: HTTP 401 Not authenticated/)).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })
})
