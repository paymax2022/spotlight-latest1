/**
 * SessionsPanel: loaded rows, empty, 503 (feature disabled), 403, error+Retry,
 * superseded requests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'

type Impl = (id: string) => Promise<unknown>
let impl: Impl = async () => []
const mockGet = vi.fn((id: string) => impl(id))

vi.mock('@/services/usersService', () => ({
  getUserSessions: (...args: unknown[]) => mockGet(...(args as [string])),
  AdminUsersRequestError: class extends Error {
    constructor(public readonly status: number, message: string) {
      super(message)
    }
  },
}))

import { AdminUsersRequestError } from '@/services/usersService'
import { SessionsPanel } from './SessionsPanel'

const session = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  device: `device-${id}`,
  ip: `10.0.0.${id.length}`,
  userAgent: `agent-${id}`,
  lastSeenAt: '2026-01-02T03:04:05Z',
  expiresAt: '2026-02-02T03:04:05Z',
  createdAt: '2026-01-01T03:04:05Z',
  ...over,
})

beforeEach(() => {
  mockGet.mockClear()
  impl = async () => []
})
afterEach(cleanup)

describe('SessionsPanel', () => {
  it('renders device, ip, user agent and dates', async () => {
    impl = async () => [session('s1')]
    render(<SessionsPanel userId="u1" />)
    await screen.findByText('device-s1')
    expect(mockGet).toHaveBeenCalledWith('u1')
    expect(screen.getByText('10.0.0.2')).toBeTruthy()
    expect(screen.getByText('agent-s1')).toBeTruthy()
    expect(screen.getByText(new Date('2026-01-02T03:04:05Z').toLocaleString('en-NG'))).toBeTruthy()
    expect(screen.getByText(new Date('2026-02-02T03:04:05Z').toLocaleString('en-NG'))).toBeTruthy()
  })

  it('renders untrusted values as text, not HTML', async () => {
    impl = async () => [session('s1', { userAgent: '<i>x</i>' })]
    const { container } = render(<SessionsPanel userId="u1" />)
    await screen.findByText('<i>x</i>')
    expect(container.querySelector('i')).toBeNull()
  })

  it('has no mutation controls', async () => {
    impl = async () => [session('s1')]
    render(<SessionsPanel userId="u1" />)
    await screen.findByText('device-s1')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('shows the empty state', async () => {
    render(<SessionsPanel userId="u1" />)
    await screen.findByText('No active sessions')
  })

  it('shows the hardening message without Retry on 503', async () => {
    impl = async () => {
      throw new AdminUsersRequestError(503, 'feature_disabled')
    }
    render(<SessionsPanel userId="u1" />)
    await screen.findByText('Session hardening is not enabled in this environment.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('shows the permission message on 403', async () => {
    impl = async () => {
      throw new AdminUsersRequestError(403, 'forbidden')
    }
    render(<SessionsPanel userId="u1" />)
    await screen.findByText("You don't have permission to view this.")
  })

  it('shows the error with Retry that refetches', async () => {
    impl = async () => {
      throw new AdminUsersRequestError(500, 'Loading sessions failed (HTTP 500)')
    }
    render(<SessionsPanel userId="u1" />)
    await screen.findByText('Loading sessions failed (HTTP 500)')
    impl = async () => [session('z')]
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('device-z')
    expect(mockGet).toHaveBeenCalledTimes(2)
  })

  it('ignores a superseded response when the userId changes', async () => {
    const resolvers: Record<string, (v: unknown) => void> = {}
    impl = (id) => new Promise((res) => { resolvers[id] = res })
    const { rerender } = render(<SessionsPanel userId="A" />)
    rerender(<SessionsPanel userId="B" />)
    await waitFor(() => expect(resolvers.B).toBeDefined())
    await act(async () => { resolvers.B([session('new')]) })
    await screen.findByText('device-new')
    await act(async () => { resolvers.A([session('old')]) })
    expect(screen.queryByText('device-old')).toBeNull()
    expect(screen.getByText('device-new')).toBeTruthy()
  })
})
