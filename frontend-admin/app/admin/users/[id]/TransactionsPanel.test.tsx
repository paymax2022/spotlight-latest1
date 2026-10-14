/**
 * TransactionsPanel: paging, empty/403/error states, row links, type filter.
 * Mocks transactionsAdminService (formatKobo stays real).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Behaviour is swapped through a plain variable (same workaround as
// profile.test.tsx: mockImplementation/mockRejectedValue on the vi.fn surfaced
// the rejection as a test failure).
type Impl = (f: { offset: number; [k: string]: unknown }) => Promise<unknown>
let impl: Impl = async () => ({ rows: [], total: 0, limit: 25, offset: 0 })
const mockList = vi.fn((f: { offset: number }) => impl(f))
vi.mock('@/services/transactionsAdminService', async () => {
  const actual = await vi.importActual<typeof import('@/services/transactionsAdminService')>(
    '@/services/transactionsAdminService',
  )
  return { ...actual, listAdminTransactions: (...args: unknown[]) => mockList(...args) }
})

import { TransactionsPanel } from './TransactionsPanel'

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    type: 'CREDIT',
    amount_kobo: 150000,
    description: `desc-${id}`,
    account_type: 'wallet',
    created_at: '2026-01-02T03:04:05Z',
    ...over,
  }
}
function setResult(v: unknown) {
  impl = async () => v
}
const page = (rows: unknown[], total: number, offset = 0) => ({ rows, total, limit: 25, offset })

beforeEach(() => {
  mockList.mockClear()
  impl = async () => page([], 0)
})
afterEach(cleanup)

describe('TransactionsPanel', () => {
  it('loads page 1 with user_id and limit 25', async () => {
    setResult(page([row('a')], 1))
    render(<TransactionsPanel userId="u1" />)
    await screen.findByText('desc-a')
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', limit: 25, offset: 0 }))
    expect(screen.getByText('₦1,500.00')).toBeTruthy()
  })

  it('Next requests offset 25 and Previous goes back', async () => {
    impl = (async (f: { offset: number }) =>
      f.offset === 0 ? page([row('a')], 30) : page([row('b')], 30, 25))
    render(<TransactionsPanel userId="u1" />)
    await screen.findByText('desc-a')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('desc-b')
    expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await screen.findByText('desc-a')
    expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }))
  })

  it('Next disabled on the last page and when total is 0', async () => {
    setResult(page([row('a')], 25))
    const { unmount } = render(<TransactionsPanel userId="u1" />)
    await screen.findByText('desc-a')
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
    unmount()
    setResult(page([], 0))
    render(<TransactionsPanel userId="u1" />)
    await screen.findByText('No transactions')
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows "No transactions" when empty', async () => {
    setResult(page([], 0))
    render(<TransactionsPanel userId="u1" />)
    expect(await screen.findByText('No transactions')).toBeTruthy()
  })

  it('403 shows the permission message, not Retry', async () => {
    impl = (async () => { throw new Error('Request failed (403)') })
    render(<TransactionsPanel userId="u1" />)
    expect(await screen.findByText(/don.t have permission/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('error shows message and Retry re-fetches', async () => {
    let calls = 0
    impl = (async () => {
      if (calls++ === 0) throw new Error('boom')
      return page([row('a')], 1)
    })
    render(<TransactionsPanel userId="u1" />)
    expect(await screen.findByText('boom')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('desc-a')
    expect(mockList).toHaveBeenCalledTimes(2)
  })

  it('each row links to /admin/finance/transactions/<id>', async () => {
    setResult(page([row('tx-1'), row('tx-2', { type: 'REVERSAL_DEBIT' })], 2))
    render(<TransactionsPanel userId="u1" />)
    await screen.findByText('desc-tx-1')
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/admin/finance/transactions/tx-1')
    expect(hrefs).toContain('/admin/finance/transactions/tx-2')
    expect(screen.getByRole('link', { name: 'REVERSAL_DEBIT' })).toBeTruthy()
  })

  it('type filter re-queries with type and resets offset to 0', async () => {
    setResult(page([row('a')], 60))
    render(<TransactionsPanel userId="u1" />)
    await screen.findByText('desc-a')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 })))
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'DEBIT' } })
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'DEBIT', offset: 0, user_id: 'u1' })),
    )
  })

  it('userId change: a slow response for the old user does not overwrite the new user\'s rows', async () => {
    const pending: Record<string, (v: unknown) => void> = {}
    impl = (f) =>
      new Promise((resolve) => {
        pending[String(f.user_id)] = resolve
      })
    const { rerender } = render(<TransactionsPanel userId="A" />)
    await waitFor(() => expect(pending.A).toBeTruthy())
    rerender(<TransactionsPanel userId="B" />)
    await waitFor(() => expect(pending.B).toBeTruthy())
    pending.B(page([row('b1')], 1))
    await screen.findByText('desc-b1')
    pending.A(page([row('a1')], 1))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('desc-a1')).toBeNull()
    expect(screen.getByText('desc-b1')).toBeTruthy()
  })

  it('userId change resets the page to offset 0', async () => {
    setResult(page([row('a')], 60))
    const { rerender } = render(<TransactionsPanel userId="A" />)
    await screen.findByText('desc-a')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: 'A', offset: 25 })))
    mockList.mockClear()
    rerender(<TransactionsPanel userId="B" />)
    await waitFor(() => expect(mockList).toHaveBeenCalled())
    expect(mockList).toHaveBeenCalledTimes(1)
    expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: 'B', offset: 0 }))
  })
})
