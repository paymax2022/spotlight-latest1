'use client';

// A-EST-12 — Facilities management. Create, edit, and view estate facilities (pools, gyms, etc.)

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EstateTabs } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

interface Facility {
  id: string;
  estateId: string;
  name: string;
  kind: string;
  capacity?: number;
  feeKobo: number;
}

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

function money(kobo: number): string {
  const n = (kobo ?? 0) / 100;
  return `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FacilitiesPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', kind: '', capacity: '', feeKobo: '' });
  const [submitting, setSubmitting] = useState(false);

  async function loadFacilities() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/facilities', { method: 'GET' });
      if (!res.ok) throw new Error(`Failed to load facilities: ${res.status}`);
      const data = await res.json();
      setFacilities(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFacilities();
  }, []);

  async function handleCreateFacility(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        name: formData.name,
        kind: formData.kind,
        capacity: formData.capacity ? parseInt(formData.capacity) : null,
        feeKobo: parseInt(formData.feeKobo || '0'),
      };
      const res = await fetch('/api/admin/facilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Failed to create facility: ${res.status}`);
      const newFacility = await res.json();
      setFacilities([...facilities, newFacility]);
      setFormData({ name: '', kind: '', capacity: '', feeKobo: '' });
      setShowForm(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Facilities & Amenities"
        subtitle="Create and manage estate facilities (pools, gyms, meeting rooms, etc.)"
        actions={<Button variant="primary" sm onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'New Facility'}</Button>}
      />
      <EstateTabs active="facilities" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {showForm && (
        <Card title="Create new facility">
          <form onSubmit={handleCreateFacility} style={{ display: 'grid', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Name</label>
              <input
                type="text"
                placeholder="e.g., Olympic Pool, Tennis Court"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
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
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Type</label>
              <select
                value={formData.kind}
                onChange={(e) => setFormData({ ...formData, kind: e.target.value })}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: `1px solid ${colors.inputBorder}`,
                  borderRadius: '0.375rem',
                  fontSize: '0.85rem',
                }}
                required
              >
                <option value="">Select type...</option>
                <option value="pool">Pool</option>
                <option value="gym">Gym</option>
                <option value="tennis">Tennis Court</option>
                <option value="hall">Meeting Hall</option>
                <option value="playground">Playground</option>
                <option value="garden">Garden</option>
                <option value="parking">Parking</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Capacity (optional)</label>
                <input
                  type="number"
                  placeholder="e.g., 50"
                  value={formData.capacity}
                  onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
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
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Booking Fee (₦, optional)</label>
                <input
                  type="number"
                  placeholder="e.g., 5000"
                  value={formData.feeKobo}
                  onChange={(e) => setFormData({ ...formData, feeKobo: e.target.value })}
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
              <Button variant="outline" sm onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="primary" sm type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Facilities list" right={<Button variant="outline" sm onClick={loadFacilities}>Refresh</Button>}>
        {loading ? (
          <p style={{ color: colors.muted }}>Loading facilities…</p>
        ) : facilities.length === 0 ? (
          <p style={{ color: colors.muted }}>No facilities yet. Create one to get started.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thCell}>Name</th>
                <th style={thCell}>Type</th>
                <th style={thCell}>Capacity</th>
                <th style={thCell}>Booking Fee</th>
                <th style={thCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {facilities.map((f) => (
                <tr key={f.id}>
                  <td style={tdCell}><strong>{f.name}</strong></td>
                  <td style={tdCell}><Badge text={cap(f.kind)} /></td>
                  <td style={tdCell}>{f.capacity ? `${f.capacity} people` : '—'}</td>
                  <td style={tdCell}>{money(f.feeKobo)}</td>
                  <td style={tdCell}>
                    <Link href={`/admin/estate/facilities/${f.id}`} style={{ color: colors.primary, fontSize: '0.85rem' }}>
                      Manage
                    </Link>
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
