'use client';

// A1 — Competition config (list + create).
// RBAC: arena.admin.manage (Competition Admin). Lists competitions; create a new
// DRAFT; open one to configure rails, award bindings, schema versions, publish.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { listCompetitions, createCompetition } from '@/services/arenaAdminService';
import type { Competition } from '@/types/arenaAdmin';
import {
  PageHeader, Card, btn, btnPrimary, btnDisabled, th, td, inputStyle, mono,
  CompetitionStatusBadge, timeAgo, AuditNote, PermissionBanner, ARENA_PERMS, useArenaPermission,
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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Arena — Competition Config (A1)"
        subtitle="Configure rails, award→rail bindings, schema/rubric versions; validate; publish an immutable config version. RBAC: arena.admin.manage (Competition Admin)."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.admin} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card title="Create competition">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: '#6b7280' }}>
            Slug
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="naija-driver-2027" style={{ ...inputStyle(), minWidth: 220 }} disabled={!allowed} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: '#6b7280' }}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Naija Driver Contest 2027" style={{ ...inputStyle(), minWidth: 280 }} disabled={!allowed} />
          </label>
          <button
            onClick={() => void create()}
            style={allowed && !creating ? btnPrimary() : btnDisabled()}
            disabled={!allowed || creating}
          >
            {creating ? 'Creating…' : 'Create DRAFT'}
          </button>
        </div>
        <AuditNote>Creating a competition writes an audit_log row. New competitions start as DRAFT — nothing is live until published.</AuditNote>
      </Card>

      <Card title="Competitions">
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading competitions…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No competitions yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Name</th>
                  <th style={th()}>Slug</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Config v.</th>
                  <th style={th()}>Updated</th>
                  <th style={th()}>Config</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={td()}>{c.name}</td>
                    <td style={{ ...td(), ...mono() }}>{c.slug}</td>
                    <td style={td()}><CompetitionStatusBadge status={c.status} /></td>
                    <td style={td()}>{c.config_version ?? '—'}</td>
                    <td style={td()}>{timeAgo(c.updated_at)}</td>
                    <td style={td()}>
                      <Link href={`/admin/arena/config/${c.id}`} style={{ color: '#1d4ed8', textDecoration: 'none', ...mono() }}>
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
    </div>
  );
}
