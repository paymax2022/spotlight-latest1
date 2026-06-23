'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Contest = {
  id: string;
  slug: string;
  title: string;
  season: string;
  description: string;
  status: string;
  visibility: string;
};

export default function StemContestList() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contests, setContests] = useState<Contest[]>([]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/stem/contests', { cache: 'no-store' });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.success) {
          throw new Error(payload?.error || 'Failed to load STEM contests.');
        }
        if (!active) return;
        setContests((payload.contests || []) as Contest[]);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load STEM contests.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  if (loading) return <p>Loading contests...</p>;
  if (error) return <p style={{ color: '#B42318' }}>{error}</p>;

  return (
    <div className="row g-4">
      {contests.map((contest) => (
        <div className="col-xl-4 col-lg-6 col-md-6" key={contest.id}>
          <div className="service-box-items box-shadow">
            <div className="content">
              <h4>{contest.title}</h4>
              <p>{contest.description}</p>
              <p className="mt-1"><strong>Season:</strong> {contest.season}</p>
              <p><strong>Status:</strong> {contest.status.replaceAll('_', ' ')}</p>
              <Link href={`/apply/${contest.slug}`} className="theme-btn-2 mt-3">
                Apply Now
                <i className="fa-solid fa-arrow-right-long" />
              </Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
