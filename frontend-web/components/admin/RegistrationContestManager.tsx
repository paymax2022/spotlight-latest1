'use client';

import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_APPLICANT_CATEGORIES, NIGERIA_STATES } from '@/src/features/registration/config';
import type { ContestRegistrationDefinition } from '@/src/features/registration/types';

type ContestCategory = ContestRegistrationDefinition['contestCategory'];
type ContestType = ContestRegistrationDefinition['contestType'];

const contestCategories: ContestCategory[] = [
  'general_reality_show',
  'music',
  'acting',
  'comedy_content',
  'dance',
  'film_production',
  'stem_innovation',
  'sme_pitch',
  'school_campus',
  'open_mic',
  'other',
];

const contestTypes: ContestType[] = [
  'housemate_reality_show',
  'bootcamp_reality_show',
  'public_voting_contest',
  'hybrid_contest',
  'physical_audition',
  'online_contest',
  'pitch_competition',
  'school_vs_school_contest',
  'regional_contest',
  'national_contest',
  'international_entry',
];

const applicantPreset: Record<string, string[]> = {
  general_reality_show: ['General Reality Show', 'Music', 'Acting', 'Dance', 'Comedy', 'Content Creation'],
  open_mic: ['Open Mic', 'Music', 'Spoken Word'],
  stem_innovation: ['STEM / Innovation', 'School Talent', 'Campus Talent'],
  sme_pitch: ['SME Pitch', 'Entrepreneur', 'Startup'],
};

function toSlug(raw: string) {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

const defaultForm = {
  title: 'Spotlight Reality TV Show Contest',
  slug: 'spotlight-reality-tv-show-contest',
  contestCategory: 'general_reality_show' as ContestCategory,
  contestType: 'housemate_reality_show' as ContestType,
  seasonOrEdition: 'Season 1',
  regionScope: 'national' as ContestRegistrationDefinition['regionScope'],
  isPaid: true,
  registrationFeeNgn: 5000,
  legalAdultAge: 18,
  requiresGuardianConsentForMinors: true,
  requiresMedical: true,
  requiresBootcampReadiness: true,
  supportsVoting: true,
  supportsAuditionScheduling: true,
  supportsSchoolEntry: false,
  supportsGroupEntry: false,
  auditionStates: ['Lagos'],
  applicantCategories: ['General Reality Show', 'Music', 'Acting'],
};

export default function RegistrationContestManager() {
  const [contests, setContests] = useState<ContestRegistrationDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState(defaultForm);
  const [slugTouched, setSlugTouched] = useState(false);

  const sortedStates = useMemo(() => [...NIGERIA_STATES].sort((a, b) => a.localeCompare(b)), []);

  const loadContests = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/contests', { cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Failed to load contests.');
      setContests(Array.isArray(payload?.contests) ? payload.contests : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadContests();
  }, []);

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'title' && !slugTouched) next.slug = toSlug(String(value));
      if (key === 'contestCategory') {
        const preset = applicantPreset[String(value)] || DEFAULT_APPLICANT_CATEGORIES.slice(0, 3);
        next.applicantCategories = preset;
      }
      return next;
    });
  };

  const toggleState = (state: string) => {
    setForm((prev) => {
      const exists = prev.auditionStates.includes(state);
      return {
        ...prev,
        auditionStates: exists ? prev.auditionStates.filter((item) => item !== state) : [...prev.auditionStates, state],
      };
    });
  };

  const toggleApplicantCategory = (category: string) => {
    setForm((prev) => {
      const exists = prev.applicantCategories.includes(category);
      return {
        ...prev,
        applicantCategories: exists ? prev.applicantCategories.filter((item) => item !== category) : [...prev.applicantCategories, category],
      };
    });
  };

  const submit = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/contests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Failed to create contest.');
      setMessage('Contest created successfully and is available in the registration contest list.');
      setForm(defaultForm);
      setSlugTouched(false);
      await loadContests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create contest.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl md:text-4xl text-foreground">Contests</h1>
        <p className="text-foreground-muted mt-1">Create and manage registration contests, including Reality TV show contests.</p>
      </div>

      <div className="glass-card rounded-md p-4 md:p-5">
        <h5 className="font-display text-xl text-foreground mb-3">Create Reality TV Show Contest</h5>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><label className="form-label">Contest title</label><input className="form-input" value={form.title} onChange={(e) => setField('title', e.target.value)} /></div>
          <div><label className="form-label">Slug</label><input className="form-input" value={form.slug} onChange={(e) => { setSlugTouched(true); setField('slug', toSlug(e.target.value)); }} /></div>
          <div><label className="form-label">Season / edition</label><input className="form-input" value={form.seasonOrEdition} onChange={(e) => setField('seasonOrEdition', e.target.value)} /></div>

          <div><label className="form-label">Contest category</label><select className="form-input" value={form.contestCategory} onChange={(e) => setField('contestCategory', e.target.value as ContestCategory)}>{contestCategories.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
          <div><label className="form-label">Contest type</label><select className="form-input" value={form.contestType} onChange={(e) => setField('contestType', e.target.value as ContestType)}>{contestTypes.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
          <div><label className="form-label">Region scope</label><select className="form-input" value={form.regionScope} onChange={(e) => setField('regionScope', e.target.value as ContestRegistrationDefinition['regionScope'])}><option value="state">state</option><option value="regional">regional</option><option value="national">national</option><option value="international">international</option></select></div>

          <div><label className="form-label">Legal adult age</label><input className="form-input" type="number" min={10} max={30} value={form.legalAdultAge} onChange={(e) => setField('legalAdultAge', Number(e.target.value || 18))} /></div>
          <div>
            <label className="form-label">Registration type</label>
            <select className="form-input" value={form.isPaid ? 'paid' : 'free'} onChange={(e) => setField('isPaid', e.target.value === 'paid')}>
              <option value="paid">paid</option>
              <option value="free">free</option>
            </select>
          </div>
          <div><label className="form-label">Registration fee (NGN)</label><input className="form-input" type="number" min={0} value={form.registrationFeeNgn} onChange={(e) => setField('registrationFeeNgn', Number(e.target.value || 0))} disabled={!form.isPaid} /></div>
        </div>

        <div className="mt-3">
          <label className="form-label">Audition states</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-h-44 overflow-auto border border-border rounded-sm p-3">
            {sortedStates.map((state) => (
              <label key={state} className="text-[12px] text-foreground-muted flex items-center gap-2">
                <input type="checkbox" checked={form.auditionStates.includes(state)} onChange={() => toggleState(state)} />
                <span>{state}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <label className="form-label">Applicant categories</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 border border-border rounded-sm p-3">
            {DEFAULT_APPLICANT_CATEGORIES.map((category) => (
              <label key={category} className="text-[12px] text-foreground-muted flex items-center gap-2">
                <input type="checkbox" checked={form.applicantCategories.includes(category)} onChange={() => toggleApplicantCategory(category)} />
                <span>{category}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-[12px] text-foreground-muted">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.requiresGuardianConsentForMinors} onChange={(e) => setField('requiresGuardianConsentForMinors', e.target.checked)} /> Guardian consent for minors</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.requiresMedical} onChange={(e) => setField('requiresMedical', e.target.checked)} /> Medical disclosure required</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.requiresBootcampReadiness} onChange={(e) => setField('requiresBootcampReadiness', e.target.checked)} /> Bootcamp readiness required</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.supportsVoting} onChange={(e) => setField('supportsVoting', e.target.checked)} /> Public voting enabled</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.supportsAuditionScheduling} onChange={(e) => setField('supportsAuditionScheduling', e.target.checked)} /> Audition scheduling enabled</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.supportsGroupEntry} onChange={(e) => setField('supportsGroupEntry', e.target.checked)} /> Group entry allowed</label>
        </div>

        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-primary py-2.5 px-4 text-[11px]" disabled={saving} onClick={() => void submit()}>
            {saving ? 'Creating...' : 'Create Contest'}
          </button>
          <button type="button" className="btn-outline py-2.5 px-4 text-[11px]" onClick={() => { setForm(defaultForm); setSlugTouched(false); }}>Reset</button>
        </div>

        {message ? <p className="mt-2 text-[12px] text-green-700">{message}</p> : null}
        {error ? <p className="mt-2 text-[12px] text-red-600">{error}</p> : null}
      </div>

      <div className="glass-card rounded-md p-4 md:p-5">
        <h5 className="font-display text-xl text-foreground mb-3">Configured Contests</h5>
        {loading ? (
          <p className="text-foreground-muted">Loading contests...</p>
        ) : contests.length === 0 ? (
          <p className="text-foreground-muted">No contests configured yet.</p>
        ) : (
          <div className="overflow-x-auto border border-border rounded-sm">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-bg-card">
                <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                  <th className="py-3 px-3">Title</th>
                  <th className="py-3 px-3">Slug</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3">Fee</th>
                  <th className="py-3 px-3">Audition states</th>
                </tr>
              </thead>
              <tbody>
                {contests.map((contest) => (
                  <tr key={contest.slug} className="border-t border-border text-foreground-muted">
                    <td className="py-2.5 px-3">{contest.title}</td>
                    <td className="py-2.5 px-3">{contest.slug}</td>
                    <td className="py-2.5 px-3">{contest.contestCategory}</td>
                    <td className="py-2.5 px-3">{contest.contestType}</td>
                    <td className="py-2.5 px-3">{contest.isPaid ? `NGN ${Number(contest.registrationFeeNgn || 0).toLocaleString('en-NG')}` : 'Free'}</td>
                    <td className="py-2.5 px-3">{(contest.auditionStates || []).slice(0, 3).join(', ')}{(contest.auditionStates || []).length > 3 ? '...' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
