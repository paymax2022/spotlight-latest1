'use client';

// A-EST-OV-05 — Platform content oversight (estate.admin.content).
// Announcements and documents across estates.

import { useCallback, useEffect, useState } from 'react';
import { listOversightAnnouncements, listOversightDocuments } from '@/services/estateAdminService';
import type { OversightAnnouncement, OversightDocument } from '@/types/estateAdmin';
import {
  PageHeader, EstateOversightTabs, Card, Badge, btn, th, td, timeAgo,
  useEstatePermissions, ESTATE_ADMIN_PERMS, Restricted,
} from '../_ui';

export default function ContentOversightPage() {
  const { can } = useEstatePermissions();
  const canView = can(ESTATE_ADMIN_PERMS.content);

  const [announcements, setAnnouncements] = useState<OversightAnnouncement[]>([]);
  const [documents, setDocuments] = useState<OversightDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true); setError(null);
    try {
      const [a, d] = await Promise.all([listOversightAnnouncements(), listOversightDocuments()]);
      setAnnouncements(a); setDocuments(d);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [canView]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Content oversight" subtitle="Announcements and documents across estates. Gated on estate.admin.content." action={<button onClick={() => void load()} style={btn()}>Refresh</button>} />
      <EstateOversightTabs active="content" />
      {!canView ? <Restricted perm="estate.admin.content" /> : (
        <>
          {error && <p style={{ color: '#dc2626' }}>{error}</p>}
          {loading ? <p style={{ color: '#6b7280' }}>Loading content…</p> : (
            <>
              <Card title="Announcements">
                {announcements.length === 0 ? <p style={{ color: '#6b7280' }}>No announcements.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th()}>Estate</th><th style={th()}>Title</th><th style={th()}>Body</th><th style={th()}>Kind</th><th style={th()}>When</th></tr></thead>
                    <tbody>
                      {announcements.map((a) => (
                        <tr key={a.id}>
                          <td style={td()}>{a.estateId}</td>
                          <td style={td()}><strong>{a.title}</strong></td>
                          <td style={td()}>{a.body}</td>
                          <td style={td()}><Badge status={a.kind === 'emergency' || a.kind === 'security' ? 'high' : a.kind === 'payment' ? 'medium' : 'low'} label={a.kind} /></td>
                          <td style={td()}>{timeAgo(a.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Documents">
                {documents.length === 0 ? <p style={{ color: '#6b7280' }}>No documents.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th()}>Estate</th><th style={th()}>Title</th><th style={th()}>Category</th><th style={th()}>Visibility</th><th style={th()}>Uploaded</th><th style={th()}>File</th></tr></thead>
                    <tbody>
                      {documents.map((d) => (
                        <tr key={d.id}>
                          <td style={td()}>{d.estateId}</td>
                          <td style={td()}><strong>{d.title}</strong></td>
                          <td style={td()}>{d.category}</td>
                          <td style={td()}><Badge status={d.restricted ? 'restricted' : 'active'} label={d.restricted ? 'Restricted' : 'Open'} /></td>
                          <td style={td()}>{timeAgo(d.createdAt)}</td>
                          <td style={td()}><a href={d.fileUrl} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8', fontSize: '0.82rem' }}>Open →</a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
