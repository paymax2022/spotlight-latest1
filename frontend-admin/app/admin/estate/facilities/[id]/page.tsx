'use client';

// A-EST-12a — Facility detail page. Edit facility info and view bookings.

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { EstateTabs } from '../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

interface Facility {
  id: string;
  estateId: string;
  name: string;
  kind: string;
  capacity?: number;
  feeKobo: number;
}

interface Booking {
  id: string;
  residentId: string;
  residentName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  amountKobo: number;
}

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

function money(kobo: number): string {
  const n = (kobo ?? 0) / 100;
  return `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-NG');
}

function statusColor(status: string): string {
  if (status === 'confirmed') return colors.success;
  if (status === 'pending') return colors.warning;
  if (status === 'cancelled' || status === 'refunded') return colors.danger;
  return colors.secondary;
}

export default function FacilityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const facilityId = params.id as string;

  const [facility, setFacility] = useState<Facility | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({ name: '', capacity: '', feeKobo: '' });
  const [submitting, setSubmitting] = useState(false);

  async function loadFacility() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}`);
      if (!res.ok) throw new Error(`Failed to load facility: ${res.status}`);
      const data = await res.json();
      setFacility(data);
      setEditData({
        name: data.name,
        capacity: data.capacity?.toString() || '',
        feeKobo: (data.feeKobo / 100).toString(),
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadBookings() {
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/bookings`);
      if (res.ok) {
        const data = await res.json();
        setBookings(data);
      }
    } catch (e) {
      console.error('Failed to load bookings:', e);
    }
  }

  useEffect(() => {
    loadFacility();
    loadBookings();
  }, [facilityId]);

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editData.name,
          capacity: editData.capacity ? parseInt(editData.capacity) : null,
          feeKobo: parseInt((parseFloat(editData.feeKobo || '0') * 100).toString()),
        }),
      });
      if (!res.ok) throw new Error(`Failed to update facility: ${res.status}`);
      const updated = await res.json();
      setFacility(updated);
      setEditing(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Facility details"
        subtitle="View and manage facility information and bookings"
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button variant="outline" sm onClick={() => router.back()}>Back</Button>
          </div>
        }
      />
      <EstateTabs active="facilities" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading ? (
        <p style={{ color: colors.muted }}>Loading facility…</p>
      ) : !facility ? (
        <p style={{ color: colors.danger }}>Facility not found</p>
      ) : (
        <>
          <Card title="Facility information" right={<Button variant="outline" sm onClick={() => setEditing(!editing)}>{editing ? 'Cancel' : 'Edit'}</Button>}>
            {editing ? (
              <form onSubmit={handleUpdate} style={{ display: 'grid', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Name</label>
                  <input
                    type="text"
                    value={editData.name}
                    onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: `1px solid ${colors.inputBorder}`,
                      borderRadius: '0.375rem',
                      fontSize: '0.85rem',
                    }}
                    required
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Capacity</label>
                    <input
                      type="number"
                      value={editData.capacity}
                      onChange={(e) => setEditData({ ...editData, capacity: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: `1px solid ${colors.inputBorder}`,
                        borderRadius: '0.375rem',
                        fontSize: '0.85rem',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Booking Fee (₦)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editData.feeKobo}
                      onChange={(e) => setEditData({ ...editData, feeKobo: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: `1px solid ${colors.inputBorder}`,
                        borderRadius: '0.375rem',
                        fontSize: '0.85rem',
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <Button variant="outline" sm onClick={() => setEditing(false)}>Cancel</Button>
                  <Button variant="primary" sm type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
                </div>
              </form>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div>
                  <p style={{ color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: '0.25rem' }}>Name</p>
                  <p style={{ fontSize: '1rem', fontWeight: 600 }}>{facility.name}</p>
                </div>
                <div>
                  <p style={{ color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: '0.25rem' }}>Type</p>
                  <p><Badge status={facility.kind} label={cap(facility.kind)} /></p>
                </div>
                <div>
                  <p style={{ color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: '0.25rem' }}>Capacity</p>
                  <p style={{ fontSize: '1rem', fontWeight: 600 }}>{facility.capacity ? `${facility.capacity} people` : 'Unlimited'}</p>
                </div>
                <div>
                  <p style={{ color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: '0.25rem' }}>Booking Fee</p>
                  <p style={{ fontSize: '1rem', fontWeight: 600 }}>{money(facility.feeKobo)}</p>
                </div>
              </div>
            )}
          </Card>

          <Card title="Recent bookings" right={<Button variant="outline" sm onClick={loadBookings}>Refresh</Button>}>
            {bookings.length === 0 ? (
              <p style={{ color: colors.muted }}>No bookings yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thCell}>Resident</th>
                    <th style={thCell}>Booked from</th>
                    <th style={thCell}>Booked to</th>
                    <th style={thCell}>Amount</th>
                    <th style={thCell}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id}>
                      <td style={tdCell}>{b.residentName}</td>
                      <td style={tdCell}>{formatDate(b.startsAt)}</td>
                      <td style={tdCell}>{formatDate(b.endsAt)}</td>
                      <td style={tdCell}>{money(b.amountKobo)}</td>
                      <td style={tdCell}><Badge status={b.status} label={cap(b.status)} color={statusColor(b.status)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
