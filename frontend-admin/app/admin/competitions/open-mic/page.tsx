'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createOpenMicCompetition, listOpenMicCompetitions } from '@/services/competitionsService';
import type { OpenMicCompetition } from '@/types/competitions';

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AdminOpenMicCompetitionsPage() {
  const [rows, setRows] = useState<OpenMicCompetition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [status, setStatus] = useState('upcoming');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);
  const [entryFee, setEntryFee] = useState('0');
  const [votePrice, setVotePrice] = useState('0');

  const load = () => {
    setLoading(true);
    void listOpenMicCompetitions(200).then((data) => {
      setRows(data);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, []);

  const onCreate = async () => {
    if (!name.trim()) {
      setError('Edition name is required.');
      return;
    }
    setSaving(true);
    setError('');
    const created = await createOpenMicCompetition({
      name: name.trim(),
      slug: slug.trim(),
      status: status.trim(),
      start_date: startDate.trim(),
      end_date: endDate.trim(),
      is_featured: isFeatured,
      entry_fee_ngn: Number.parseInt(entryFee || '0', 10) || 0,
      vote_price_ngn: Number.parseInt(votePrice || '0', 10) || 0,
      category: 'Music',
    });
    setSaving(false);
    if (!created) {
      setError('Failed to create Open Mic edition.');
      return;
    }
    setName('');
    setSlug('');
    setStatus('upcoming');
    setStartDate('');
    setEndDate('');
    setIsFeatured(false);
    setEntryFee('0');
    setVotePrice('0');
    load();
  };

  return (
    <div>
      <h1>Open Mic Editions</h1>
      <p>Monthly One-Beat One-Verse competition editions.</p>
      <p style={{ marginTop: 8 }}>
        <Link href="/admin/competitions">Back to Competitions Overview</Link>
      </p>
      {error ? <p style={{ marginTop: 8, color: '#fda4af' }}>{error}</p> : null}

      <section style={{ border: '1px solid #2a2a2a', padding: 12, marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>Create New Edition</h2>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Edition name" />
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="Slug (optional)" />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="upcoming">upcoming</option>
            <option value="active">active</option>
            <option value="ended">ended</option>
            <option value="draft">draft</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} />
            Featured
          </label>
          <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <input value={entryFee} onChange={(e) => setEntryFee(e.target.value)} placeholder="Entry fee NGN" />
          <input value={votePrice} onChange={(e) => setVotePrice(e.target.value)} placeholder="Vote price NGN" />
        </div>
        <button
          type="button"
          onClick={() => void onCreate()}
          disabled={saving}
          style={{ marginTop: 10, border: '1px solid #2a2a2a', padding: '6px 12px' }}
        >
          {saving ? 'Creating...' : 'Create Edition'}
        </button>
      </section>

      {loading ? <p style={{ marginTop: 16 }}>Loading editions...</p> : null}

      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        {!loading && rows.length === 0 ? <p>No Open Mic editions found.</p> : null}
        {rows.map((item) => (
          <article key={item.id} style={{ border: '1px solid #2a2a2a', padding: 12 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{item.name || 'Open Mic Edition'}</p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12, opacity: 0.85 }}>
              slug: <code>{item.slug || '-'}</code>
            </p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12 }}>
              {item.status || 'upcoming'}
              {item.is_featured ? ' · featured' : ''}
            </p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12 }}>
              {formatDate(item.start_date)} - {formatDate(item.end_date)}
            </p>
            <p style={{ margin: '6px 0 0 0', fontSize: 11, opacity: 0.7 }}>
              created: {formatDate(item.created_at)}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
