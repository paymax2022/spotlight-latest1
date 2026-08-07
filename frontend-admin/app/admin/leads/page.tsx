'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { listLeads, updateLeadStatus } from '@/services/leadsService';
import type { Lead } from '@/types/leads';
import { Page, PageHeader, Card, colors } from '@/components/ui/vuexy';

export default function AdminLeadsPage() {
  const searchParams = useSearchParams();
  const sessionIdFilter = (searchParams?.get('sessionId') || '').trim();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const rows = await listLeads(200, sessionIdFilter);
    setLeads(rows);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [sessionIdFilter]);

  const onUpdate = async (id: string, status: string) => {
    await updateLeadStatus(id, status);
    await load();
  };

  return (
    <Page>
      <PageHeader title="Chat Leads" subtitle="Manage applicant, sponsor, and support leads captured by chatbot." />
      <div style={{ marginBottom: 12 }}>
        {sessionIdFilter ? (
          <>
            <p style={{ margin: 0, fontSize: 12, fontFamily: 'monospace', color: colors.muted }}>
              Filtered by session: {sessionIdFilter}
            </p>
            <Link href="/admin/leads" style={{ color: colors.primary }}>Clear Filter</Link>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>Showing all sessions</p>
        )}
      </div>
      {loading ? <p style={{ color: colors.muted }}>Loading...</p> : null}
      <div style={{ display: 'grid', gap: 10 }}>
        {leads.map((lead) => (
          <Card key={lead.id} style={{ padding: 12 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{lead.name || 'Unnamed lead'}</p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12, color: colors.muted }}>
              {lead.email || '-'} · {lead.phone || '-'} · {lead.leadType || '-'}
            </p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12, fontFamily: 'monospace', color: colors.muted }}>
              Session: {lead.sessionId || '-'}
            </p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12, color: colors.muted }}>
              Score: {lead.score ?? 0} · Created:{' '}
              {lead.createdAt ? new Date(lead.createdAt).toLocaleString() : '-'}
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <select
                value={lead.status || 'new'}
                onChange={(e) => void onUpdate(lead.id, e.target.value)}
              >
                <option value="new">new</option>
                <option value="in_review">in_review</option>
                <option value="contacted">contacted</option>
                <option value="closed">closed</option>
              </select>
              {lead.sessionId ? (
                <Link href={`/admin/chatbot/${encodeURIComponent(lead.sessionId)}`} style={{ color: colors.primary }}>Open Transcript</Link>
              ) : null}
            </div>
            <p style={{ margin: '8px 0 0 0', fontSize: 12 }}>{lead.notes || lead.transcriptExcerpt || '-'}</p>
          </Card>
        ))}
      </div>
    </Page>
  );
}
