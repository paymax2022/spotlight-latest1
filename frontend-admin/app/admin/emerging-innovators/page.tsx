'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createStemEmergingInnovator, listStemEmergingInnovators } from '@/services/stemService';
import type { StemEmergingInnovator } from '@/types/stem';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

export default function AdminEmergingInnovatorsPage() {
  const [rows, setRows] = useState<StemEmergingInnovator[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState('');
  const [track, setTrack] = useState('Software Development');

  async function reload() {
    setLoading(true);
    try {
      const data = await listStemEmergingInnovators(150);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => void reload(), []);

  async function submitQuickCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!fullName.trim() || !email.trim()) return;
    setSaving(true);
    try {
      const created = await createStemEmergingInnovator({
        fullName: fullName.trim(),
        email: email.trim(),
        state: state.trim(),
        innovationTrack: track.trim(),
      });
      if (created) {
        setRows((prev) => [created, ...prev]);
        setFullName('');
        setEmail('');
        setState('');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page>
      <PageHeader title="Emerging Future Innovators" subtitle="Independent contestant channel for out-of-school participants and innovators." />

      <Card style={{ marginBottom: 12 }}>
        <form onSubmit={submitQuickCreate}>
          <h2 style={{ marginTop: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Quick Add Innovator</h2>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <Input
              placeholder="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
            <Input
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
            <Input
              placeholder="Innovation track"
              value={track}
              onChange={(e) => setTrack(e.target.value)}
            />
          </div>
          <Button type="submit" variant="primary" disabled={saving} style={{ marginTop: 10 }}>
            {saving ? 'Saving...' : 'Create Innovator'}
          </Button>
        </form>
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>Total emerging profiles</p>
        <p style={{ margin: '6px 0 0 0', fontWeight: 700, fontSize: 24 }}>{rows.length}</p>
      </Card>
      {loading ? <p style={{ color: colors.muted }}>Loading profiles...</p> : null}
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((item) => (
          <Card key={item.id || `${item.email}-${item.fullName}`} style={{ padding: 10 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{item.fullName}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 13 }}>
              {item.email}
              {item.phone ? ` · ${item.phone}` : ''}
            </p>
            <p style={{ margin: '4px 0 0 0', fontSize: 13 }}>
              {item.state || 'Unknown state'} · {item.innovationTrack || 'No track'}
            </p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: colors.muted }}>
              Status: {item.currentStatus || 'N/A'} · Verification: {item.verificationStatus}
            </p>
          </Card>
        ))}
        {!loading && rows.length === 0 ? <p style={{ color: colors.muted }}>No emerging innovator profiles found yet.</p> : null}
      </div>
      <p style={{ marginTop: 8 }}>
        <Link href="/admin/stem/overview" style={{ color: colors.primary }}>Back to STEM Overview</Link>
      </p>
    </Page>
  );
}
