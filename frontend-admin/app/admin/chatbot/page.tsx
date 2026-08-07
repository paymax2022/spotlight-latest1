'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listChatSessions } from '@/services/chatbotService';
import type { ChatSession } from '@/types/chat';
import { Page, PageHeader, Card, colors } from '@/components/ui/vuexy';

export default function AdminChatbotPage() {
  const [rows, setRows] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void listChatSessions().then((data) => {
      setRows(data);
      setLoading(false);
    });
  }, []);

  return (
    <Page>
      <PageHeader title="Chat Sessions" subtitle="Review chatbot sessions and inspect transcripts." />
      {loading ? <p style={{ color: colors.muted }}>Loading sessions...</p> : null}
      <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
        {rows.map((row) => (
          <Card key={row.id} style={{ padding: 12 }}>
            <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}>{row.id}</p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12, color: colors.muted }}>
              {row.pageContext || 'unknown'} · {row.status || 'active'} · {row.startedAt ? new Date(row.startedAt).toLocaleString() : '-'}
            </p>
            <Link href={`/admin/chatbot/${row.id}`}>Open Transcript</Link>
          </Card>
        ))}
      </div>
    </Page>
  );
}
