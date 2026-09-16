'use client';

/**
 * SME Pitch — console list page (admin consolidation; see
 * docs/adr/ADR-047-admin-console-consolidation-path-a.md and
 * smePitchAdminService.ts for the data-path notes).
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  getSmePitchConsole, createSmePitchContest, NIGERIA_STATES,
  type SmePitchConsoleData, type RegionScope,
} from '@/services/smePitchAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_BADGE: Record<string, string> = {
  draft: colors.muted,
  submitted: colors.info,
  shortlisted: colors.primary,
  approved: colors.success,
  rejected: colors.danger,
};

function toSlug(raw: string) {
  return raw.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

const labelStyle: CSSProperties = { display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 };
const checkboxGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, maxHeight: 160, overflow: 'auto', border: `1px solid ${colors.border}`, borderRadius: 6, padding: 10 };

export default function SmePitchAdminPage() {
  const [data, setData] = useState<SmePitchConsoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [form, setForm] = useState({
    title: '', slug: '', seasonOrEdition: 'Season 1', regionScope: 'national' as RegionScope,
    isPaid: false, registrationFeeNgn: 0, legalAdultAge: 18,
    supportsVoting: false, supportsAuditionScheduling: true, supportsGroupEntry: true,
    requiresGuardianConsentForMinors: false, requiresMedical: false, requiresBootcampReadiness: true,
    auditionStates: ['Lagos'] as string[],
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getSmePitchConsole());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load SME Pitch console');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function setTitle(title: string) {
    setForm((f) => ({ ...f, title, slug: slugTouched ? f.slug : toSlug(title) }));
  }

  function toggleState(state: string) {
    setForm((f) => ({
      ...f,
      auditionStates: f.auditionStates.includes(state)
        ? f.auditionStates.filter((s) => s !== state)
        : [...f.auditionStates, state],
    }));
  }

  const submit = useCallback(async () => {
    if (!form.title.trim() || !form.slug.trim()) { setFormError('Title and slug are required'); return; }
    setSaving(true);
    setFormError(null);
    try {
      await createSmePitchContest({
        title: form.title.trim(),
        slug: form.slug.trim(),
        seasonOrEdition: form.seasonOrEdition.trim() || 'Season 1',
        regionScope: form.regionScope,
        isPaid: form.isPaid,
        registrationFeeNgn: form.isPaid ? form.registrationFeeNgn : 0,
        legalAdultAge: form.legalAdultAge,
        supportsVoting: form.supportsVoting,
        supportsAuditionScheduling: form.supportsAuditionScheduling,
        supportsGroupEntry: form.supportsGroupEntry,
        requiresGuardianConsentForMinors: form.requiresGuardianConsentForMinors,
        requiresMedical: form.requiresMedical,
        requiresBootcampReadiness: form.requiresBootcampReadiness,
        auditionStates: form.supportsAuditionScheduling ? form.auditionStates : [],
        applicantCategories: ['SME Pitch', 'Entrepreneur', 'Startup'],
      });
      setShowForm(false);
      setSlugTouched(false);
      setForm((f) => ({ ...f, title: '', slug: '' }));
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create contest');
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  return (
    <Page>
      <PageHeader
        title="SME Pitch"
        subtitle="Pitch contests, registration fees, pitch locations and founder applications. Served from the web app over the admin web proxy."
        actions={
          <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'Create pitch contest'}
          </Button>
        }
      />

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {showForm && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Contest title</label>
              <Input style={{ width: '100%' }} value={form.title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Slug</label>
              <Input style={{ width: '100%' }} value={form.slug}
                onChange={(e) => { setSlugTouched(true); setForm((f) => ({ ...f, slug: toSlug(e.target.value) })); }} />
            </div>
            <div>
              <label style={labelStyle}>Season / edition</label>
              <Input style={{ width: '100%' }} value={form.seasonOrEdition}
                onChange={(e) => setForm((f) => ({ ...f, seasonOrEdition: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Region scope</label>
              <select style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13 }}
                value={form.regionScope} onChange={(e) => setForm((f) => ({ ...f, regionScope: e.target.value as RegionScope }))}>
                {(['state', 'regional', 'national', 'international'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Registration fee (NGN, 0 = free)</label>
              <Input style={{ width: '100%' }} type="number" min={0} value={form.registrationFeeNgn}
                onChange={(e) => setForm((f) => ({ ...f, isPaid: Number(e.target.value) > 0, registrationFeeNgn: Number(e.target.value || 0) }))} />
            </div>
            <div>
              <label style={labelStyle}>Legal adult age</label>
              <Input style={{ width: '100%' }} type="number" min={10} max={30} value={form.legalAdultAge}
                onChange={(e) => setForm((f) => ({ ...f, legalAdultAge: Number(e.target.value || 18) }))} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Pitch locations / states</label>
            <div style={checkboxGrid}>
              {NIGERIA_STATES.map((s) => (
                <label key={s} style={{ fontSize: 12, color: colors.muted, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={form.auditionStates.includes(s)} onChange={() => toggleState(s)} />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: colors.muted, marginBottom: 12 }}>
            {([
              ['requiresBootcampReadiness', 'Pitch readiness questions'],
              ['supportsAuditionScheduling', 'Pitch scheduling'],
              ['supportsGroupEntry', 'Team / group entry'],
              ['supportsVoting', 'Public voting'],
              ['requiresGuardianConsentForMinors', 'Guardian consent for minors'],
              ['requiresMedical', 'Medical disclosure'],
            ] as const).map(([key, label]) => (
              <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))} />
                {label}
              </label>
            ))}
          </div>
          {formError && <p style={{ color: colors.danger, fontSize: 13, margin: '0 0 12px' }}>{formError}</p>}
          <Button variant="primary" disabled={saving} onClick={() => void submit()}>
            {saving ? 'Creating…' : 'Create pitch contest'}
          </Button>
        </Card>
      )}

      <Card title={`Pitch contests (${data?.stats.contests ?? 0})`} style={{ marginBottom: 16 }}>
        {loading ? (
          <p style={{ color: colors.muted, margin: 0 }}>Loading…</p>
        ) : !data || data.contests.length === 0 ? (
          <p style={{ color: colors.muted, margin: 0 }}>No SME Pitch contests yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Contest</th>
                  <th style={thCell}>Edition</th>
                  <th style={thCell}>Region</th>
                  <th style={thCell}>Fee</th>
                  <th style={thCell}>Applications</th>
                  <th style={thCell} />
                </tr>
              </thead>
              <tbody>
                {data.contests.map((c) => {
                  const count = data.applications.filter((a) => a.contestSlug === c.slug).length;
                  return (
                    <tr key={c.slug}>
                      <td style={tdCell}><strong>{c.title}</strong><div style={{ fontSize: 12, color: colors.muted }}>{c.slug}</div></td>
                      <td style={tdCell}>{c.seasonOrEdition}</td>
                      <td style={tdCell}>{c.regionScope}</td>
                      <td style={tdCell}>{c.isPaid ? `NGN ${c.registrationFeeNgn.toLocaleString('en-NG')}` : 'Free'}</td>
                      <td style={tdCell}>{count}</td>
                      <td style={tdCell}><Link href={`/admin/sme-pitch/${c.slug}`}><Button sm>Manage</Button></Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Recent applications (${data?.stats.applications ?? 0})`}>
        {!data || data.applications.length === 0 ? (
          <p style={{ color: colors.muted, margin: 0 }}>No SME Pitch applications yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Reference</th>
                  <th style={thCell}>Contest</th>
                  <th style={thCell}>Applicant</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Payment</th>
                </tr>
              </thead>
              <tbody>
                {data.applications.slice(0, 10).map((a) => (
                  <tr key={a.id}>
                    <td style={tdCell}>{a.reference}</td>
                    <td style={tdCell}>{a.knownContest ? a.contestSlug : a.contestTitle}</td>
                    <td style={tdCell}>{a.fullName || '—'}</td>
                    <td style={tdCell}><Badge text={a.status} color={STATUS_BADGE[a.status] ?? colors.muted} /></td>
                    <td style={tdCell}>{a.paymentStatus || '—'}</td>
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
