'use client';

import { useEffect, useState } from 'react';
import { getPhotos } from '@/services/staysExtranetService';
import type { PhotoAsset } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, Badge, StateBlock, FilterBar, btn, btnPrimary, select, label } from '../_ui';

const TAGS = ['all', 'exterior', 'room', 'lobby', 'amenity', 'dining', 'view'];

export default function PhotosPage() {
  const [photos, setPhotos] = useState<PhotoAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tag, setTag] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try { setPhotos(await getPhotos()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = photos.filter((p) => tag === 'all' || p.tag === tag);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Photos & media manager" subtitle="Upload, caption and order your images. The cover photo is what travellers see first. Aim for 14+ high-quality photos." action={<button style={btnPrimary()}>Upload photos</button>} />
      <ExtranetTabs active="content" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <FilterBar>
        <div><label style={label()}>Filter by tag</label><select style={select()} value={tag} onChange={(e) => setTag(e.target.value)}>{TAGS.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
        <button onClick={load} style={btn()}>Refresh</button>
      </FilterBar>

      <Card title={`Gallery (${filtered.length})`}>
        <StateBlock loading={loading} error={error} empty={filtered.length === 0} emptyText="No photos for this filter.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.85rem' }}>
            {filtered.map((p) => (
              <div key={p.id} style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', overflow: 'hidden' }}>
                <div style={{ height: 130, background: 'linear-gradient(135deg, #ede9fe, #dbeafe)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: '0.78rem' }}>{p.tag}</div>
                <div style={{ padding: '0.6rem 0.7rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{p.caption}</span>
                    {p.is_cover ? <Badge status="published" label="Cover" /> : null}
                  </div>
                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.35rem' }}>
                    <button style={btn()}>Edit</button>
                    {!p.is_cover ? <button style={btn()}>Set cover</button> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
