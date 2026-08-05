'use client';

import { useEffect, useState } from 'react';
import { getAnalyticsSummary } from '@/services/analyticsService';
import type { Analytics } from '@/types/analytics';
import { Page, PageHeader, Card, colors } from '@/components/ui/vuexy';

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  useEffect(() => {
    void getAnalyticsSummary().then(setData);
  }, []);

  return (
    <Page>
      <PageHeader title="Chatbot Analytics" />
      {!data ? (
        <p style={{ color: colors.muted }}>Loading analytics...</p>
      ) : (
        <Card>
          <div style={{ display: 'grid', gap: 8 }}>
            <p>Sessions: {data.sessionsTotal}</p>
            <p>Messages: {data.messagesTotal}</p>
            <p>Leads: {data.leadsTotal}</p>
          </div>
        </Card>
      )}
    </Page>
  );
}
