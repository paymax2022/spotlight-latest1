'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminAuthHeaders } from '@/src/lib/auth/client';
import { NIGERIA_STATES } from '@/src/features/registration/config';
import type { ContestRegistrationDefinition } from '@/src/features/registration/types';

type FormState = {
  title: string;
  slug: string;
  seasonOrEdition: string;
  regionScope: ContestRegistrationDefinition['regionScope'];
  isPaid: boolean;
  registrationFeeNgn: number;
  legalAdultAge: number;
  supportsVoting: boolean;
  supportsAuditionScheduling: boolean;
  supportsGroupEntry: boolean;
  requiresGuardianConsentForMinors: boolean;
  requiresMedical: boolean;
  requiresBootcampReadiness: boolean;
  auditionStates: string[];
  applicantCategories: string[];
};

type Props = {
  mode: 'create' | 'edit';
  contest?: ContestRegistrationDefinition;
};

const applicantOptions = ['SME Pitch', 'Entrepreneur', 'Startup', 'Small Business', 'Social Enterprise'];

function toSlug(raw: string) {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function getInitialForm(contest?: ContestRegistrationDefinition): FormState {
  return {
    title: contest?.title || 'Spotlight SME Pitch Contest',
    slug: contest?.slug || 'spotlight-sme-pitch-contest',
    seasonOrEdition: contest?.seasonOrEdition || 'Season 1',
    regionScope: contest?.regionScope || 'national',
    isPaid: contest?.isPaid ?? false,
    registrationFeeNgn: Number(contest?.registrationFeeNgn || 0),
    legalAdultAge: Number(contest?.legalAdultAge || 18),
    supportsVoting: contest?.supportsVoting ?? false,
    supportsAuditionScheduling: contest?.supportsAuditionScheduling ?? true,
    supportsGroupEntry: contest?.supportsGroupEntry ?? true,
    requiresGuardianConsentForMinors: contest?.requiresGuardianConsentForMinors ?? false,
    requiresMedical: contest?.requiresMedical ?? false,
    requiresBootcampReadiness: contest?.requiresBootcampReadiness ?? true,
    auditionStates: contest?.auditionStates?.length ? contest.auditionStates : ['Lagos'],
    applicantCategories: contest?.applicantCategories?.length
      ? contest.applicantCategories
      : ['SME Pitch', 'Entrepreneur', 'Startup'],
  };
}

export default function SmePitchContestForm({ mode, contest }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => getInitialForm(contest));
  const [slugTouched, setSlugTouched] = useState(Boolean(contest));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const states = useMemo(() => [...NIGERIA_STATES].sort((a, b) => a.localeCompare(b)), []);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => {
      const next = { ...previous, [key]: value };
      if (key === 'title' && !slugTouched) next.slug = toSlug(String(value));
      return next;
    });
  }

  function toggleState(state: string) {
    setForm((previous) => ({
      ...previous,
      auditionStates: previous.auditionStates.includes(state)
        ? previous.auditionStates.filter((item) => item !== state)
        : [...previous.auditionStates, state],
    }));
  }

  function toggleApplicantCategory(category: string) {
    setForm((previous) => ({
      ...previous,
      applicantCategories: previous.applicantCategories.includes(category)
        ? previous.applicantCategories.filter((item) => item !== category)
        : [...previous.applicantCategories, category],
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      const payload: ContestRegistrationDefinition = {
        ...form,
        contestCategory: 'sme_pitch',
        contestType: 'pitch_competition',
        registrationFeeNgn: form.isPaid ? Number(form.registrationFeeNgn || 0) : 0,
        categoryQuestionSet: 'sme_pitch',
        supportsSchoolEntry: false,
      };
      const res = await fetch(
        mode === 'edit' && contest ? `/api/admin/contests/${contest.slug}` : '/api/admin/contests',
        {
          method: mode === 'edit' ? 'PATCH' : 'POST',
          headers: await adminAuthHeaders(true),
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to save SME Pitch contest');
      router.push(mode === 'edit' ? `/admin/sme-pitch/contests/${json.contest.slug}` : '/admin/sme-pitch');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save SME Pitch contest');
      setSaving(false);
    }
  }

  async function deleteContest() {
    if (!contest) return;
    const confirmed = window.confirm(`Delete ${contest.title}? This removes the contest configuration from the admin list.`);
    if (!confirmed) return;

    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/contests/${contest.slug}`, {
        method: 'DELETE',
        headers: await adminAuthHeaders(true),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to delete SME Pitch contest');
      router.push('/admin/sme-pitch');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete SME Pitch contest');
      setDeleting(false);
    }
  }

  const isEdit = mode === 'edit';

  return (
    <form onSubmit={submit} className="glass-card rounded-md p-4 md:p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="form-label">Contest title</label>
          <input className="form-input" required value={form.title} onChange={(event) => setField('title', event.target.value)} />
        </div>
        <div>
          <label className="form-label">Slug</label>
          <input className="form-input" required value={form.slug} onChange={(event) => { setSlugTouched(true); setField('slug', toSlug(event.target.value)); }} />
        </div>
        <div>
          <label className="form-label">Season / edition</label>
          <input className="form-input" required value={form.seasonOrEdition} onChange={(event) => setField('seasonOrEdition', event.target.value)} />
        </div>
        <div>
          <label className="form-label">Region scope</label>
          <select className="form-input" value={form.regionScope} onChange={(event) => setField('regionScope', event.target.value as FormState['regionScope'])}>
            <option value="state">state</option>
            <option value="regional">regional</option>
            <option value="national">national</option>
            <option value="international">international</option>
          </select>
        </div>
        <div>
          <label className="form-label">Registration type</label>
          <select className="form-input" value={form.isPaid ? 'paid' : 'free'} onChange={(event) => setField('isPaid', event.target.value === 'paid')}>
            <option value="free">free</option>
            <option value="paid">paid</option>
          </select>
        </div>
        <div>
          <label className="form-label">Registration fee (NGN)</label>
          <input className="form-input" type="number" min={0} value={form.registrationFeeNgn} disabled={!form.isPaid} onChange={(event) => setField('registrationFeeNgn', Number(event.target.value || 0))} />
        </div>
        <div>
          <label className="form-label">Legal adult age</label>
          <input className="form-input" type="number" min={10} max={30} value={form.legalAdultAge} onChange={(event) => setField('legalAdultAge', Number(event.target.value || 18))} />
        </div>
      </div>

      <div>
        <label className="form-label">Pitch locations / states</label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-h-44 overflow-auto border border-border rounded-sm p-3">
          {states.map((state) => (
            <label key={state} className="text-[12px] text-foreground-muted flex items-center gap-2">
              <input type="checkbox" checked={form.auditionStates.includes(state)} onChange={() => toggleState(state)} />
              <span>{state}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="form-label">Applicant categories</label>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 border border-border rounded-sm p-3">
          {applicantOptions.map((category) => (
            <label key={category} className="text-[12px] text-foreground-muted flex items-center gap-2">
              <input type="checkbox" checked={form.applicantCategories.includes(category)} onChange={() => toggleApplicantCategory(category)} />
              <span>{category}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[12px] text-foreground-muted">
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.requiresBootcampReadiness} onChange={(event) => setField('requiresBootcampReadiness', event.target.checked)} /> Pitch readiness questions required</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.supportsAuditionScheduling} onChange={(event) => setField('supportsAuditionScheduling', event.target.checked)} /> Pitch scheduling enabled</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.supportsGroupEntry} onChange={(event) => setField('supportsGroupEntry', event.target.checked)} /> Team / group entry allowed</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.supportsVoting} onChange={(event) => setField('supportsVoting', event.target.checked)} /> Public voting enabled</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.requiresGuardianConsentForMinors} onChange={(event) => setField('requiresGuardianConsentForMinors', event.target.checked)} /> Guardian consent for minors</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.requiresMedical} onChange={(event) => setField('requiresMedical', event.target.checked)} /> Medical disclosure required</label>
      </div>

      {error ? <p className="text-[12px] text-red-600 bg-red-500/10 border border-red-500/30 rounded-sm px-3 py-2">{error}</p> : null}

      <div className="flex flex-wrap gap-2 pt-2">
        <button type="submit" disabled={saving || deleting} className="btn-primary py-2.5 px-4 text-[11px]">
          {saving ? 'Saving...' : isEdit ? 'Save Contest' : 'Create SME Pitch Contest'}
        </button>
        <Link href={isEdit && contest ? `/admin/sme-pitch/contests/${contest.slug}` : '/admin/sme-pitch'} className="btn-outline py-2.5 px-4 text-[11px]">Cancel</Link>
        {isEdit && contest ? (
          <button type="button" disabled={saving || deleting} onClick={() => void deleteContest()} className="btn-outline py-2.5 px-4 text-[11px]" style={{ color: '#ef4444' }}>
            {deleting ? 'Deleting...' : 'Delete Contest'}
          </button>
        ) : null}
      </div>
    </form>
  );
}
