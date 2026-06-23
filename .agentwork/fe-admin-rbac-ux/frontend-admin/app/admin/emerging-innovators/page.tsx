'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createStemEmergingInnovator, listStemEmergingInnovators } from '@/services/stemService';
import type { StemEmergingInnovator } from '@/types/stem';

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
    <section>
      <h1>Emerging Future Innovators</h1>
      <p>Independent contestant channel for out-of-school participants and innovators.</p>

      <form onSubmit={submitQuickCreate} style={{ marginTop: 12, border: '1px solid #2a2a2a', padding: 12 }}>
        <h2 style={{ marginTop: 0 }}>Quick Add Innovator</h2>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <input
            placeholder="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            style={{ padding: 8 }}
          />
          <input
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ padding: 8 }}
          />
          <input placeholder="State" value={state} onChange={(e) => setState(e.target.value)} style={{ padding: 8 }} />
          <input
            placeholder="Innovation track"
            value={track}
            onChange={(e) => setTrack(e.target.value)}
            style={{ padding: 8 }}
          />
        </div>
        <button type="submit" disabled={saving} style={{ marginTop: 10 }}>
          {saving ? 'Saving...' : 'Create Innovator'}
        </button>
      </form>

      <div style={{ border: '1px solid #2a2a2a', padding: 12, marginTop: 12 }}>
        <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>Total emerging profiles</p>
        <p style={{ margin: '6px 0 0 0', fontWeight: 700, fontSize: 24 }}>{rows.length}</p>
      </div>
      {loading ? <p style={{ marginTop: 12 }}>Loading profiles...</p> : null}
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {rows.map((item) => (
          <article key={item.id || `${item.email}-${item.fullName}`} style={{ border: '1px solid #2a2a2a', padding: 10 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{item.fullName}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 13 }}>
              {item.email}
              {item.phone ? ` · ${item.phone}` : ''}
            </p>
            <p style={{ margin: '4px 0 0 0', fontSize: 13 }}>
              {item.state || 'Unknown state'} · {item.innovationTrack || 'No track'}
            </p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, opacity: 0.85 }}>
              Status: {item.currentStatus || 'N/A'} · Verification: {item.verificationStatus}
            </p>
          </article>
        ))}
        {!loading && rows.length === 0 ? <p>No emerging innovator profiles found yet.</p> : null}
      </div>
      <p style={{ marginTop: 8 }}>
        <Link href="/admin/stem/overview">Back to STEM Overview</Link>
      </p>
    </section>
  );
}
