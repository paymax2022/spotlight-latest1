'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createOpenMicCompetition, listOpenMicCompetitions } from '@/services/competitionsService';
import type { OpenMicCompetition } from '@/types/competitions';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader title="Open Mic Editions" subtitle="Monthly One-Beat One-Verse competition editions." />
      <p style={{ marginBottom: 8 }}>
        <Link href="/admin/competitions">Back to Competitions Overview</Link>
      </p>
      {error ? <p style={{ marginTop: 8, color: colors.danger }}>{error}</p> : null}

      <Card title="Create New Edition" style={{ marginTop: 12 }}>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: 14 }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Edition name" />
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="Slug (optional)" />
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
          <Input value={entryFee} onChange={(e) => setEntryFee(e.target.value)} placeholder="Entry fee NGN" />
          <Input value={votePrice} onChange={(e) => setVotePrice(e.target.value)} placeholder="Vote price NGN" />
        </div>
        <Button variant="primary" style={{ marginTop: 10 }} onClick={() => void onCreate()} disabled={saving}>
          {saving ? 'Creating...' : 'Create Edition'}
        </Button>
      </Card>

      {loading ? <p style={{ marginTop: 16, color: colors.muted }}>Loading editions...</p> : null}

      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        {!loading && rows.length === 0 ? <p style={{ color: colors.muted }}>No Open Mic editions found.</p> : null}
        {rows.map((item) => (
          <Card key={item.id} style={{ padding: 12 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{item.name || 'Open Mic Edition'}</p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12, color: colors.muted }}>
              slug: <code>{item.slug || '-'}</code>
            </p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12 }}>
              {item.status || 'upcoming'}
              {item.is_featured ? ' · featured' : ''}
            </p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12 }}>
              {formatDate(item.start_date)} - {formatDate(item.end_date)}
            </p>
            <p style={{ margin: '6px 0 0 0', fontSize: 11, color: colors.muted }}>
              created: {formatDate(item.created_at)}
            </p>
          </Card>
        ))}
      </div>
    </Page>
  );
}
