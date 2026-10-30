'use client';

import { useState } from 'react';
import type { OrderReconciliationRow } from '@/lib/api';

export default function OrderDetail({ order }: { order: OrderReconciliationRow }) {
  const [note, setNote] = useState('');
  const noteId = `drift-note-${order.order_id}`;
  return (
    <div data-testid="order-detail" className="rounded border border-gray-200 bg-white p-4 text-sm">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
        <div><dt className="text-gray-500">Order</dt><dd>{order.order_id}</dd></div>
        <div><dt className="text-gray-500">User</dt><dd>{order.user_id}</dd></div>
        <div><dt className="text-gray-500">Swap transaction</dt><dd>{order.swap_transaction_id || '-'}</dd></div>
        <div><dt className="text-gray-500">Order status</dt><dd>{order.status}</dd></div>
        <div><dt className="text-gray-500">Provider status</dt><dd>{order.provider_status || '-'}</dd></div>
        <div>
          <dt className="text-gray-500">Settled at</dt>
          <dd>{order.settled_at ? new Date(order.settled_at).toLocaleString() : 'Not settled'}</dd>
        </div>
      </dl>

      <section className="mt-3">
        <h4 className="font-medium">Ledger entries</h4>
        <p className="text-gray-600">
          Ledger settlement: {order.ledger_settled ? 'settled (balanced debit/credit legs posted)' : 'not settled'}.
          {' '}Per-leg entries are not included in the reconciliation report payload.
        </p>
      </section>

      {order.drift && (
        <section className="mt-3">
          <h4 className="font-medium">Drift</h4>
          <p className="text-orange-700">{order.drift}</p>
        </section>
      )}

      <div className="mt-3">
        <label htmlFor={noteId} className="block font-medium">Drift Note</label>
        <textarea
          id={noteId}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Admin audit note (kept in this session; not yet persisted)"
          className="mt-1 w-full rounded border border-gray-300 p-2"
        />
      </div>
    </div>
  );
}
