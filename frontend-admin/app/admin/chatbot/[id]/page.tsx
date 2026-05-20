'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { getChatSessionDetail } from '@/services/chatbotService';
import type { ChatEvent, ChatMessage } from '@/types/chat';

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
    <div>
      <h1>Transcript Viewer</h1>
      <p style={{ fontFamily: 'monospace', fontSize: 12 }}>Session: {id || '-'}</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Link href="/admin/chatbot">Back to Sessions</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, marginTop: 12 }}>
        <div style={{ border: '1px solid #2a2a2a', padding: 8 }}>
          <p style={{ margin: 0, fontSize: 12 }}>Messages</p>
          <p style={{ margin: 0 }}>{messages.length}</p>
        </div>
        <div style={{ border: '1px solid #2a2a2a', padding: 8 }}>
          <p style={{ margin: 0, fontSize: 12 }}>Fallback Triggers</p>
          <p style={{ margin: 0 }}>{fallbackEvents}</p>
        </div>
        <div style={{ border: '1px solid #2a2a2a', padding: 8 }}>
          <p style={{ margin: 0, fontSize: 12 }}>Handoff Requests</p>
          <p style={{ margin: 0 }}>{handoffEvents}</p>
        </div>
        <div style={{ border: '1px solid #2a2a2a', padding: 8 }}>
          <p style={{ margin: 0, fontSize: 12 }}>Avg Confidence</p>
          <p style={{ margin: 0 }}>{averageConfidence === null ? '-' : `${averageConfidence}%`}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 16 }}>
        <section style={{ border: '1px solid #2a2a2a', padding: 12 }}>
          <h2 style={{ marginTop: 0 }}>Messages</h2>
          {loading ? <p>Loading messages...</p> : null}
          {!loading && messages.length === 0 ? <p>No messages found.</p> : null}
          {!loading
            ? messages.map((msg) => (
                <article key={msg.id} style={{ border: '1px solid #303030', padding: 8, marginBottom: 8 }}>
                  <p style={{ margin: 0, fontSize: 12 }}>
                    <strong>{msg.role}</strong>
                    {msg.intent ? ` · intent: ${msg.intent}` : ''}
                    {typeof msg.confidence === 'number'
                      ? ` · confidence: ${Math.round(msg.confidence * 100)}%`
                      : ' · confidence: n/a'}
                  </p>
                  <p style={{ margin: '6px 0' }}>{msg.message_text || msg.text || ''}</p>
                  <p style={{ margin: 0, fontSize: 11, opacity: 0.7 }}>
                    {formatTimestamp(msg.created_at || msg.createdAt)}
                  </p>
                </article>
              ))
            : null}
        </section>

        <section style={{ border: '1px solid #2a2a2a', padding: 12 }}>
          <h2 style={{ marginTop: 0 }}>Events</h2>
          {loading ? <p>Loading events...</p> : null}
          {!loading && events.length === 0 ? <p>No events found.</p> : null}
          {!loading
            ? events.map((event, index) => (
                <article
                  key={`${event.id || index}-${event.created_at || event.createdAt || ''}`}
                  style={{ border: '1px solid #303030', padding: 8, marginBottom: 8 }}
                >
                  <p style={{ margin: 0, fontSize: 12 }}>
                    <strong>{event.event_name || event.event || 'event'}</strong>
                  </p>
                  <pre style={{ margin: '6px 0', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {JSON.stringify(event.event_payload || event.payload || {}, null, 2)}
                  </pre>
                  <p style={{ margin: 0, fontSize: 11, opacity: 0.7 }}>
                    {formatTimestamp(event.created_at || event.createdAt)}
                  </p>
                </article>
              ))
            : null}
        </section>
      </div>
    </div>
  );
}
