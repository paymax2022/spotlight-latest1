/**
 * ModulesPanel: grouped members, collapsed none, error rows, zero members, 403, 404,
 * error+Retry, unsafe hrefs, superseded requests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'

type Impl = (id: string) => Promise<unknown>
let impl: Impl = async () => []
const mockGet = vi.fn((id: string) => impl(id))

vi.mock('@/services/usersService', () => ({
  getUserModules: (...args: unknown[]) => mockGet(...(args as [string])),
  AdminUsersRequestError: class extends Error {
    constructor(public readonly status: number, message: string) {
      super(message)
    }
  },
}))

import { AdminUsersRequestError } from '@/services/usersService'
import { ModulesPanel } from './ModulesPanel'

const mod = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  label: `Label ${key}`,
  group: 'Finance',
  href: `/admin/${key}`,
  status: 'member',
  count: 3,
  since: '2026-01-02T03:04:05Z',
  ...over,
})

beforeEach(() => {
  mockGet.mockClear()
  impl = async () => []
})
afterEach(cleanup)

describe('ModulesPanel', () => {
  it('groups members with count, since date and Open link', async () => {
    impl = async () => [mod('a'), mod('b', { group: 'Health', count: 7 })]
    render(<ModulesPanel userId="u1" />)
    await screen.findByText('Label a')
    expect(screen.getByText('Finance')).toBeTruthy()
    expect(screen.getByText('Health')).toBeTruthy()
    expect(screen.getByText(/Count: 7/)).toBeTruthy()
    const links = screen.getAllByRole('link', { name: 'Open' })
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/admin/a', '/admin/b'])
    expect(screen.getAllByText(/Since/).length).toBe(2)
  })

  it('collapses none rows under Not onboarded (n) and expands on click', async () => {
    impl = async () => [mod('a'), mod('n1', { status: 'none' }), mod('n2', { status: 'none' })]
    render(<ModulesPanel userId="u1" />)
    const toggle = await screen.findByRole('button', { name: /Not onboarded \(2\)/ })
    expect(screen.queryByText('Label n1')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText('Label n1')).toBeTruthy()
    expect(screen.getByText('Label n2')).toBeTruthy()
  })

  it('lists error rows as unavailable', async () => {
    impl = async () => [mod('a'), mod('e1', { status: 'error' })]
    render(<ModulesPanel userId="u1" />)
    await screen.findByText('Label e1')
    expect(screen.getByText('Membership unavailable')).toBeTruthy()
  })

  it('shows Not onboarded to any module when there are zero members', async () => {
    impl = async () => [mod('n1', { status: 'none' })]
    render(<ModulesPanel userId="u1" />)
    await screen.findByText('Not onboarded to any module')
  })

  it('all rows error -> neutral text, not the not-onboarded claim', async () => {
    impl = async () => [mod('e1', { status: 'error' }), mod('e2', { status: 'error' })]
    render(<ModulesPanel userId="u1" />)
    await screen.findByText('No confirmed memberships')
    expect(screen.queryByText('Not onboarded to any module')).toBeNull()
  })

  it('some none, some error, zero members -> neutral text', async () => {
    impl = async () => [mod('n1', { status: 'none' }), mod('e1', { status: 'error' })]
    render(<ModulesPanel userId="u1" />)
    await screen.findByText('No confirmed memberships')
    expect(screen.queryByText('Not onboarded to any module')).toBeNull()
  })

  it('shows a permission message on 403 without Retry', async () => {
    impl = async () => {
      throw new AdminUsersRequestError(403, 'forbidden')
    }
    render(<ModulesPanel userId="u1" />)
    await screen.findByText(/don't have permission/)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('shows the disabled message on 404 without Retry', async () => {
    impl = async () => {
      throw new AdminUsersRequestError(404, 'not found')
    }
    render(<ModulesPanel userId="u1" />)
    await screen.findByText('Module overview is not enabled in this environment.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('shows the error and retries', async () => {
    let n = 0
    impl = async () => {
      n++
      if (n === 1) throw new AdminUsersRequestError(500, 'boom')
      return [mod('a')]
    }
    render(<ModulesPanel userId="u1" />)
    await screen.findByText('boom')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('Label a')
  })

  it.each(['javascript:alert(1)', '//evil.example/x', 'http://evil.example/x', '/other/path'])(
    'does not render an Open link for href %s',
    async (href) => {
      impl = async () => [mod('a', { href })]
      render(<ModulesPanel userId="u1" />)
      await screen.findByText('Label a')
      expect(screen.queryByRole('link')).toBeNull()
    },
  )

  it('renders backend text as plain text', async () => {
    impl = async () => [mod('a', { label: '<b>x</b>' })]
    const { container } = render(<ModulesPanel userId="u1" />)
    await screen.findByText('<b>x</b>')
    expect(container.querySelector('b')).toBeNull()
  })

  it('ignores a superseded request (new user wins)', async () => {
    let resolveOld!: (v: unknown) => void
    let resolveNew!: (v: unknown) => void
    impl = (id) =>
      new Promise((res) => {
        if (id === 'old') resolveOld = res
        else resolveNew = res
      })
    const { rerender } = render(<ModulesPanel userId="old" />)
    rerender(<ModulesPanel userId="new" />)
    await act(async () => {
      resolveNew([mod('newmod')])
    })
    await screen.findByText('Label newmod')
    await act(async () => {
      resolveOld([mod('oldmod')])
    })
    await waitFor(() => expect(screen.queryByText('Label oldmod')).toBeNull())
    expect(screen.getByText('Label newmod')).toBeTruthy()
  })
})
