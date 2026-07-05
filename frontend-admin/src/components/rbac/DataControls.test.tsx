/**
 * Tests for usePagination hook and Pagination component from DataControls.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { render, screen, fireEvent } from '@testing-library/react'
import { usePagination, Pagination } from './DataControls'

// ---------------------------------------------------------------------------
// usePagination
// ---------------------------------------------------------------------------

const makeItems = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

describe('usePagination', () => {
  it('returns all 10 items on page 1 when pageSize=10', () => {
    const items = makeItems(25)
    const { result } = renderHook(() => usePagination(items, 10, 1))
    expect(result.current.slice).toHaveLength(10)
    expect(result.current.slice[0]).toBe(1)
    expect(result.current.total).toBe(25)
    expect(result.current.pageCount).toBe(3)
  })

  it('returns remaining 5 items on page 3', () => {
    const items = makeItems(25)
    const { result } = renderHook(() => usePagination(items, 10, 3))
    expect(result.current.slice).toHaveLength(5)
    expect(result.current.slice[0]).toBe(21)
  })

  it('clamps page to valid range (page > pageCount)', () => {
    const items = makeItems(5)
    const { result } = renderHook(() => usePagination(items, 10, 99))
    expect(result.current.safePage).toBe(1)
    expect(result.current.slice).toHaveLength(5)
  })

  it('returns 1 page for empty array', () => {
    const { result } = renderHook(() => usePagination([], 10, 1))
    expect(result.current.pageCount).toBe(1)
    expect(result.current.slice).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Pagination component
// ---------------------------------------------------------------------------

describe('Pagination component', () => {
  it('renders page info and nav buttons', () => {
    const onPage = vi.fn()
    render(
      <Pagination page={2} pageCount={5} total={50} pageSize={10} onPage={onPage} />,
    )
    expect(screen.getByText(/Showing 11–20 of 50/)).toBeTruthy()
    expect(screen.getByText('Page 2 / 5')).toBeTruthy()
  })

  it('calls onPage with page-1 when Prev is clicked', () => {
    const onPage = vi.fn()
    render(
      <Pagination page={3} pageCount={5} total={50} pageSize={10} onPage={onPage} />,
    )
    fireEvent.click(screen.getByText(/Prev/))
    expect(onPage).toHaveBeenCalledWith(2)
  })

  it('calls onPage with page+1 when Next is clicked', () => {
    const onPage = vi.fn()
    render(
      <Pagination page={3} pageCount={5} total={50} pageSize={10} onPage={onPage} />,
    )
    fireEvent.click(screen.getByText(/Next/))
    expect(onPage).toHaveBeenCalledWith(4)
  })

  it('disables Prev button on first page', () => {
    const onPage = vi.fn()
    render(
      <Pagination page={1} pageCount={3} total={30} pageSize={10} onPage={onPage} />,
    )
    const prev = screen.getByText(/Prev/).closest('button') as HTMLButtonElement
    expect(prev.disabled).toBe(true)
  })

  it('disables Next button on last page', () => {
    const onPage = vi.fn()
    render(
      <Pagination page={3} pageCount={3} total={30} pageSize={10} onPage={onPage} />,
    )
    const next = screen.getByText(/Next/).closest('button') as HTMLButtonElement
    expect(next.disabled).toBe(true)
  })

  it('renders nothing when total is 0', () => {
    const onPage = vi.fn()
    const { container } = render(
      <Pagination page={1} pageCount={1} total={0} pageSize={10} onPage={onPage} />,
    )
    expect(container.firstChild).toBeNull()
  })
})
