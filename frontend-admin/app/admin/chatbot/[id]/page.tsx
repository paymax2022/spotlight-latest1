'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { getChatSessionDetail } from '@/services/chatbotService';
import type { ChatEvent, ChatMessage } from '@/types/chat';
import { Page, PageHeader, Card, colors } from '@/components/ui/vuexy';

function formatTimestamp(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function normalizeEventName(event: ChatEvent): string {
  return (event.event_name || event.event || '').toLowerCase();
}

export default function AdminChatTranscriptPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '').trim();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setMessages([]);
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void getChatSessionDetail(id).then((data) => {
      setMessages(data.messages || []);
      setEvents(data.events || []);
      setLoading(false);
    });
  }, [id]);

  const fallbackEvents = useMemo(
    () => events.filter((event) => normalizeEventName(event) === 'fallback_triggered').length,
    [events]
  );

  const handoffEvents = useMemo(
    () => events.filter((event) => normalizeEventName(event) === 'human_handoff_requested').length,
    [events]
  );

  const averageConfidence = useMemo(() => {
    const withConfidence = messages.filter((message) => typeof message.confidence === 'number');
    if (!withConfidence.length) return null;
    const sum = withConfidence.reduce((acc, message) => acc + Number(message.confidence || 0), 0);
    return Math.round((sum / withConfidence.length) * 100);
  }, [messages]);

  return (
    <Page>
      <PageHeader title="Transcript Viewer" subtitle={`Session: ${id || '-'}`} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <Link href="/admin/chatbot">Back to Sessions</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, marginBottom: 12 }}>
        <Card style={{ padding: 8 }}>
          <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>Messages</p>
          <p style={{ margin: 0 }}>{messages.length}</p>
        </Card>
        <Card style={{ padding: 8 }}>
          <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>Fallback Triggers</p>
          <p style={{ margin: 0 }}>{fallbackEvents}</p>
        </Card>
        <Card style={{ padding: 8 }}>
          <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>Handoff Requests</p>
          <p style={{ margin: 0 }}>{handoffEvents}</p>
        </Card>
        <Card style={{ padding: 8 }}>
          <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>Avg Confidence</p>
          <p style={{ margin: 0 }}>{averageConfidence === null ? '-' : `${averageConfidence}%`}</p>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Card title="Messages">
          {loading ? <p style={{ color: colors.muted }}>Loading messages...</p> : null}
          {!loading && messages.length === 0 ? <p style={{ color: colors.muted }}>No messages found.</p> : null}
          {!loading
            ? messages.map((msg) => (
                <div key={msg.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 6, padding: 8, marginTop: 8 }}>
                  <p style={{ margin: 0, fontSize: 12 }}>
                    <strong>{msg.role}</strong>
                    {msg.intent ? ` · intent: ${msg.intent}` : ''}
                    {typeof msg.confidence === 'number'
                      ? ` · confidence: ${Math.round(msg.confidence * 100)}%`
                      : ' · confidence: n/a'}
                  </p>
                  <p style={{ margin: '6px 0' }}>{msg.message_text || msg.text || ''}</p>
                  <p style={{ margin: 0, fontSize: 11, color: colors.muted }}>
                    {formatTimestamp(msg.created_at || msg.createdAt)}
                  </p>
                </div>
              ))
            : null}
        </Card>

        <Card title="Events">
          {loading ? <p style={{ color: colors.muted }}>Loading events...</p> : null}
          {!loading && events.length === 0 ? <p style={{ color: colors.muted }}>No events found.</p> : null}
          {!loading
            ? events.map((event, index) => (
                <div
                  key={`${event.id || index}-${event.created_at || event.createdAt || ''}`}
                  style={{ border: `1px solid ${colors.border}`, borderRadius: 6, padding: 8, marginTop: 8 }}
                >
                  <p style={{ margin: 0, fontSize: 12 }}>
                    <strong>{event.event_name || event.event || 'event'}</strong>
                  </p>
                  <pre style={{ margin: '6px 0', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {JSON.stringify(event.event_payload || event.payload || {}, null, 2)}
                  </pre>
                  <p style={{ margin: 0, fontSize: 11, color: colors.muted }}>
                    {formatTimestamp(event.created_at || event.createdAt)}
                  </p>
                </div>
              ))
            : null}
        </Card>
      </div>
    </Page>
  );
}
