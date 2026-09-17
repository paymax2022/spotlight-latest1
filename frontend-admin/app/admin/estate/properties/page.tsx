'use client';

// A-EST-13 — Property management (Block 29, PROPMGMT-004). Unit registry with
// landlord/tenant assignment, occupancy/archive actions, and the transfer-request
// review queue (approve/reject). Estate-admin scoped: backend/internal/estate
// property_mgmt.go's assertEstateAdmin gates every mutating call on the
// pinned estateId()'s estate_residents.role, same as residents/vendors/dues.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listProperties, listResidents, listTransferRequests,
  assignLandlord, assignTenant, updatePropertyOccupancy, archiveProperty,
  reviewTransferRequest,
} from '@/services/estateAdminService';
import type { AdminProperty, AdminResident, OccupancyStatus, PropertyTransferRequest } from '@/types/estateAdmin';
import { EstateTabs, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const OCCUPANCY_OPTIONS: OccupancyStatus[] = ['vacant', 'occupied', 'reserved'];

// AssignLandlord/AssignTenant write landlord_id/tenant_id as an auth user id
// (they match property_transfer_requests.to_user_id and estate_residents.user_id
// elsewhere). listResidents()'s live payload is `{id, user_id, unit, role,
// banned, deleted, created_at}` — AdminResident.id is the estate_residents ROW
// id, not the user id — so an option keyed on r.id would assign the wrong
// value. Read the real user id defensively; the mock fixture has no separate
// user_id field and uses its own `id` consistently as the user reference, so
// falling back to r.id there is correct.
function residentUserId(r: AdminResident): string {
  return (r as unknown as { user_id?: string; userId?: string }).userId
    ?? (r as unknown as { user_id?: string }).user_id
    ?? r.id;
}
function residentLabel(r: AdminResident): string {
  return r.name || r.unit || residentUserId(r);
}

function occupancyColor(s: string): string {
  if (s === 'occupied') return colors.success;
  if (s === 'reserved') return colors.warning;
  return colors.secondary;
}

// Small inline "assign user" control: a select populated from the residents
// registry (so an admin picks a real resident, not a raw UUID) plus a free-text
// fallback for a user id not yet in the registry.
function AssignControl({
  residents, current, onAssign, disabled,
}: { residents: AdminResident[]; current: string | null; onAssign: (userId: string) => void; disabled: boolean }) {
  const [value, setValue] = useState(current ?? '');
  useEffect(() => setValue(current ?? ''), [current]);
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        style={{ padding: '0.3rem 0.4rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.78rem', minWidth: 140 }}
      >
        <option value="">— none —</option>
        {residents.map((r) => (
          <option key={r.id} value={residentUserId(r)}>{residentLabel(r)}</option>
        ))}
      </select>
      <Button variant="outline" sm disabled={disabled || !value || value === current} onClick={() => onAssign(value)}>Set</Button>
    </div>
  );
}

export default function PropertiesPage() {
  const [properties, setProperties] = useState<AdminProperty[]>([]);
  const [residents, setResidents] = useState<AdminResident[]>([]);
  const [transfers, setTransfers] = useState<PropertyTransferRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [props, res, tr] = await Promise.all([
        listProperties(), listResidents(), listTransferRequests('pending'),
      ]);
      setProperties(props); setResidents(res); setTransfers(tr);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const nameOf = useMemo(() => {
    const m = new Map(residents.map((r) => [residentUserId(r), residentLabel(r)] as const));
    return (id: string | null) => (id ? m.get(id) ?? id : '—');
  }, [residents]);
  const unitOf = useMemo(() => {
    const m = new Map(properties.map((p) => [p.id, `${p.block ? `Block ${p.block} · ` : ''}${p.unitLabel}`] as const));
    return (id: string) => m.get(id) ?? id;
  }, [properties]);

  async function doAssignLandlord(propertyId: string, userId: string) {
    setBusy(propertyId);
    try {
      const updated = await assignLandlord(propertyId, userId);
      setProperties((ps) => ps.map((p) => (p.id === propertyId ? updated : p)));
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }
  async function doAssignTenant(propertyId: string, userId: string) {
    setBusy(propertyId);
    try {
      const updated = await assignTenant(propertyId, userId);
      setProperties((ps) => ps.map((p) => (p.id === propertyId ? updated : p)));
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }
  async function doOccupancy(propertyId: string, status: OccupancyStatus) {
    setBusy(propertyId);
    try {
      const updated = await updatePropertyOccupancy(propertyId, status);
      setProperties((ps) => ps.map((p) => (p.id === propertyId ? updated : p)));
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }
  async function doArchive(propertyId: string) {
    setBusy(propertyId);
    try {
      await archiveProperty(propertyId);
      // Backend's ListProperties excludes archived=TRUE, so it never reappears.
      setProperties((ps) => ps.filter((p) => p.id !== propertyId));
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }
  async function doReview(requestId: string, decision: 'approved' | 'rejected') {
    setBusy(requestId);
    try {
      const updated = await reviewTransferRequest(requestId, decision);
      setTransfers((ts) => ts.filter((t) => t.id !== requestId));
      if (decision === 'approved') {
        // Reflect the real landlord/tenant re-assignment immediately.
        setProperties((ps) => ps.map((p) => {
          if (p.id !== updated.propertyId) return p;
          return updated.transferType === 'ownership'
            ? { ...p, landlordId: updated.toUserId }
            : { ...p, tenantId: updated.toUserId, occupancyStatus: 'occupied' };
        }));
      }
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader
        title="Properties"
        subtitle="Unit registry, landlord/tenant assignment, occupancy, and transfer-request review (Block 29)."
        actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>}
      />
      <EstateTabs active="properties" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card title="Transfer requests awaiting review" style={{ marginBottom: '1.25rem' }}>
        {loading ? <p style={{ color: colors.muted }}>Loading…</p> : transfers.length === 0 ? (
          <p style={{ color: colors.muted }}>No pending transfer requests.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thCell}>Property</th>
                <th style={thCell}>Type</th>
                <th style={thCell}>Requested by</th>
                <th style={thCell}>Proposed to</th>
                <th style={thCell}>Reason</th>
                <th style={thCell}>Filed</th>
                <th style={thCell}>Decision</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id}>
                  <td style={tdCell}>{unitOf(t.propertyId)}</td>
                  <td style={tdCell}><Badge text={t.transferType === 'ownership' ? 'Ownership' : 'Tenancy'} color={t.transferType === 'ownership' ? colors.info : colors.primary} /></td>
                  <td style={tdCell}>{nameOf(t.requestedBy)}</td>
                  <td style={tdCell}><strong>{nameOf(t.toUserId)}</strong></td>
                  <td style={tdCell}>{t.reason || '—'}</td>
                  <td style={tdCell}>{timeAgo(t.createdAt)}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button variant="primary" sm disabled={busy === t.id} onClick={() => void doReview(t.id, 'approved')}>Approve</Button>
                      <Button variant="danger" sm disabled={busy === t.id} onClick={() => void doReview(t.id, 'rejected')}>Reject</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Properties">
        {loading ? <p style={{ color: colors.muted }}>Loading properties…</p> : properties.length === 0 ? (
          <p style={{ color: colors.muted }}>No properties in this estate.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thCell}>Unit</th>
                <th style={thCell}>Type</th>
                <th style={thCell}>Floor / Block</th>
                <th style={thCell}>Occupancy</th>
                <th style={thCell}>Landlord</th>
                <th style={thCell}>Tenant</th>
                <th style={thCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => (
                <tr key={p.id}>
                  <td style={tdCell}><strong>{p.unitLabel}</strong></td>
                  <td style={tdCell}><Badge text={cap(p.propertyType)} /></td>
                  <td style={tdCell}>{p.floor || '—'} / {p.block || '—'}</td>
                  <td style={tdCell}>
                    <select
                      value={p.occupancyStatus}
                      disabled={busy === p.id}
                      onChange={(e) => void doOccupancy(p.id, e.target.value as OccupancyStatus)}
                      style={{ padding: '0.25rem 0.35rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.78rem' }}
                    >
                      {OCCUPANCY_OPTIONS.map((o) => <option key={o} value={o}>{cap(o)}</option>)}
                    </select>
                    {' '}
                    <Badge text={cap(p.occupancyStatus)} color={occupancyColor(p.occupancyStatus)} />
                  </td>
                  <td style={tdCell}>
                    <div style={{ marginBottom: 4, fontSize: '0.8rem' }}>{nameOf(p.landlordId)}</div>
                    <AssignControl residents={residents} current={p.landlordId} disabled={busy === p.id} onAssign={(uid) => void doAssignLandlord(p.id, uid)} />
                  </td>
                  <td style={tdCell}>
                    <div style={{ marginBottom: 4, fontSize: '0.8rem' }}>{nameOf(p.tenantId)}</div>
                    <AssignControl residents={residents} current={p.tenantId} disabled={busy === p.id} onAssign={(uid) => void doAssignTenant(p.id, uid)} />
                  </td>
                  <td style={tdCell}>
                    <Button variant="danger" sm disabled={busy === p.id} onClick={() => void doArchive(p.id)}>Archive</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
