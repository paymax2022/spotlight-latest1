'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import { listLocalGovernments } from '@/services/localityAdminService';
import {
  deleteManagedVillage,
  listManagedVillages,
  publishVillages,
  updateManagedVillage,
  type VillageAdminRow,
} from '@/services/villagesAdminService';

// The village tier of the state -> local government -> village cascade, curated here.
//
// `public.villages` arrived with one LGA seeded (Onitsha North, 15 quarters), and that
// table IS the curation: an LGA with rows gets a dropdown for applicants, an LGA without
// them gets a text box. So every quarter outside that one LGA currently needs a migration
// and a deploy to appear — this page is the door that replaces them.
//
// Nothing is enforced from this screen. Locality is display + filter (the operator's call):
// retiring a quarter does not evict the contestants who named it, and publishing one does
// not gate who may enter. What changes is what a picker offers and what a list can be
// filtered by.
//
// The query is explicit rather than automatic on purpose: an effect keyed on the LGA field
// would fetch on every keystroke for a name typed rather than chosen, and curation happens
// one LGA at a time, so a click is the honest unit of work.

const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

/**
 * A pasted list arrives with newlines, commas, or both, and with the occasional stray
 * space. Splitting here means the server's per-name answers line up with what is on screen.
 */
function parseNames(raw: string): string[] {
  const parts = raw
    .split(/[\n,;]+/)
    .map((name) => name.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  // "Ogboli, Ogboli" pasted twice is one request, not two inserts where the second 409s.
  return [...new Set(parts)];
}

export default function VillagesAdminPage() {
  const [state, setState] = useState('');
  const [lgas, setLgas] = useState<string[]>([]);
  const [lga, setLga] = useState('');
  const [rows, setRows] = useState<VillageAdminRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // The middle tier comes from frontend-web's reference table rather than a second copy of
  // 774 rows in this bundle.
  useEffect(() => {
    if (!state) {
      setLgas([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await listLocalGovernments(state);
        if (!cancelled) setLgas(list.lgas);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Local governments failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  const load = useCallback(async (whichState: string, whichLga: string) => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listManagedVillages(whichState, whichLga));
      setLoaded(true);
    } catch (e) {
      // The route's own sentence, verbatim: 503 names the env var, 403 names the role.
      setError(e instanceof Error ? e.message : 'Villages failed');
      setRows([]);
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const onShow = () => {
    if (!state || !lga) return;
    void load(state, lga);
  };

  const names = parseNames(draft);

  const onPublish = async () => {
    if (!state || !lga || names.length === 0) return;
    setBusy('publish');
    setError(null);
    setNotice(null);
    try {
      const outcome = await publishVillages({ state, lga, names });
      const parts = [`${outcome.created.length} published for ${lga}.`];
      if (outcome.skipped.length > 0) {
        parts.push(
          `Not stored: ${outcome.skipped.map((s) => `${s.name || '(blank)'} — ${s.reason}`).join('; ')}.`,
        );
      }
      setNotice(parts.join(' '));
      setDraft('');
      await load(state, lga);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setBusy(null);
    }
  };

  const onPatch = async (row: VillageAdminRow, patch: { name?: string; active?: boolean }) => {
    setBusy(row.id);
    setError(null);
    setNotice(null);
    try {
      await updateManagedVillage(row.id, patch);
      setNotice(
        patch.active === false
          ? `Retired “${row.name}”. Contestants who chose it keep their entry.`
          : patch.active === true
            ? `Restored “${row.name}”.`
            : `Renamed “${row.name}” to “${patch.name}”.`,
      );
      setEditing(null);
      await load(state, lga);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (row: VillageAdminRow) => {
    // Deleting the last row of an LGA turns that LGA's village picker back into a text box
    // for every applicant there, so this is the one action that gets a confirmation.
    if (!window.confirm(`Delete “${row.name}” from ${row.lga} for good? Retiring it is usually what you want.`)) return;
    setBusy(row.id);
    setError(null);
    setNotice(null);
    try {
      await deleteManagedVillage(row.id);
      setNotice(`Deleted “${row.name}”.`);
      await load(state, lga);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(null);
    }
  };

  const liveCount = rows.filter((r) => r.is_active).length;

  return (
    <Page>
      <PageHeader
        title="Village quarters"
        subtitle="Curate the villages a local contest can be scoped to, and the name an applicant picks from."
        actions={
          <Link href="/admin/competitions/create" style={{ textDecoration: 'none' }}>
            <Button variant="outline">Back to create</Button>
          </Link>
        }
      />

      <Card title="Which LGA are you curating?" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 6 }}>State</label>
            <select
              aria-label="State"
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setLga('');
                setRows([]);
                setLoaded(false);
                setNotice(null);
              }}
              style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: `1px solid ${colors.inputBorder}` }}
            >
              <option value="">Select a state…</option>
              {NIGERIA_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: '1 1 220px' }}>
            <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 6 }}>
              Local government
            </label>
            <select
              aria-label="Local government"
              value={lga}
              disabled={!state}
              onChange={(e) => setLga(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: `1px solid ${colors.inputBorder}` }}
            >
              <option value="">{state ? 'Select an LGA…' : 'Pick a state first'}</option>
              {lgas.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>

          <Button onClick={onShow} disabled={!state || !lga || loading}>
            {loading ? 'Loading…' : 'Show quarters'}
          </Button>
        </div>
      </Card>

      {error && (
        <Card style={{ marginBottom: 16, borderColor: colors.danger }}>
          <div style={{ color: colors.danger, fontSize: 13 }}>{error}</div>
        </Card>
      )}
      {notice && (
        <Card style={{ marginBottom: 16, borderColor: colors.success }}>
          <div style={{ color: colors.success, fontSize: 13 }}>{notice}</div>
        </Card>
      )}

      <Card title="Publish a list" style={{ marginBottom: 16 }}>
        <label
          htmlFor="village-names"
          style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 6 }}
        >
          Village names{' '}
          <span style={{ opacity: 0.75 }}>— one per line, or comma-separated</span>
        </label>
        <textarea
          id="village-names"
          aria-label="Village names"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          placeholder={'Isiokwe\nMgbelekeke\nObikporo'}
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontFamily: 'inherit' }}
        />
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button onClick={onPublish} disabled={!state || !lga || names.length === 0 || busy === 'publish'}>
            {busy === 'publish'
              ? 'Publishing…'
              : names.length > 0
                ? `Publish ${names.length} village${names.length > 1 ? 's' : ''}`
                : 'Publish villages'}
          </Button>
          {!state || !lga ? (
            <span style={{ fontSize: 12, color: colors.muted }}>Choose the state and LGA first.</span>
          ) : null}
        </div>
      </Card>

      <Card
        title={
          loaded
            ? `${lga} — ${rows.length} curated, ${liveCount} active`
            : 'Curated quarters'
        }
      >
        {!loaded ? (
          <div style={{ padding: 16, color: colors.muted, fontSize: 13 }}>
            {state && lga
              ? 'Nothing loaded yet — use Show quarters.'
              : 'Pick a state and a local government, then show its quarters.'}
          </div>
        ) : loading ? (
          <div style={{ padding: 16, color: colors.muted, fontSize: 13 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 16, color: colors.muted, fontSize: 13 }}>
            No villages curated for {lga} yet — so applicants there type the name of their quarter
            instead of choosing one. Publish the list above to make it a dropdown.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Village</th>
                  <th style={thCell}>Local government</th>
                  <th style={thCell}>State</th>
                  <th style={thCell}>Status</th>
                  <th style={{ ...thCell, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isEditing = editing === row.id;
                  const rowBusy = busy === row.id;
                  return (
                    <tr key={row.id} style={{ opacity: row.is_active ? 1 : 0.6 }}>
                      <td style={tdCell}>
                        {isEditing ? (
                          <Input
                            aria-label="New name"
                            value={editName}
                            maxLength={80}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                        ) : (
                          row.name
                        )}
                      </td>
                      <td style={tdCell}>{row.lga}</td>
                      <td style={tdCell}>{row.state}</td>
                      <td style={tdCell}>
                        <Badge
                          text={row.is_active ? 'Active' : 'Retired'}
                          color={row.is_active ? colors.success : colors.muted}
                        />
                      </td>
                      <td style={{ ...tdCell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {isEditing ? (
                          <>
                            <Button
                              variant="primary"
                              onClick={() => onPatch(row, { name: editName.trim() })}
                              disabled={rowBusy || editName.trim().length < 2}
                            >
                              {rowBusy ? 'Saving…' : 'Save'}
                            </Button>{' '}
                            <Button variant="outline" onClick={() => setEditing(null)} disabled={rowBusy}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setEditing(row.id);
                                setEditName(row.name);
                              }}
                              disabled={rowBusy}
                            >
                              Rename
                            </Button>{' '}
                            <Button
                              variant="secondary"
                              onClick={() => onPatch(row, { active: !row.is_active })}
                              disabled={rowBusy}
                            >
                              {row.is_active ? 'Retire' : 'Restore'}
                            </Button>{' '}
                            <Button variant="danger" onClick={() => onDelete(row)} disabled={rowBusy}>
                              Delete
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ marginTop: 12, fontSize: 12, color: colors.muted, lineHeight: 1.6 }}>
        Retiring hides a quarter from the applicant pickers and from
        <code> /api/v1/connect/villages</code> without touching the contestants who already
        chose it; deleting removes the row for good. A local contest scoped to a quarter keeps
        working whatever happens here — locality is how a contest is displayed and filtered, not
        who is allowed in.
      </div>
    </Page>
  );
}
