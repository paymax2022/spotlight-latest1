'use client';

// All-associations list. Until this page existed the ONLY way to reach an
// organisation from the console was the <select> in <OrgPicker/> — a control
// that shows a name and a member count and nothing else, cannot be sorted or
// filtered beyond a name substring, and has no notion of a second page. The
// backend's GET /admin/organisations grew ?limit/&offset for exactly this.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  listAdminOrganisations, setSelectedOrgId,
  type AdminOrgOption,
} from '@/services/associationAdminService';
import {
  AssociationTabs, DisclosureNote, StateBlock, FilterBar, fmtDate,
  useAssociationPermissions, ASSOCIATION_PERMS, PermissionBanner,
} from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const PAGE_SIZES = [25, 50, 100];
type TriState = '' | 'yes' | 'no';

function statusColor(status: string) {
  const s = (status || '').toUpperCase();
  if (s === 'ACTIVE') return colors.success;
  if (s === 'SUSPENDED') return colors.danger;
  return colors.warning;
}

export default function AssociationOrganisationsPage() {
  const { can } = useAssociationPermissions();
  const canView = can(ASSOCIATION_PERMS.view);

  // The list endpoint now returns every column this table renders, so there is
  // no per-row detail fetch: this page used to issue one
  // GET /admin/organisations/:id per visible row to fill acronym, category,
  // status and createdAt.
  const [rows, setRows] = useState<AdminOrgOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [published, setPublished] = useState<TriState>('');
  const [verified, setVerified] = useState<TriState>('');
  const [limit, setLimit] = useState(PAGE_SIZES[0]);
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await listAdminOrganisations(applied || undefined, {
        limit,
        offset,
        published: published === '' ? undefined : published === 'yes',
        verified: verified === '' ? undefined : verified === 'yes',
      }));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally { setLoading(false); }
  }, [applied, limit, offset, published, verified]);

  useEffect(() => { void load(); }, [load]);

  function apply() { setOffset(0); setApplied(search.trim()); }

  // published/verified are applied by the QUERY (see load), not after the fact,
  // so a filtered page can no longer come back empty merely because the
  // matching rows happened to sit on another page.
  const visible = rows;

  return (
    <Page>
      <PageHeader
        title="Organisations"
        subtitle="Every association on the platform. Open one to edit its identity, verification and publication state, chapters, committees, dues tiers and rules."
        actions={<Button variant="outline" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>}
      />
      <AssociationTabs active="organisations" />

      <DisclosureNote>
        Backed by <code>GET /api/finance/associations/admin/organisations</code>, paged via <code>limit</code>/<code>offset</code>.
        Search, published and verified are all applied by the backend query, and every column shown here comes from that
        single request.
      </DisclosureNote>

      {!canView && <PermissionBanner text="You have read-only access — your role can view organisations but cannot change them." />}

      <FilterBar>
        <div style={{ minWidth: 240 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Search (name)</label>
          <Input placeholder="e.g. Traders" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Published</label>
          <select value={published} onChange={(e) => setPublished(e.target.value as TriState)} style={selectStyle}>
            <option value="">All</option><option value="yes">Published</option><option value="no">Unpublished</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Verified</label>
          <select value={verified} onChange={(e) => setVerified(e.target.value as TriState)} style={selectStyle}>
            <option value="">All</option><option value="yes">Verified</option><option value="no">Unverified</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Per page</label>
          <select value={limit} onChange={(e) => { setOffset(0); setLimit(Number(e.target.value)); }} style={selectStyle}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <Button variant="outline" onClick={apply}>Apply</Button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={visible.length === 0} emptyText="No organisations match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>
              <th style={thCell}>Name</th><th style={thCell}>Acronym</th><th style={thCell}>Category</th>
              <th style={thCell}>Members</th><th style={thCell}>Published</th><th style={thCell}>Verified</th>
              <th style={thCell}>Status</th><th style={thCell}>Created</th><th style={thCell}></th>
            </tr></thead>
            <tbody>
              {visible.map((o) => (
                  <tr key={o.id}>
                    <td style={tdCell}>
                      <Link href={`/admin/association/organisations/${o.id}`} style={{ fontWeight: 600, color: colors.primary }}>{o.name}</Link>
                    </td>
                    <td style={tdCell}>{o.acronym || '—'}</td>
                    <td style={tdCell}>{o.category || '—'}</td>
                    <td style={tdCell}>{o.memberCount.toLocaleString('en-NG')}</td>
                    <td style={tdCell}><Badge text={o.published ? 'Published' : 'Draft'} color={o.published ? colors.success : colors.muted} /></td>
                    <td style={tdCell}><Badge text={o.verified ? 'Verified' : 'Unverified'} color={o.verified ? colors.success : colors.warning} /></td>
                    <td style={tdCell}><Badge text={o.status} color={statusColor(o.status)} /></td>
                    <td style={tdCell}>{fmtDate(o.createdAt)}</td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap' }}>
                        <Link href={`/admin/association/organisations/${o.id}`} style={{ fontSize: '0.8rem', color: colors.primary }}>Manage →</Link>
                        <button
                          type="button"
                          onClick={() => setSelectedOrgId(o.id)}
                          title="Scope the rest of the association console (approvals, dues, members) to this organisation"
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.8rem', color: colors.muted, textDecoration: 'underline' }}
                        >Set active</button>
                      </div>
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
          <Button variant="outline" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - limit))}>← Previous</Button>
          <span style={{ fontSize: '0.8rem', color: colors.muted }}>
            {rows.length === 0 ? 'No rows' : `Rows ${offset + 1}–${offset + rows.length}`}
            {visible.length !== rows.length ? ` · ${visible.length} shown after filters` : ''}
          </span>
          {/* No total count is returned, so "there is a next page" can only be
              inferred from a full page of rows. */}
          <Button variant="outline" disabled={rows.length < limit || loading} onClick={() => setOffset(offset + limit)}>Next →</Button>
        </div>
      </Card>
    </Page>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '0.45rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
  fontSize: '0.85rem', background: colors.card, cursor: 'pointer',
};
