'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { searchAudit } from '@/services/cryptoOpsService';
import type { CryptoAuditEntry, CryptoAuditFilter } from '@/types/cryptoAdmin';
import { CryptoTabs, StateBlock, DisclosureNote, FilterBar, fmtDate, label as lbl, input as inputStyle, select as selectStyle, mono } from '../_ui';
import { Page, PageHeader, Button, Card, colors, thCell, tdCell } from '@/components/ui/vuexy';

// Audit-log search (workplan QDX-ADM-015/016): the append-only crypto_audit_log, newest first,
// filtered on the server and paged with a created_at cursor so rows that arrive while you page
// are never skipped or shown twice.

const ACTION_PRESETS: { value: string; label: string }[] = [
  { value: '', label: 'All actions' },
  { value: 'crypto.controls', label: 'Controls changes' },
  { value: 'crypto.fee_schedule', label: 'Fee changes' },
  { value: 'crypto.swap.admin', label: 'Admin swap decisions' },
  { value: 'crypto.swap', label: 'Swap lifecycle' },
  { value: 'crypto.deposit', label: 'Deposits' },
  { value: 'crypto.reconciler', label: 'Manual syncs' },
];

const PAGE = 100;

function Json({ value }: { value: unknown }) {
  if (value == null) return <span style={{ color: colors.muted }}>—</span>;
  return <pre style={{ ...mono(), margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflow: 'auto' }}>{JSON.stringify(value, null, 2)}</pre>;
}

export default function CryptoAuditPage() {
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [entity, setEntity] = useState('');
  const [rows, setRows] = useState<CryptoAuditEntry[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const fetchPage = useCallback(async (f: CryptoAuditFilter, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const page = await searchAudit({ ...f, limit: PAGE });
      if (!page) { setUnavailable(true); setRows([]); setNext(undefined); return; }
      setUnavailable(false);
      setRows((r) => (append ? [...r, ...page.entries] : page.entries));
      setNext(page.next_before);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  const filter = (): CryptoAuditFilter => ({ action, actor, entity_id: entity });
  useEffect(() => { void fetchPage({}, false); }, [fetchPage]);

  return (
    <Page>
      <PageHeader title="Crypto — Audit log" subtitle="Every money-relevant and configuration action, with who did it, why, and the before and after values." />
      <CryptoTabs active="audit" />
      <DisclosureNote>
        Backed by <code>GET /api/v1/admin/crypto/audit</code>. The log is append-only: entries can&apos;t be edited or deleted from
        anywhere, including here.
      </DisclosureNote>

      <form onSubmit={(e) => { e.preventDefault(); void fetchPage(filter(), false); }}>
        <FilterBar>
          <div style={{ minWidth: 200 }}>
            <label style={lbl()} htmlFor="aud-action">Action</label>
            <select id="aud-action" style={selectStyle()} value={action} onChange={(e) => setAction(e.target.value)}>
              {ACTION_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 220 }}>
            <label style={lbl()} htmlFor="aud-actor">Actor</label>
            <input id="aud-actor" style={inputStyle()} placeholder="User id or system:provider" maxLength={100} value={actor} onChange={(e) => setActor(e.target.value)} />
          </div>
          <div style={{ minWidth: 220 }}>
            <label style={lbl()} htmlFor="aud-entity">Entity id</label>
            <input id="aud-entity" style={inputStyle()} placeholder="Swap, deposit or version id" maxLength={100} value={entity} onChange={(e) => setEntity(e.target.value)} />
          </div>
          <Button variant="primary" type="submit" disabled={loading}>Search</Button>
        </FilterBar>
      </form>

      <Card>
        <StateBlock loading={loading && rows.length === 0} error={error} empty={!loading && rows.length === 0}
          emptyText={unavailable ? 'The audit log is unavailable: the swap pipeline is not running on this environment.' : 'No entries match these filters.'}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead><tr>
                <th style={thCell}>When</th><th style={thCell}>Action</th><th style={thCell}>Actor</th><th style={thCell}>Entity</th><th style={thCell}>Reason</th><th style={thCell} />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td style={tdCell}>{fmtDate(r.created_at)}</td>
                      <td style={{ ...tdCell, ...mono() }}>{r.action}</td>
                      <td style={{ ...tdCell, ...mono() }}>{r.actor}</td>
                      <td style={tdCell}>{r.entity_type}{r.entity_id ? <span style={{ ...mono(), color: colors.muted }}> {r.entity_id}</span> : null}</td>
                      <td style={tdCell}>{r.reason || '—'}</td>
                      <td style={tdCell}>
                        {(r.old_value != null || r.new_value != null) && (
                          <Button variant="outline" sm aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Details'}</Button>
                        )}
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr>
                        <td style={tdCell} colSpan={6}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem' }}>
                            <div><div style={lbl()}>Before</div><Json value={r.old_value} /></div>
                            <div><div style={lbl()}>After / detail</div><Json value={r.new_value} /></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {next && (
            <div style={{ marginTop: '0.75rem' }}>
              <Button variant="outline" disabled={loading} onClick={() => void fetchPage({ ...filter(), before: next }, true)}>{loading ? 'Loading…' : 'Load older entries'}</Button>
            </div>
          )}
        </StateBlock>
      </Card>
    </Page>
  );
}
