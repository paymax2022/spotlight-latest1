'use client';

import { useEffect, useState } from 'react';
import { getAnalyticsSummary } from '@/services/analyticsService';
import type { Analytics } from '@/types/analytics';

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    getAnalyticsSummary()
      .then((d) => {
        if (active) setData(d);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <h1>Chatbot Analytics</h1>
      {loading ? (
        <p>Loading analytics…</p>
      ) : !data ? (
        <p>Analytics are unavailable right now. Check that the backend is running, then reload.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <p>Sessions: {data.sessionsTotal}</p>
          <p>Messages: {data.messagesTotal}</p>
          <p>Leads: {data.leadsTotal}</p>
        </div>
      )}
    </div>
  );
}
