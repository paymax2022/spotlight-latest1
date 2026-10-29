'use client';

import { Fragment, useMemo, useState } from 'react';
import type { OrderReconciliationRow } from '@/lib/api';
import OrderDetail from './OrderDetail';

type Tone = 'green' | 'yellow' | 'orange' | 'red';

export function rowTone(r: OrderReconciliationRow): Tone {
  const s = r.status.toLowerCase();
  if (s === 'failed' || s === 'error') return 'red';
  if (r.drift) return 'orange';
  if (s === 'executing' || s === 'processing' || s === 'pending') return 'yellow';
  return 'green';
}

const TONE_CLASS: Record<Tone, string> = {
  green: 'bg-green-50',
  yellow: 'bg-yellow-50',
  orange: 'bg-orange-100',
  red: 'bg-red-100',
};

type Key = 'order_id' | 'user_id' | 'status' | 'ledger_settled' | 'provider_status' | 'settled_at' | 'drift';
const COLS: { key: Key; label: string }[] = [
  { key: 'order_id', label: 'OrderID' },
  { key: 'user_id', label: 'UserID' },
  { key: 'status', label: 'Status' },
  { key: 'ledger_settled', label: 'LedgerSettled' },
  { key: 'provider_status', label: 'ProviderStatus' },
  { key: 'settled_at', label: 'SettledAt' },
  { key: 'drift', label: 'Drift' },
];

function cmp(a: OrderReconciliationRow, b: OrderReconciliationRow, key: Key): number {
  const av = a[key] ?? '';
  const bv = b[key] ?? '';
  if (typeof av === 'boolean' || typeof bv === 'boolean') return Number(av) - Number(bv);
  return String(av).localeCompare(String(bv));
}

export default function ReconTable({ orders }: { orders: OrderReconciliationRow[] }) {
  const [sort, setSort] = useState<{ key: Key; dir: 'asc' | 'desc' } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!sort) return orders;
    const out = [...orders].sort((a, b) => cmp(a, b, sort.key));
    return sort.dir === 'desc' ? out.reverse() : out;
  }, [orders, sort]);

  const toggleSort = (key: Key) =>
    setSort((s) => (s && s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  if (orders.length === 0) return <p className="text-gray-500">No orders in this range.</p>;

  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr>
          {COLS.map((c) => (
            <th
              key={c.key}
              scope="col"
              aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              className="border-b px-2 py-2"
            >
              <button type="button" onClick={() => toggleSort(c.key)} className="font-semibold">
                {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' (asc)' : ' (desc)') : ''}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const tone = rowTone(r);
          const open = selected === r.order_id;
          return (
            <Fragment key={r.order_id}>
              <tr
                data-testid="recon-row"
                data-order-id={r.order_id}
                data-tone={tone}
                onClick={() => setSelected(open ? null : r.order_id)}
                className={`cursor-pointer border-b ${TONE_CLASS[tone]}`}
              >
                <td className="px-2 py-2">{r.order_id}</td>
                <td className="px-2 py-2">{r.user_id}</td>
                <td className="px-2 py-2">{r.status}</td>
                <td className="px-2 py-2">{r.ledger_settled ? 'Yes' : 'No'}</td>
                <td className="px-2 py-2">{r.provider_status}</td>
                <td className="px-2 py-2">{r.settled_at ? new Date(r.settled_at).toLocaleString() : '-'}</td>
                <td className="px-2 py-2">{r.drift ?? '-'}</td>
              </tr>
              {open && (
                <tr>
                  <td colSpan={COLS.length} className="px-2 py-2"><OrderDetail order={r} /></td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
