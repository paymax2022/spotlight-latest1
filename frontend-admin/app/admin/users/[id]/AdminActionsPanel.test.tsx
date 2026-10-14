/**
 * AdminActionsPanel: loaded rows, empty, 403, error+Retry, superseded requests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'

type Impl = (id: string) => Promise<unknown>
let impl: Impl = async () => []
const mockGet = vi.fn((id: string) => impl(id))

vi.mock('@/services/usersService', () => ({
  getAuditLogsForUser: (...args: unknown[]) => mockGet(...(args as [string])),
  AdminUsersRequestError: class extends Error {
    constructor(public readonly status: number, message: string) {
      super(message)
    }
  },
}))

import { AdminUsersRequestError } from '@/services/usersService'
import { AdminActionsPanel } from './AdminActionsPanel'

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  actor_user_id: `actor-${id}`,
  target_user_id: 'u1',
  action: `action-${id}`,
  module: `module-${id}`,
  severity: 'high',
  created_at: '2026-01-02T03:04:05Z',
  ...over,
})

beforeEach(() => {
  mockGet.mockClear()
  impl = async () => []
})
afterEach(cleanup)

describe('AdminActionsPanel', () => {
  it('renders action, module, actor, severity and date', async () => {
    impl = async () => [entry('a')]
    render(<AdminActionsPanel userId="u1" />)
    await screen.findByText('action-a')
    expect(mockGet).toHaveBeenCalledWith('u1')
    expect(screen.getByText('module-a')).toBeTruthy()
    expect(screen.getByText('actor-a')).toBeTruthy()
    expect(screen.getByText('high')).toBeTruthy()
    expect(screen.getByText(new Date('2026-01-02T03:04:05Z').toLocaleString('en-NG'))).toBeTruthy()
  })

  it('renders untrusted values as text, not HTML', async () => {
    impl = async () => [entry('a', { action: '<b>boom</b>' })]
    const { container } = render(<AdminActionsPanel userId="u1" />)
    await screen.findByText('<b>boom</b>')
    expect(container.querySelector('b')).toBeNull()
  })

  it('shows the empty state', async () => {
    render(<AdminActionsPanel userId="u1" />)
    await screen.findByText('No admin actions recorded')
  })

  it('shows the permission message on 403', async () => {
    impl = async () => {
      throw new AdminUsersRequestError(403, 'forbidden')
    }
    render(<AdminActionsPanel userId="u1" />)
    await screen.findByText("You don't have permission to view this.")
  })

  it('shows the error with Retry that refetches', async () => {
    impl = async () => {
      throw new AdminUsersRequestError(500, 'Loading admin actions failed (HTTP 500)')
    }
    render(<AdminActionsPanel userId="u1" />)
    await screen.findByText('Loading admin actions failed (HTTP 500)')
    impl = async () => [entry('z')]
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('action-z')
    expect(mockGet).toHaveBeenCalledTimes(2)
  })

  it('ignores a superseded response when the userId changes', async () => {
    const resolvers: Record<string, (v: unknown) => void> = {}
    impl = (id) => new Promise((res) => { resolvers[id] = res })
    const { rerender } = render(<AdminActionsPanel userId="A" />)
    rerender(<AdminActionsPanel userId="B" />)
    await waitFor(() => expect(resolvers.B).toBeDefined())
    await act(async () => { resolvers.B([entry('new')]) })
    await screen.findByText('action-new')
    await act(async () => { resolvers.A([entry('old')]) })
    expect(screen.queryByText('action-old')).toBeNull()
    expect(screen.getByText('action-new')).toBeTruthy()
  })
})
