'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listRestaurants, RestaurantApiError } from '@/src/lib/restaurant/api';
import { formatNaira } from '@/src/lib/restaurant/format';
import type { Restaurant } from '@/src/types/restaurant';

const PAGE_SIZE = 20;

const CUISINES = ['', 'Local', 'Fast Food', 'Chinese', 'Grills', 'Healthy'];

function RestaurantCard({ item }: { item: Restaurant }) {
  return (
    <Link
      href={`/restaurant/${item.id}`}
      className="glass-card rounded-md p-4 block"
      style={{ textDecoration: 'none', opacity: item.is_open ? 1 : 0.6 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <h5 style={{ margin: 0, fontWeight: 700, fontSize: 16, color: 'var(--foreground)' }}>{item.name}</h5>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--foreground-muted)' }}>
            {item.cuisine || 'Restaurant'} {item.prep_time_minutes ? `· ${item.prep_time_minutes} min prep` : ''}
          </p>
        </div>
        {!item.is_open && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#fee2e2', color: '#991b1b', whiteSpace: 'nowrap' }}>
            Closed
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10, fontSize: 12, color: 'var(--foreground-muted)' }}>
        <span>⭐ {item.rating?.toFixed(1) ?? '5.0'}</span>
        <span>❤️ {item.like_count}</span>
        <span>Min {formatNaira(item.min_order_kobo)}</span>
        {item.has_promo && <span style={{ color: '#7c3aed', fontWeight: 700 }}>🎁 Promo</span>}
        {item.is_featured && <span style={{ color: 'var(--accent-gold)', fontWeight: 700 }}>★ Featured</span>}
      </div>
    </Link>
  );
}

export default function RestaurantDiscoveryClient() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [sort, setSort] = useState<'newest' | 'rating' | 'eta' | 'likes'>('newest');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [featureUnavailable, setFeatureUnavailable] = useState(false);
  const [error, setError] = useState('');

  async function load(nextOffset: number, replace: boolean) {
    if (replace) setLoading(true); else setLoadingMore(true);
    setError('');
    try {
      const page = await listRestaurants({
        q: search.trim() || undefined,
        cuisine: cuisine || undefined,
        sort,
        limit: PAGE_SIZE,
        offset: nextOffset,
      });
      if (!page) { setAuthError(true); return; }
      setRestaurants((prev) => (replace ? page.restaurants : [...prev, ...page.restaurants]));
      setTotal(page.total);
      setHasMore(page.has_more);
      setOffset(nextOffset + page.restaurants.length);
    } catch (e) {
      if (e instanceof RestaurantApiError && /not available/i.test(e.message)) {
        setFeatureUnavailable(true);
      } else {
        setError(e instanceof Error ? e.message : 'Unable to load restaurants.');
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void load(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuisine, sort]);

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    void load(0, true);
  }

  if (featureUnavailable) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--foreground-muted)' }}>
        <p style={{ fontSize: 40, marginBottom: 8 }}>🍽️</p>
        <h4>Restaurants & Delivery is coming soon</h4>
        <p>This module isn&apos;t available in your environment yet. Check back shortly.</p>
      </div>
    );
  }

  if (!loading && authError) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
        <h3 style={{ marginBottom: 8 }}>Sign in to order food</h3>
        <p style={{ color: 'var(--foreground-muted)', marginBottom: 24 }}>
          Browse restaurants near you and get your order delivered.
        </p>
        <Link href="/login?next=/restaurant" className="theme-btn">Sign In</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <p className="section-label mb-2">Restaurants & Delivery</p>
        <h1 className="font-display text-3xl md:text-4xl text-foreground" style={{ marginBottom: 0 }}>
          Order Food
        </h1>
      </div>

      <form onSubmit={onSearchSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          className="form-input"
          placeholder="Search restaurants…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: '1 1 220px' }}
        />
        <select className="form-input" value={cuisine} onChange={(e) => setCuisine(e.target.value)} style={{ maxWidth: 180 }}>
          {CUISINES.map((c) => <option key={c} value={c}>{c || 'All Cuisines'}</option>)}
        </select>
        <select className="form-input" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ maxWidth: 160 }}>
          <option value="newest">Newest</option>
          <option value="rating">Top Rated</option>
          <option value="eta">Fastest</option>
          <option value="likes">Most Liked</option>
        </select>
        <button type="submit" className="btn-primary py-2.5 px-4 text-[11px]">Search</button>
      </form>

      {error && (
        <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 14 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ height: 120, borderRadius: 12, background: 'rgba(0,0,0,0.06)' }} />
          ))}
        </div>
      ) : restaurants.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--foreground-muted)' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>🔍</p>
          <p>No restaurants match your search right now.</p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--foreground-muted)', margin: 0 }}>{total} restaurant{total !== 1 ? 's' : ''}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 14 }}>
            {restaurants.map((item) => <RestaurantCard key={item.id} item={item} />)}
          </div>
          {hasMore && (
            <button
              type="button"
              className="btn-outline py-2.5 px-4 text-[11px]"
              style={{ alignSelf: 'center' }}
              disabled={loadingMore}
              onClick={() => void load(offset, false)}
            >
              {loadingMore ? 'Loading…' : 'Load More'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
