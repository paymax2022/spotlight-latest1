'use client';

import { useMemo } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

/* ─── Filter chips ──────────────────────────────────────────────────────────── */

export type FilterChip = {
  key: string;
  label: string;
  value: string;
};

/**
 * Renders active filters as dismissible chips. `chips` should be derived from
 * the page's applied filter state, so chips always reflect what's in effect.
 */
export function FilterChips({ chips, onClear, onClearAll }: {
  chips: FilterChip[];
  onClear: (key: string) => void;
  onClearAll?: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 10 }}>
      <span style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Active filters</span>
      {chips.map((c) => (
        <span
          key={c.key}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: tint(colors.primary, 0.1),
            border: `1px solid ${tint(colors.primary, 0.3)}`,
            borderRadius: 999,
            padding: '3px 8px 3px 10px',
            fontSize: 12,
            color: colors.text,
          }}
        >
          <span style={{ color: colors.muted }}>{c.label}:</span>
          <span style={{ fontWeight: 600, color: colors.primary }}>{c.value}</span>
          <button
            type="button"
            aria-label={`Remove ${c.label} filter`}
            onClick={() => onClear(c.key)}
            style={{ background: 'transparent', border: 'none', color: colors.muted, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        </span>
      ))}
      {onClearAll && chips.length > 1 ? (
        <button
          type="button"
          onClick={onClearAll}
          style={{ background: '#fff', border: `1px solid ${colors.inputBorder}`, color: colors.muted, borderRadius: 999, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}

/* ─── Sorting ───────────────────────────────────────────────────────────────── */

export type SortDir = 'asc' | 'desc';
export type SortState<K extends string> = { key: K; dir: SortDir } | null;

export function nextSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return null; // third click clears sort
}

/** Comparator-driven generic sorter that tolerates string/number/boolean/date values. */
export function applySort<T>(rows: T[], sort: SortState<string>, getValue: (row: T, key: string) => unknown): T[] {
  if (!sort) return rows;
  const sorted = [...rows].sort((a, b) => {
    const av = getValue(a, sort.key);
    const bv = getValue(b, sort.key);
    return compareValues(av, bv);
  });
  return sort.dir === 'asc' ? sorted : sorted.reverse();
}

function compareValues(a: unknown, b: unknown): number {
  const an = a === null || a === undefined || a === '';
  const bn = b === null || b === undefined || b === '';
  if (an && bn) return 0;
  if (an) return 1; // empties sort last in asc
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  const as = String(a);
  const bs = String(b);
  const ad = Date.parse(as);
  const bd = Date.parse(bs);
  if (!Number.isNaN(ad) && !Number.isNaN(bd)) return ad - bd;
  return as.localeCompare(bs, undefined, { numeric: true, sensitivity: 'base' });
}

export function SortHeaderButton({ label, active, dir, onClick }: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  const indicator = !active ? '↕' : dir === 'asc' ? '↑' : '↓';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Sort by ${label}${active ? ` (${dir})` : ''}`}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{
        background: 'transparent',
        border: 'none',
        color: active ? colors.primary : colors.muted,
        cursor: 'pointer',
        font: 'inherit',
        fontWeight: 600,
        display: 'inline-flex',
        gap: 4,
        alignItems: 'center',
        padding: 0,
      }}
    >
      {label}
      <span aria-hidden style={{ opacity: active ? 1 : 0.4, fontSize: 11 }}>{indicator}</span>
    </button>
  );
}

/* ─── Pagination ────────────────────────────────────────────────────────────── */

export function usePagination<T>(rows: T[], pageSize: number, page: number) {
  return useMemo(() => {
    const total = rows.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(1, page), pageCount);
    const start = (safePage - 1) * pageSize;
    const slice = rows.slice(start, start + pageSize);
    return { total, pageCount, safePage, start, slice };
  }, [rows, pageSize, page]);
}

export function Pagination({ page, pageCount, total, pageSize, onPage }: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav
      aria-label="Pagination"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14, flexWrap: 'wrap' }}
    >
      <span style={{ fontSize: 12, color: colors.muted }}>
        Showing {from}–{to} of {total}
      </span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <PagerButton label="‹ Prev" disabled={page <= 1} onClick={() => onPage(page - 1)} />
        <span style={{ fontSize: 12, color: colors.text, padding: '0 6px' }}>
          Page {page} / {pageCount}
        </span>
        <PagerButton label="Next ›" disabled={page >= pageCount} onClick={() => onPage(page + 1)} />
      </div>
    </nav>
  );
}

function PagerButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: '#fff',
        color: disabled ? '#b9b9c3' : colors.text,
        border: `1px solid ${colors.inputBorder}`,
        borderRadius: 6,
        padding: '4px 10px',
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {label}
    </button>
  );
}
