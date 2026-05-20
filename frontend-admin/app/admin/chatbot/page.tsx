'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listChatSessions } from '@/services/chatbotService';
import type { ChatSession } from '@/types/chat';

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
    <div>
      <h1>Chat Sessions</h1>
      <p>Review chatbot sessions and inspect transcripts.</p>
      {loading ? <p>Loading sessions...</p> : null}
      <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
        {rows.map((row) => (
          <article key={row.id} style={{ border: '1px solid #2a2a2a', padding: 12 }}>
            <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}>{row.id}</p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12 }}>
              {row.pageContext || 'unknown'} · {row.status || 'active'} · {row.startedAt ? new Date(row.startedAt).toLocaleString() : '-'}
            </p>
            <Link href={`/admin/chatbot/${row.id}`}>Open Transcript</Link>
          </article>
        ))}
      </div>
    </div>
  );
}
