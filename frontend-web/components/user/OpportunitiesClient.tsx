'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function OpportunitiesClient() {
  const [items, setItems] = useState<Array<Record<string, any>>>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');

  async function load() {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (category) params.set('category', category);
    const res = await fetch(`/api/opportunities?${params.toString()}`, { cache: 'no-store' });
    const payload = await res.json();
    setItems(payload.opportunities || []);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-md p-4 d-flex gap-2 flex-wrap">
        <input className="form-input h-[44px] flex-grow-1" placeholder="Search opportunities" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="form-input h-[44px]" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          <option value="open mic">Open Mic</option>
          <option value="stem">STEM</option>
          <option value="music">Music</option>
          <option value="sme">SME</option>
        </select>
        <button className="theme-btn" type="button" onClick={() => void load()}>Filter</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((item) => (
          <div key={String(item.id)} className="glass-card rounded-md p-4">
            <p className="text-xs uppercase text-foreground/60 mb-1">{item.programType}</p>
            <h3>{item.title}</h3>
            <p className="text-foreground/70">{item.shortDescription}</p>
            <p className="text-sm mb-1">Deadline: {item.deadline || 'Rolling'}</p>
            <p className="text-sm mb-3">Fee: {Number(item.applicationFee || 0) > 0 ? `NGN ${item.applicationFee}` : 'Free'}</p>
            <div className="d-flex gap-2 flex-wrap">
              <Link href={String(item.applyHref)} className="theme-btn">Apply</Link>
              <Link href={String(item.detailsHref)} className="theme-btn style-2">Details</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
