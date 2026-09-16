'use client';

/**
 * SME Pitch — contest detail console (admin consolidation; see
 * docs/adr/ADR-047-admin-console-consolidation-path-a.md).
 * Edit the pitch contest configuration, delete it, and review its
 * applications — consolidates frontend-web's separate edit/applications
 * pages into one, same approach as the Open Mic contest detail page.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getSmePitchContest, updateSmePitchContest, deleteSmePitchContest,
  getSmePitchConsole, NIGERIA_STATES,
  type SmePitchContest, type SmePitchApplication, type RegionScope,
} from '@/services/smePitchAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_BADGE: Record<string, string> = {
  draft: colors.muted,
  submitted: colors.info,
  shortlisted: colors.primary,
  approved: colors.success,
  rejected: colors.danger,
};

const labelStyle: CSSProperties = { display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 };
const checkboxGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, maxHeight: 160, overflow: 'auto', border: `1px solid ${colors.border}`, borderRadius: 6, padding: 10 };

type FormState = {
  title: string; slug: string; seasonOrEdition: string; regionScope: RegionScope;
  isPaid: boolean; registrationFeeNgn: number; legalAdultAge: number;
  supportsVoting: boolean; supportsAuditionScheduling: boolean; supportsGroupEntry: boolean;
  requiresGuardianConsentForMinors: boolean; requiresMedical: boolean; requiresBootcampReadiness: boolean;
  auditionStates: string[]; applicantCategories: string[];
};

function toFormState(c: SmePitchContest): FormState {
  return {
    title: c.title, slug: c.slug, seasonOrEdition: c.seasonOrEdition, regionScope: c.regionScope,
    isPaid: c.isPaid, registrationFeeNgn: c.registrationFeeNgn, legalAdultAge: c.legalAdultAge,
    supportsVoting: c.supportsVoting, supportsAuditionScheduling: c.supportsAuditionScheduling,
    supportsGroupEntry: c.supportsGroupEntry, requiresGuardianConsentForMinors: c.requiresGuardianConsentForMinors,
    requiresMedical: c.requiresMedical, requiresBootcampReadiness: c.requiresBootcampReadiness,
    auditionStates: c.auditionStates ?? [], applicantCategories: c.applicantCategories ?? [],
  };
}

export default function SmePitchContestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug as string;

  const [form, setForm] = useState<FormState | null>(null);
  const [applications, setApplications] = useState<SmePitchApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [contest, console_] = await Promise.all([getSmePitchContest(slug), getSmePitchConsole()]);
      setForm(toFormState(contest));
      setApplications(console_.applications.filter((a) => a.contestSlug === slug));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contest');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { if (slug) void load(); }, [slug, load]);

  function toggleState(state: string) {
    setForm((f) => f && ({
      ...f,
      auditionStates: f.auditionStates.includes(state) ? f.auditionStates.filter((s) => s !== state) : [...f.auditionStates, state],
    }));
  }

  const save = useCallback(async () => {
    if (!form) return;
    if (!form.title.trim() || !form.slug.trim()) { setError('Title and slug are required'); return; }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateSmePitchContest(slug, {
        ...form,
        title: form.title.trim(),
        slug: form.slug.trim(),
        registrationFeeNgn: form.isPaid ? form.registrationFeeNgn : 0,
        auditionStates: form.supportsAuditionScheduling ? form.auditionStates : [],
      });
      if (updated.slug !== slug) {
        router.push(`/admin/sme-pitch/${updated.slug}`);
        return;
      }
      setToast('Contest saved');
      setTimeout(() => setToast(''), 2500);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save contest');
    } finally {
      setSaving(false);
    }
  }, [form, slug, load, router]);

  const remove = useCallback(async () => {
    if (!form) return;
    if (!window.confirm(`Delete ${form.title}? This removes the contest configuration.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSmePitchContest(slug);
      router.push('/admin/sme-pitch');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete contest');
      setDeleting(false);
    }
  }, [form, slug, router]);

  if (loading && !form) return <Page><p style={{ color: colors.muted }}>Loading contest…</p></Page>;
  if (!form) return <Page><p style={{ color: colors.danger }}>{error || 'Contest not found'}</p></Page>;

  return (
    <Page>
      <Link href="/admin/sme-pitch" style={{ fontSize: 13, color: colors.primary, textDecoration: 'none' }}>← SME Pitch</Link>
      <PageHeader title={form.title} subtitle={`${applications.length} application${applications.length === 1 ? '' : 's'}`} />
      {toast && <div style={{ marginBottom: 12, color: colors.success, fontSize: 13 }}>{toast}</div>}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card title="Contest configuration" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Contest title</label>
            <Input style={{ width: '100%' }} value={form.title} onChange={(e) => setForm((f) => f && ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Slug</label>
            <Input style={{ width: '100%' }} value={form.slug} onChange={(e) => setForm((f) => f && ({ ...f, slug: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Season / edition</label>
            <Input style={{ width: '100%' }} value={form.seasonOrEdition} onChange={(e) => setForm((f) => f && ({ ...f, seasonOrEdition: e.target.value }))} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Region scope</label>
            <select style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13 }}
              value={form.regionScope} onChange={(e) => setForm((f) => f && ({ ...f, regionScope: e.target.value as RegionScope }))}>
              {(['state', 'regional', 'national', 'international'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Registration fee (NGN, 0 = free)</label>
            <Input style={{ width: '100%' }} type="number" min={0} value={form.registrationFeeNgn}
              onChange={(e) => setForm((f) => f && ({ ...f, isPaid: Number(e.target.value) > 0, registrationFeeNgn: Number(e.target.value || 0) }))} />
          </div>
          <div>
            <label style={labelStyle}>Legal adult age</label>
            <Input style={{ width: '100%' }} type="number" min={10} max={30} value={form.legalAdultAge}
              onChange={(e) => setForm((f) => f && ({ ...f, legalAdultAge: Number(e.target.value || 18) }))} />
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
              <input type="checkbox" checked={form[key]} onChange={(e) => setForm((f) => f && ({ ...f, [key]: e.target.checked }))} />
              {label}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" disabled={saving || deleting} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save contest'}
          </Button>
          <Button variant="danger" disabled={saving || deleting} onClick={() => void remove()}>
            {deleting ? 'Deleting…' : 'Delete contest'}
          </Button>
        </div>
      </Card>

      <Card title={`Applications (${applications.length})`}>
        {applications.length === 0 ? (
          <p style={{ color: colors.muted, margin: 0 }}>No applications yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Reference</th>
                  <th style={thCell}>Applicant</th>
                  <th style={thCell}>Email</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Payment</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((a) => (
                  <tr key={a.id}>
                    <td style={tdCell}>{a.reference}</td>
                    <td style={tdCell}>{a.fullName || '—'}</td>
                    <td style={tdCell}>{a.email || '—'}</td>
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
