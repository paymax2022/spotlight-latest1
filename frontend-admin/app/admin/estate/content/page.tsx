'use client';

// A-EST-OV-05 — Platform content oversight (estate.admin.content).
// Announcements and documents across estates.

import { useCallback, useEffect, useState } from 'react';
import { listOversightAnnouncements, listOversightDocuments } from '@/services/estateAdminService';
import type { OversightAnnouncement, OversightDocument } from '@/types/estateAdmin';
import { EstateOversightTabs, Restricted, useEstatePermissions, ESTATE_ADMIN_PERMS, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

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
    <Page>
      <PageHeader title="Content oversight" subtitle="Announcements and documents across estates. Gated on estate.admin.content." actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>} />
      <EstateOversightTabs active="content" />
      {!canView ? <Restricted perm="estate.admin.content" /> : (
        <>
          {error && <p style={{ color: colors.danger }}>{error}</p>}
          {loading ? <p style={{ color: colors.muted }}>Loading content…</p> : (
            <>
              <Card title="Announcements" style={{ marginBottom: '1.25rem' }}>
                {announcements.length === 0 ? <p style={{ color: colors.muted }}>No announcements.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Estate</th><th style={thCell}>Title</th><th style={thCell}>Body</th><th style={thCell}>Kind</th><th style={thCell}>When</th></tr></thead>
                    <tbody>
                      {announcements.map((a) => (
                        <tr key={a.id}>
                          <td style={tdCell}>{a.estateId}</td>
                          <td style={tdCell}><strong>{a.title}</strong></td>
                          <td style={tdCell}>{a.body}</td>
                          <td style={tdCell}><Badge text={cap(a.kind)} color={a.kind === 'emergency' || a.kind === 'security' ? colors.danger : a.kind === 'payment' ? colors.warning : colors.info} /></td>
                          <td style={tdCell}>{timeAgo(a.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Documents">
                {documents.length === 0 ? <p style={{ color: colors.muted }}>No documents.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Estate</th><th style={thCell}>Title</th><th style={thCell}>Category</th><th style={thCell}>Visibility</th><th style={thCell}>Uploaded</th><th style={thCell}>File</th></tr></thead>
                    <tbody>
                      {documents.map((d) => (
                        <tr key={d.id}>
                          <td style={tdCell}>{d.estateId}</td>
                          <td style={tdCell}><strong>{d.title}</strong></td>
                          <td style={tdCell}>{d.category}</td>
                          <td style={tdCell}><Badge text={d.restricted ? 'Restricted' : 'Open'} color={d.restricted ? colors.danger : colors.success} /></td>
                          <td style={tdCell}>{timeAgo(d.createdAt)}</td>
                          <td style={tdCell}><a href={d.fileUrl} target="_blank" rel="noreferrer" style={{ color: colors.info, fontSize: '0.82rem' }}>Open →</a></td>
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
    </Page>
  );
}
