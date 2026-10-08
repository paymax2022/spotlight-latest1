'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CrowdfundingApiError, listCampaigns, listCategories } from '@/src/lib/crowdfunding/api';
import { formatNaira, progressPct, daysLeft } from '@/src/lib/crowdfunding/format';
import type { CampaignCategory, CampaignSummary } from '@/src/types/crowdfunding-customer';

const COLLECTIONS: Array<{ id: NonNullable<Parameters<typeof listCampaigns>[0]['collection']> | ''; label: string }> = [
  { id: '', label: 'All' },
  { id: 'featured', label: 'Featured' },
  { id: 'trending', label: 'Trending' },
  { id: 'urgent', label: 'Urgent' },
  { id: 'recommended', label: 'Recommended' },
  { id: 'recent', label: 'Recent' },
];

function CampaignCard({ item }: { item: CampaignSummary }) {
  const pct = progressPct(item.raisedKobo, item.goalKobo);
  const left = daysLeft(item.deadline);
  return (
    <Link href={`/crowdfunding/${item.id}`} className="glass-card rounded-md p-4 block" style={{ textDecoration: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <p style={{ margin: 0, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--foreground-dim)', fontWeight: 700 }}>
          {item.categoryLabel}
        </p>
        {item.verified && <span style={{ fontSize: 11, color: '#0ea5e9', fontWeight: 700 }}>✓ Verified</span>}
      </div>
      <h5 style={{ margin: '4px 0 0', fontWeight: 700, fontSize: 16, color: 'var(--foreground)' }}>{item.title}</h5>
      <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--foreground-muted)' }}>{item.summary}</p>

      <div style={{ marginTop: 12 }}>
        <div style={{ height: 6, borderRadius: 6, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <div style={{ height: 6, width: `${pct}%`, background: 'var(--accent-gold)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12, color: 'var(--foreground-muted)' }}>
          <span><strong style={{ color: 'var(--foreground)' }}>{formatNaira(item.raisedKobo)}</strong> raised of {formatNaira(item.goalKobo)}</span>
          <span>{pct}%</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10, fontSize: 12, color: 'var(--foreground-muted)' }}>
        <span>👥 {item.contributorCount} backers</span>
        {left !== null && <span>{left === 0 ? 'Ends today' : `${left}d left`}</span>}
        {item.urgent && <span style={{ color: '#dc2626', fontWeight: 700 }}>🔥 Urgent</span>}
        {item.featured && <span style={{ color: 'var(--accent-gold)', fontWeight: 700 }}>★ Featured</span>}
      </div>
    </Link>
  );
}

export default function CrowdfundingDiscoveryClient() {
  const [categories, setCategories] = useState<CampaignCategory[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [collection, setCollection] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'recommended' | 'trending' | 'newest' | 'ending_soon' | 'most_funded'>('recommended');
  const [loading, setLoading] = useState(true);
  const [featureUnavailable, setFeatureUnavailable] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [cats, items] = await Promise.all([
        categories.length ? Promise.resolve(categories) : listCategories(),
        listCampaigns({
          collection: (collection || undefined) as never,
          category: category || undefined,
          search: search.trim() || undefined,
          sort,
        }),
      ]);
      setCategories(cats);
      setCampaigns(items);
    } catch (e) {
      if (e instanceof CrowdfundingApiError && /not available/i.test(e.message)) {
        setFeatureUnavailable(true);
      } else {
        setError(e instanceof Error ? e.message : 'Unable to load campaigns.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, category, sort]);

  if (featureUnavailable) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--foreground-muted)' }}>
        <p style={{ fontSize: 40, marginBottom: 8 }}>🤝</p>
        <h4>Crowdfunding is coming soon</h4>
        <p>This module isn&apos;t available in your environment yet. Check back shortly.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <p className="section-label mb-2">Crowdfunding</p>
          <h1 className="font-display text-3xl md:text-4xl text-foreground" style={{ marginBottom: 0 }}>Fund a Cause</h1>
        </div>
        <Link href="/crowdfunding/create" className="btn-primary py-2.5 px-4 text-[11px]">Start a Campaign</Link>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {COLLECTIONS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={collection === c.id ? 'btn-primary py-2 px-3 text-[11px]' : 'btn-outline py-2 px-3 text-[11px]'}
            onClick={() => setCollection(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void load(); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          className="form-input"
          placeholder="Search campaigns…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: '1 1 220px' }}
        />
        <select className="form-input" value={category} onChange={(e) => setCategory(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c.slug} value={c.slug}>{c.label} ({c.campaignCount})</option>)}
        </select>
        <select className="form-input" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ maxWidth: 180 }}>
          <option value="recommended">Recommended</option>
          <option value="trending">Trending</option>
          <option value="newest">Newest</option>
          <option value="ending_soon">Ending Soon</option>
          <option value="most_funded">Most Funded</option>
        </select>
        <button type="submit" className="btn-primary py-2.5 px-4 text-[11px]">Search</button>
      </form>

      {error && (
        <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
          {[0, 1, 2].map((i) => <div key={i} style={{ height: 200, borderRadius: 12, background: 'rgba(0,0,0,0.06)' }} />)}
        </div>
      ) : campaigns.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--foreground-muted)' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>🔍</p>
          <p>No campaigns match right now.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
          {campaigns.map((item) => <CampaignCard key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
}
