'use client';

// A1 — Competition config (list + create).
// RBAC: arena.admin.manage (Competition Admin). Lists competitions; create a new
// DRAFT; open one to configure rails, award bindings, schema versions, publish.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { listCompetitions, createCompetition } from '@/services/arenaAdminService';
import type { Competition } from '@/types/arenaAdmin';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';
import {
  mono, CompetitionStatusBadge, timeAgo, AuditNote, PermissionBanner, ARENA_PERMS, useArenaPermission,
} from '../_ui';

export default function ArenaConfigListPage() {
  const { allowed } = useArenaPermission(ARENA_PERMS.admin);
  const [rows, setRows] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listCompetitions()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    if (!slug.trim() || !name.trim()) return;
    setCreating(true); setError(null);
    try {
      await createCompetition({ slug: slug.trim(), name: name.trim() });
      setSlug(''); setName('');
      await load();
    } catch (e) { setError(String(e)); }
    finally { setCreating(false); }
  }, [slug, name, load]);

  return (
    <Page>
      <PageHeader
        title="Arena — Competition Config (A1)"
        subtitle="Configure rails, award→rail bindings, schema/rubric versions; validate; publish an immutable config version. RBAC: arena.admin.manage (Competition Admin)."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.admin} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card title="Create competition" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 14 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: colors.muted }}>
            Slug
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="naija-driver-2027" style={{ minWidth: 220 }} disabled={!allowed} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: colors.muted }}>
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Naija Driver Contest 2027" style={{ minWidth: 280 }} disabled={!allowed} />
          </label>
          <Button
            variant="primary"
            onClick={() => void create()}
            disabled={!allowed || creating}
          >
            {creating ? 'Creating…' : 'Create DRAFT'}
          </Button>
        </div>
        <AuditNote>Creating a competition writes an audit_log row. New competitions start as DRAFT — nothing is live until published.</AuditNote>
      </Card>

      <Card title="Competitions">
        {loading ? (
          <p style={{ color: colors.muted }}>Loading competitions…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No competitions yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Name</th>
                  <th style={thCell}>Slug</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Config v.</th>
                  <th style={thCell}>Updated</th>
                  <th style={thCell}>Config</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={tdCell}>{c.name}</td>
                    <td style={{ ...tdCell, ...mono() }}>{c.slug}</td>
                    <td style={tdCell}><CompetitionStatusBadge status={c.status} /></td>
                    <td style={tdCell}>{c.config_version ?? '—'}</td>
                    <td style={tdCell}>{timeAgo(c.updated_at)}</td>
                    <td style={tdCell}>
                      <Link href={`/admin/arena/config/${c.id}`} style={{ color: colors.primary, textDecoration: 'none', ...mono() }}>
                        Open config →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
