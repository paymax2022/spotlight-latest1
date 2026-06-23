'use client';

import { useEffect, useState } from 'react';
import { getAnalyticsSummary } from '@/services/analyticsService';
import type { Analytics } from '@/types/analytics';

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  useEffect(() => {
    void getAnalyticsSummary().then(setData);
  }, []);

  return (
    <div>
      <h1>Chatbot Analytics</h1>
      {!data ? (
        <p>Loading analytics...</p>
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
