'use client';

import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_APPLICANT_CATEGORIES, NIGERIA_STATES } from '@/src/features/registration/config';
import {
  FIELD_CATALOG,
  CATALOG_GROUP_ORDER,
  getCategoryFieldPreset,
  getCatalogField,
} from '@/src/features/registration/field-catalog';
import type {
  ConfigurableStepKey,
  ContestCustomField,
  ContestRegistrationDefinition,
  FieldType,
} from '@/src/features/registration/types';

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

const STEP_LABELS: Record<ConfigurableStepKey, string> = {
  personal_information: 'Profile Information',
  category_specific: 'Contest Requirements',
};

const CUSTOM_FIELD_TYPES: FieldType[] = [
  'text', 'textarea', 'email', 'tel', 'url', 'number', 'date', 'select', 'multi_select', 'checkbox', 'file',
];

// Catalog grouped + ordered for the form-builder checklist.
const GROUPED_CATALOG = CATALOG_GROUP_ORDER.map((group) => ({
  group,
  fields: FIELD_CATALOG.filter((field) => field.group === group),
})).filter((section) => section.fields.length > 0);

interface CustomFieldDraft {
  id: string;
  label: string;
  type: FieldType;
  step: ConfigurableStepKey;
  required: boolean;
  optionsText: string;
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

  // ── Form-builder (per-contest input mapping) state ─────────────────────────
  const [includedFields, setIncludedFields] = useState<Set<string>>(
    () => new Set(getCategoryFieldPreset(defaultForm.contestCategory)),
  );
  const [requiredOverrides, setRequiredOverrides] = useState<Record<string, boolean>>({});
  const [customFields, setCustomFields] = useState<CustomFieldDraft[]>([]);

  const sortedStates = useMemo(() => [...NIGERIA_STATES].sort((a, b) => a.localeCompare(b)), []);

  const isFieldRequired = (key: string) => {
    if (Object.prototype.hasOwnProperty.call(requiredOverrides, key)) return requiredOverrides[key];
    return Boolean(getCatalogField(key)?.defaultRequired);
  };

  const toggleIncludedField = (key: string) => {
    setIncludedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setFieldRequired = (key: string, required: boolean) => {
    setRequiredOverrides((prev) => ({ ...prev, [key]: required }));
  };

  const seedFromCategoryPreset = (category: string) => {
    setIncludedFields(new Set(getCategoryFieldPreset(category)));
    setRequiredOverrides({});
    setCustomFields([]);
  };

  const addCustomField = () => {
    setCustomFields((prev) => [
      ...prev,
      { id: `cf_${Date.now()}_${prev.length}`, label: '', type: 'text', step: 'category_specific', required: false, optionsText: '' },
    ]);
  };

  const updateCustomField = (id: string, patch: Partial<CustomFieldDraft>) => {
    setCustomFields((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeCustomField = (id: string) => {
    setCustomFields((prev) => prev.filter((item) => item.id !== id));
  };

  const buildFormSchemaPayload = () => {
    const overrides: Record<string, boolean> = {};
    for (const key of includedFields) {
      overrides[key] = isFieldRequired(key);
    }
    const cleanedCustom: ContestCustomField[] = customFields
      .filter((cf) => cf.label.trim())
      .map((cf) => {
        const options =
          cf.type === 'select' || cf.type === 'multi_select'
            ? cf.optionsText.split(',').map((opt) => opt.trim()).filter(Boolean)
            : undefined;
        return {
          key: '',
          label: cf.label.trim(),
          type: cf.type,
          step: cf.step,
          required: cf.required,
          options: options && options.length > 0 ? options : undefined,
        };
      });
    return { version: 1 as const, includedFields: Array.from(includedFields), requiredOverrides: overrides, customFields: cleanedCustom };
  };

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
        body: JSON.stringify({ ...form, formSchema: buildFormSchemaPayload() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Failed to create contest.');
      setMessage('Contest created successfully. Contestants will only see the inputs you mapped below.');
      setForm(defaultForm);
      setSlugTouched(false);
      seedFromCategoryPreset(defaultForm.contestCategory);
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

          <div><label className="form-label">Contest category</label><select className="form-input" value={form.contestCategory} onChange={(e) => { const v = e.target.value as ContestCategory; setField('contestCategory', v); seedFromCategoryPreset(v); }}>{contestCategories.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
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

        <div className="mt-5 border-t border-border pt-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h6 className="font-display text-lg text-foreground">Form builder — contestant inputs</h6>
              <p className="text-foreground-muted text-[12px]">Only the inputs you enable here will be shown to contestants. Account login and legal consents are always included.</p>
            </div>
            <button type="button" className="btn-outline py-2 px-3 text-[11px]" onClick={() => seedFromCategoryPreset(form.contestCategory)}>
              Reset to {form.contestCategory} preset
            </button>
          </div>

          {(['personal_information', 'category_specific'] as ConfigurableStepKey[]).map((stepKey) => {
            const sections = GROUPED_CATALOG
              .map((section) => ({ group: section.group, fields: section.fields.filter((f) => f.step === stepKey) }))
              .filter((section) => section.fields.length > 0);
            const selectedCount = FIELD_CATALOG.filter((f) => f.step === stepKey && includedFields.has(f.key)).length;
            return (
              <div key={stepKey} className="mt-3">
                <div className="text-[12px] font-semibold text-foreground mb-1">
                  {STEP_LABELS[stepKey]} <span className="text-foreground-muted font-normal">— {selectedCount} selected</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {sections.map((section) => (
                    <div key={section.group} className="border border-border rounded-sm p-3">
                      <div className="text-[11px] uppercase tracking-[0.1em] text-foreground-dim mb-2">{section.group}</div>
                      <div className="space-y-1.5">
                        {section.fields.map((field) => {
                          const checked = includedFields.has(field.key);
                          return (
                            <div key={field.key} className="flex items-center justify-between gap-2">
                              <label className="text-[12px] text-foreground-muted flex items-center gap-2">
                                <input type="checkbox" checked={checked} onChange={() => toggleIncludedField(field.key)} />
                                <span>{field.label}{field.minorOnly ? ' (minors)' : ''}</span>
                              </label>
                              {checked ? (
                                <label className="text-[11px] text-foreground-dim flex items-center gap-1 shrink-0">
                                  <input type="checkbox" checked={isFieldRequired(field.key)} onChange={(e) => setFieldRequired(field.key, e.target.checked)} />
                                  required
                                </label>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold text-foreground">Custom questions</div>
              <button type="button" className="btn-outline py-1.5 px-3 text-[11px]" onClick={addCustomField}>+ Add question</button>
            </div>
            {customFields.length === 0 ? (
              <p className="text-foreground-muted text-[12px] mt-1">No custom questions. Add your own inputs beyond the catalog above.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {customFields.map((cf) => (
                  <div key={cf.id} className="border border-border rounded-sm p-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                    <div className="md:col-span-4">
                      <label className="form-label">Question label</label>
                      <input className="form-input" value={cf.label} placeholder="e.g. Which instrument do you play?" onChange={(e) => updateCustomField(cf.id, { label: e.target.value })} />
                    </div>
                    <div className="md:col-span-2">
                      <label className="form-label">Type</label>
                      <select className="form-input" value={cf.type} onChange={(e) => updateCustomField(cf.id, { type: e.target.value as FieldType })}>
                        {CUSTOM_FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-3">
                      <label className="form-label">Step</label>
                      <select className="form-input" value={cf.step} onChange={(e) => updateCustomField(cf.id, { step: e.target.value as ConfigurableStepKey })}>
                        <option value="personal_information">{STEP_LABELS.personal_information}</option>
                        <option value="category_specific">{STEP_LABELS.category_specific}</option>
                      </select>
                    </div>
                    <div className="md:col-span-2 flex items-center gap-2">
                      <label className="text-[12px] text-foreground-muted flex items-center gap-1"><input type="checkbox" checked={cf.required} onChange={(e) => updateCustomField(cf.id, { required: e.target.checked })} /> required</label>
                    </div>
                    <div className="md:col-span-1">
                      <button type="button" className="btn-outline py-2 px-2 text-[11px] w-full" onClick={() => removeCustomField(cf.id)}>Remove</button>
                    </div>
                    {(cf.type === 'select' || cf.type === 'multi_select') ? (
                      <div className="md:col-span-12">
                        <label className="form-label">Options (comma-separated)</label>
                        <input className="form-input" value={cf.optionsText} placeholder="Option A, Option B, Option C" onChange={(e) => updateCustomField(cf.id, { optionsText: e.target.value })} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" className="btn-primary py-2.5 px-4 text-[11px]" disabled={saving} onClick={() => void submit()}>
            {saving ? 'Creating...' : 'Create Contest'}
          </button>
          <button type="button" className="btn-outline py-2.5 px-4 text-[11px]" onClick={() => { setForm(defaultForm); setSlugTouched(false); seedFromCategoryPreset(defaultForm.contestCategory); }}>Reset</button>
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
