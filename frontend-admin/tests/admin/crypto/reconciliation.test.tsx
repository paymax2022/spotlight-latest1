import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReconciliationReport, OrderReconciliationRow } from '@/lib/api';

const mockFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  fetchReconciliation: (...a: unknown[]) => mockFetch(...a),
}));

import ReconciliationPage from '../../../app/admin/crypto/reconciliation';

function row(over: Partial<OrderReconciliationRow> = {}): OrderReconciliationRow {
  return {
    order_id: 'ord_1', user_id: 'user_1', status: 'completed', ledger_settled: true,
    swap_transaction_id: 'qtx_1', provider_status: 'completed',
    settled_at: '2026-10-28T11:00:00Z', ...over,
  };
}
function report(orders: OrderReconciliationRow[], over: Partial<ReconciliationReport> = {}): ReconciliationReport {
  return {
    run_at: '2026-10-28T12:00:00Z', total_orders: 100, reconcilled_orders: 95,
    drift_orders: 4, failed_orders: 1, orders, summary: 's', ...over,
  };
}

beforeEach(() => { mockFetch.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ReconciliationPage layout', () => {
  it('renders summary cards: total, reconcilled, drift, failed', async () => {
    mockFetch.mockResolvedValue(report([]));
    render(<ReconciliationPage />);
    await waitFor(() => {
      expect(screen.getByText('Total Orders')).toBeInTheDocument();
      expect(screen.getByTestId('card-total')).toHaveTextContent('100');
      expect(screen.getByTestId('card-reconcilled')).toHaveTextContent('95');
      expect(screen.getByTestId('card-drift')).toHaveTextContent('4');
      expect(screen.getByTestId('card-failed')).toHaveTextContent('1');
    });
  });

  it('renders date range inputs and auto-refresh toggle', async () => {
    mockFetch.mockResolvedValue(report([]));
    render(<ReconciliationPage />);
    expect(screen.getByLabelText(/Start Date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/End Date/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Auto-refresh/ })).toBeInTheDocument();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  });

  it('requests details=true with ISO date range and refetches when range changes', async () => {
    mockFetch.mockResolvedValue(report([]));
    render(<ReconciliationPage />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const arg = mockFetch.mock.calls[0][0];
    expect(arg.details).toBe(true);
    expect(arg.start_date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    fireEvent.change(screen.getByLabelText(/Start Date/), { target: { value: '2026-10-01T00:00' } });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch.mock.calls[1][0].start_date).toMatch(/^2026-(09-30|10-0)/);
  });

  it('auto-refreshes every 30s when toggled on', async () => {
    mockFetch.mockResolvedValue(report([]));
    render(<ReconciliationPage />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('checkbox', { name: /Auto-refresh/ }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('shows an error when the fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    render(<ReconciliationPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('boom'));
  });
});

describe('ReconTable', () => {
  const orders = [
    row({ order_id: 'ord_ok' }),
    row({ order_id: 'ord_exec', status: 'executing', ledger_settled: false, settled_at: undefined, provider_status: 'pending' }),
    row({ order_id: 'ord_drift', ledger_settled: false, drift: 'completed but not ledger_settled (settlement lag)' }),
    row({ order_id: 'ord_fail', status: 'failed', ledger_settled: false, provider_status: 'failed' }),
  ];

  it('renders rows with drift text', async () => {
    mockFetch.mockResolvedValue(report(orders));
    render(<ReconciliationPage />);
    await waitFor(() => expect(screen.getByText('ord_drift')).toBeInTheDocument());
    expect(screen.getByText(/settlement lag/)).toBeInTheDocument();
  });

  it('color codes rows: green, yellow, orange, red', async () => {
    mockFetch.mockResolvedValue(report(orders));
    render(<ReconciliationPage />);
    await waitFor(() => expect(screen.getByText('ord_ok')).toBeInTheDocument());
    const tone = (id: string) => screen.getByText(id).closest('tr')!.getAttribute('data-tone');
    expect(tone('ord_ok')).toBe('green');
    expect(tone('ord_exec')).toBe('yellow');
    expect(tone('ord_drift')).toBe('orange');
    expect(tone('ord_fail')).toBe('red');
  });

  it('sorts ascending then descending when a header is clicked', async () => {
    mockFetch.mockResolvedValue(report(orders));
    render(<ReconciliationPage />);
    await waitFor(() => expect(screen.getByText('ord_ok')).toBeInTheDocument());
    const ids = () => screen.getAllByTestId('recon-row').map((r) => r.getAttribute('data-order-id'));
    const header = screen.getByRole('columnheader', { name: /OrderID/ });
    fireEvent.click(header.querySelector('button')!);
    expect(ids()).toEqual(['ord_drift', 'ord_exec', 'ord_fail', 'ord_ok']);
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(header.querySelector('button')!);
    expect(ids()).toEqual(['ord_ok', 'ord_fail', 'ord_exec', 'ord_drift']);
    expect(header).toHaveAttribute('aria-sort', 'descending');
  });

  it('expands an order detail panel on row click with settlement time and drift note', async () => {
    mockFetch.mockResolvedValue(report(orders));
    render(<ReconciliationPage />);
    await waitFor(() => expect(screen.getByText('ord_drift')).toBeInTheDocument());
    expect(screen.queryByTestId('order-detail')).toBeNull();
    fireEvent.click(screen.getByText('ord_drift'));
    const panel = screen.getByTestId('order-detail');
    expect(within(panel).getByText(/Ledger entries/i)).toBeInTheDocument();
    expect(within(panel).getByText(/Settled at/i)).toBeInTheDocument();
    const note = within(panel).getByLabelText(/Drift Note/i) as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: 'investigating' } });
    expect(note.value).toBe('investigating');
    fireEvent.click(screen.getAllByTestId('recon-row')[2]);
    expect(screen.queryByTestId('order-detail')).toBeNull();
  });
});
