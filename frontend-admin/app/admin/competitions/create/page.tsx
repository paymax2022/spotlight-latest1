'use client';

import { useState, useEffect, useCallback, Suspense, Fragment, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import {
  createFullContest, updateFullContest, deleteFullContest, getFullContest, setContestStatus,
  listAdminContests,
  listContestStages, createContestStage, deleteContestStage, advanceStageSurvivors,
  type FullContest, type ContestCategory, type ContestType, type RegionScope, type ContestPublishStatus,
  type AdminContest, type ContestStage, type AdvanceStageResult,
} from '@/services/contestsAdminService';
import { triggerStageEviction, finalizeStageEvictions, getContestEvictions, saveContestantFromEviction, extendGracePeriod } from '@/services/competitionsService';
import type { StageEvictionInfo } from '@/types/competitions';

// Real contest create/edit — POST/PATCH /api/admin/contests[/[slug]], the
// same route SME Pitch's console already uses. Previously this page was a
// 1222-line editor for prize pools, position awards and cash/non-cash
// benefits, all written to localStorage only — none of that has a real
// backend counterpart anywhere in this codebase, so "editing" a competition
// here never touched anything real. A contest created here with a votable
// contestType and "public voting" turned on auto-publishes to
// connect_contests, which is what the mobile app reads — that's the real
// "connect it to mobile app" path, not a fabricated prize schema.

const CATEGORIES: ContestCategory[] = [
  'music', 'acting', 'comedy_content', 'dance', 'film_production',
  'stem_innovation', 'sme_pitch', 'school_campus', 'open_mic',
  'general_reality_show', 'other',
];

const TYPES: ContestType[] = [
  'online_contest', 'physical_audition', 'hybrid_contest',
  'public_voting_contest', 'bootcamp_reality_show', 'housemate_reality_show',
  'pitch_competition', 'school_vs_school_contest', 'regional_contest',
  'national_contest', 'international_entry',
];

const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

function toSlug(raw: string) {
  return raw.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

const RECENT_PAGE_SIZE = 10;

const recentStatusColor: Record<string, string> = {
  draft: colors.muted,
  upcoming: colors.warning,
  active: colors.success,
  ended: colors.secondary,
};

function fmtRecentDate(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleDateString('en-NG') : '—';
}

type StageDraft = {
  stageName: string;
  votingStartsAt: string;
  votingEndsAt: string;
  promotionCriteria: string;
  evictionPercentage: string;
};

function emptyStageDraft(): StageDraft {
  return { stageName: '', votingStartsAt: '', votingEndsAt: '', promotionCriteria: '', evictionPercentage: '20' };
}

const labelStyle: CSSProperties = { display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 };
const selectStyle: CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13 };
const checkboxGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, maxHeight: 160, overflow: 'auto', border: `1px solid ${colors.border}`, borderRadius: 6, padding: 10 };

type FormState = Omit<FullContest, 'id' | 'status'>;

function initialForm(): FormState {
  return {
    title: '', slug: '', contestCategory: 'other', contestType: 'online_contest',
    seasonOrEdition: 'Season 1', regionScope: 'national', isPaid: false, registrationFeeNgn: 0,
    legalAdultAge: 18, supportsVoting: false, supportsAuditionScheduling: false,
    supportsGroupEntry: false, supportsSchoolEntry: false, requiresGuardianConsentForMinors: false,
    requiresMedical: false, requiresBootcampReadiness: false, auditionStates: [], applicantCategories: [],
    bannerImageUrl: '',
  };
}

function CreateCompetitionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editSlug = searchParams.get('id') || searchParams.get('slug') || '';
  const isEdit = Boolean(editSlug);

  const [form, setForm] = useState<FormState>(initialForm());
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatusState] = useState<ContestPublishStatus>('upcoming');
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState('');

  const [recent, setRecent] = useState<AdminContest[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentPage, setRecentPage] = useState(1);

  // Stages — persisted (loaded from the API once the contest exists) plus a
  // local draft list used while still creating a contest that has no id yet.
  const [stages, setStages] = useState<ContestStage[]>([]);
  const [stagesLoading, setStagesLoading] = useState(false);
  const [stagesError, setStagesError] = useState<string | null>(null);
  const [draftStages, setDraftStages] = useState<StageDraft[]>([]);
  const [stageForm, setStageForm] = useState<StageDraft>(emptyStageDraft());
  const [savingStage, setSavingStage] = useState(false);

  // The real contest UUID (public.contests.id) — the eviction endpoints below
  // are Go routes keyed on this id, not the slug the rest of this page uses.
  const [contestId, setContestId] = useState<string>('');
  const [evictingStage, setEvictingStage] = useState<number | null>(null);
  const [finalizingStage, setFinalizingStage] = useState<number | null>(null);
  const [advancingStage, setAdvancingStage] = useState<number | null>(null);
  const [advanceResults, setAdvanceResults] = useState<Record<number, AdvanceStageResult>>({});

  // Live server-side evictions (pending/saved/finalized) per contest, the
  // source of truth a judge saves against — unlike a one-shot trigger
  // response, this survives a reload and reflects saves/finalizes as they
  // happen.
  const [stageEvictions, setStageEvictions] = useState<StageEvictionInfo[]>([]);
  const [evictionsLoading, setEvictionsLoading] = useState(false);
  const [savingEvictionId, setSavingEvictionId] = useState<string | null>(null);
  const [extendingEvictionId, setExtendingEvictionId] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    setRecentError(null);
    try {
      const rows = await listAdminContests();
      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setRecent(rows);
    } catch (e) {
      setRecentError(e instanceof Error ? e.message : 'Failed to load recent contests');
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => { void loadRecent(); }, [loadRecent]);

  const loadContest = useCallback(async () => {
    if (!isEdit) return;
    setLoading(true);
    setError(null);
    try {
      const c = await getFullContest(editSlug);
      setForm({
        title: c.title, slug: c.slug, contestCategory: c.contestCategory, contestType: c.contestType,
        seasonOrEdition: c.seasonOrEdition, regionScope: c.regionScope, isPaid: c.isPaid,
        registrationFeeNgn: c.registrationFeeNgn, legalAdultAge: c.legalAdultAge,
        supportsVoting: c.supportsVoting, supportsAuditionScheduling: c.supportsAuditionScheduling,
        supportsGroupEntry: c.supportsGroupEntry, supportsSchoolEntry: c.supportsSchoolEntry,
        requiresGuardianConsentForMinors: c.requiresGuardianConsentForMinors,
        requiresMedical: c.requiresMedical, requiresBootcampReadiness: c.requiresBootcampReadiness,
        auditionStates: c.auditionStates ?? [], applicantCategories: c.applicantCategories ?? [],
        bannerImageUrl: c.bannerImageUrl ?? '',
      });
      if (c.status) setStatusState(c.status as ContestPublishStatus);
      if (c.id) setContestId(c.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contest');
    } finally {
      setLoading(false);
    }
  }, [isEdit, editSlug]);

  useEffect(() => { void loadContest(); }, [loadContest]);

  const loadStages = useCallback(async () => {
    if (!isEdit) return;
    setStagesLoading(true);
    setStagesError(null);
    try {
      setStages(await listContestStages(editSlug));
    } catch (e) {
      setStagesError(e instanceof Error ? e.message : 'Failed to load stages');
    } finally {
      setStagesLoading(false);
    }
  }, [isEdit, editSlug]);

  useEffect(() => { void loadStages(); }, [loadStages]);

  const loadEvictions = useCallback(async () => {
    if (!contestId) return;
    setEvictionsLoading(true);
    try {
      setStageEvictions(await getContestEvictions(contestId));
    } catch (e) {
      setStagesError(e instanceof Error ? e.message : 'Failed to load evictions');
    } finally {
      setEvictionsLoading(false);
    }
  }, [contestId]);

  useEffect(() => { void loadEvictions(); }, [loadEvictions]);

  const addStageToDraftOrContest = useCallback(async () => {
    if (!stageForm.stageName.trim()) { setStagesError('Stage name is required'); return; }
    setSavingStage(true);
    setStagesError(null);
    try {
      if (isEdit) {
        await createContestStage(editSlug, {
          stageName: stageForm.stageName.trim(),
          promotionCriteria: stageForm.promotionCriteria.trim() || undefined,
          votingStartsAt: stageForm.votingStartsAt || null,
          votingEndsAt: stageForm.votingEndsAt || null,
          evictionPercentage: stageForm.evictionPercentage ? Number(stageForm.evictionPercentage) : undefined,
        });
        await loadStages();
      } else {
        setDraftStages((prev) => [...prev, stageForm]);
      }
      setStageForm(emptyStageDraft());
    } catch (e) {
      setStagesError(e instanceof Error ? e.message : 'Failed to add stage');
    } finally {
      setSavingStage(false);
    }
  }, [isEdit, editSlug, stageForm, loadStages]);

  const removeStage = useCallback(async (stageId: string) => {
    setStagesError(null);
    try {
      await deleteContestStage(editSlug, stageId);
      await loadStages();
    } catch (e) {
      setStagesError(e instanceof Error ? e.message : 'Failed to remove stage');
    }
  }, [editSlug, loadStages]);

  function removeDraftStage(index: number) {
    setDraftStages((prev) => prev.filter((_, i) => i !== index));
  }

  const runEviction = useCallback(async (stage: ContestStage) => {
    if (!contestId) { setStagesError('Contest id not loaded yet — reload the page.'); return; }
    setEvictingStage(stage.stageNumber);
    setStagesError(null);
    try {
      await triggerStageEviction(contestId, stage.stageNumber, {
        evictionPercentage: stage.evictionPercentage,
      });
      await loadEvictions();
    } catch (e) {
      setStagesError(e instanceof Error ? e.message : 'Failed to trigger eviction');
    } finally {
      setEvictingStage(null);
    }
  }, [contestId, loadEvictions]);

  const runFinalize = useCallback(async (stage: ContestStage) => {
    if (!contestId) { setStagesError('Contest id not loaded yet — reload the page.'); return; }
    setFinalizingStage(stage.stageNumber);
    setStagesError(null);
    try {
      await finalizeStageEvictions(contestId, stage.stageNumber);
      await loadEvictions();
    } catch (e) {
      setStagesError(e instanceof Error ? e.message : 'Failed to finalize evictions');
    } finally {
      setFinalizingStage(null);
    }
  }, [contestId, loadEvictions]);

  const runSave = useCallback(async (evictionId: string) => {
    if (!contestId) { setStagesError('Contest id not loaded yet — reload the page.'); return; }
    setSavingEvictionId(evictionId);
    setStagesError(null);
    try {
      await saveContestantFromEviction(contestId, evictionId);
      await loadEvictions();
    } catch (e) {
      setStagesError(e instanceof Error ? e.message : 'Failed to save contestant');
    } finally {
      setSavingEvictionId(null);
    }
  }, [contestId, loadEvictions]);

  const runExtend = useCallback(async (evictionId: string) => {
    if (!contestId) { setStagesError('Contest id not loaded yet — reload the page.'); return; }
    setExtendingEvictionId(evictionId);
    setStagesError(null);
    try {
      await extendGracePeriod(contestId, evictionId, 24);
      await loadEvictions();
    } catch (e) {
      setStagesError(e instanceof Error ? e.message : 'Failed to extend grace period');
    } finally {
      setExtendingEvictionId(null);
    }
  }, [contestId, loadEvictions]);

  const runAdvance = useCallback(async (stage: ContestStage) => {
    setAdvancingStage(stage.stageNumber);
    setStagesError(null);
    try {
      const result = await advanceStageSurvivors(editSlug, stage.stageNumber);
      setAdvanceResults((prev) => ({ ...prev, [stage.stageNumber]: result }));
      if (!result.blockedReason) await loadStages();
    } catch (e) {
      setStagesError(e instanceof Error ? e.message : 'Failed to advance stage survivors');
    } finally {
      setAdvancingStage(null);
    }
  }, [editSlug, loadStages]);

  const publish = useCallback(async (next: ContestPublishStatus) => {
    setPublishing(true);
    setError(null);
    try {
      const result = await setContestStatus(editSlug, next);
      setStatusState(next);
      setToast(`Status set to "${next}" — mobile app now sees: ${result.mobileStatus ?? 'not mirrored'}`);
      setTimeout(() => setToast(''), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish contest');
    } finally {
      setPublishing(false);
    }
  }, [editSlug]);

  function setTitle(title: string) {
    setForm((f) => ({ ...f, title, slug: slugTouched ? f.slug : toSlug(title) }));
  }

  function toggleState(state: string) {
    setForm((f) => ({
      ...f,
      auditionStates: f.auditionStates.includes(state) ? f.auditionStates.filter((s) => s !== state) : [...f.auditionStates, state],
    }));
  }

  const save = useCallback(async () => {
    if (!form.title.trim() || !form.slug.trim()) { setError('Title and slug are required'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form, title: form.title.trim(), slug: form.slug.trim(), registrationFeeNgn: form.isPaid ? form.registrationFeeNgn : 0 };
      const saved = isEdit ? await updateFullContest(editSlug, payload) : await createFullContest(payload);
      if (saved.id) setContestId(saved.id);

      // Flush any stages queued while the contest didn't have an id yet.
      if (!isEdit && draftStages.length > 0) {
        for (const draft of draftStages) {
          await createContestStage(saved.slug, {
            stageName: draft.stageName.trim(),
            promotionCriteria: draft.promotionCriteria.trim() || undefined,
            votingStartsAt: draft.votingStartsAt || null,
            votingEndsAt: draft.votingEndsAt || null,
            evictionPercentage: draft.evictionPercentage ? Number(draft.evictionPercentage) : undefined,
          }).catch((e) => {
            setStagesError(e instanceof Error ? e.message : `Failed to save stage "${draft.stageName}"`);
          });
        }
        setDraftStages([]);
      }

      setRecentPage(1);
      await loadRecent();
      router.push(`/admin/competitions/create?id=${saved.slug}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save contest');
    } finally {
      setSaving(false);
    }
  }, [form, isEdit, editSlug, router, loadRecent, draftStages]);

  const remove = useCallback(async () => {
    if (!isEdit) return;
    if (!window.confirm(`Delete ${form.title}? This removes the contest configuration.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteFullContest(editSlug);
      router.push('/admin/competitions/list');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete contest');
      setDeleting(false);
    }
  }, [isEdit, editSlug, form.title, router]);

  if (loading) return <Page><p style={{ color: colors.muted }}>Loading contest…</p></Page>;

  return (
    <Page>
      <Link href="/admin/competitions/list" style={{ fontSize: 13, color: colors.primary, textDecoration: 'none' }}>← Competitions</Link>
      <PageHeader
        title={isEdit ? `Edit: ${form.title || editSlug}` : 'Create Competition'}
        subtitle="Real contest, written to public.contests. Any contest with public voting turned on auto-publishes to connect_contests — the table the mobile app reads."
      />

      {toast && <p style={{ color: colors.success, fontSize: 13 }}>{toast}</p>}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {isEdit && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              Status: <span style={{ color: status === 'active' ? colors.success : status === 'ended' ? colors.muted : colors.warning }}>{status}</span>
            </span>
            <span style={{ fontSize: 12, color: colors.muted }}>
              {status === 'active' ? 'Live and votable on mobile right now.' : status === 'ended' ? 'Closed — visible but not accepting votes.' : status === 'upcoming' ? 'Visible on web, hidden on mobile until activated.' : 'Hidden everywhere.'}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {status !== 'active' && (
                <Button sm variant="primary" disabled={publishing} onClick={() => void publish('active')}>
                  {publishing ? 'Publishing…' : 'Publish (go live on mobile)'}
                </Button>
              )}
              {status === 'active' && (
                <Button sm variant="danger" disabled={publishing} onClick={() => void publish('ended')}>
                  {publishing ? 'Ending…' : 'End contest'}
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Title</label>
            <Input style={{ width: '100%' }} value={form.title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Slug</label>
            <Input style={{ width: '100%' }} value={form.slug} onChange={(e) => { setSlugTouched(true); setForm((f) => ({ ...f, slug: toSlug(e.target.value) })); }} />
          </div>
          <div>
            <label style={labelStyle}>Season / edition</label>
            <Input style={{ width: '100%' }} value={form.seasonOrEdition} onChange={(e) => setForm((f) => ({ ...f, seasonOrEdition: e.target.value }))} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Banner image URL</label>
          <Input
            style={{ width: '100%' }}
            value={form.bannerImageUrl ?? ''}
            placeholder="https://…"
            onChange={(e) => setForm((f) => ({ ...f, bannerImageUrl: e.target.value }))}
          />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: colors.muted }}>
            Shown on the mobile contest list and detail screens. Leave blank for the default placeholder tile.
          </p>
          {form.bannerImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={form.bannerImageUrl}
              alt=""
              style={{ marginTop: 8, maxWidth: 320, height: 120, objectFit: 'cover', borderRadius: 8, border: `1px solid ${colors.border}` }}
            />
          ) : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Category</label>
            <select style={selectStyle} value={form.contestCategory} onChange={(e) => setForm((f) => ({ ...f, contestCategory: e.target.value as ContestCategory }))}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Type</label>
            <select style={selectStyle} value={form.contestType} onChange={(e) => setForm((f) => ({ ...f, contestType: e.target.value as ContestType }))}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Region scope</label>
            <select style={selectStyle} value={form.regionScope} onChange={(e) => setForm((f) => ({ ...f, regionScope: e.target.value as RegionScope }))}>
              {(['state', 'regional', 'national', 'international'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
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

        <div style={{
          padding: 12, borderRadius: 8, marginBottom: 12,
          background: colors.bg,
          border: `1px solid ${colors.primary}`,
        }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600 }}>
            <input type="checkbox" checked={form.supportsVoting}
              onChange={(e) => setForm((f) => ({ ...f, supportsVoting: e.target.checked }))} />
            Enable public voting (publishes to the mobile app)
          </label>
          <p style={{ margin: '6px 0 0', fontSize: 11, color: colors.muted }}>
            Any contest type can carry public voting. Turning this on mirrors it into connect_contests, which is what mobile&apos;s contest list reads — it will appear on the phone.
          </p>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Audition / entry states</label>
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
            ['supportsAuditionScheduling', 'Audition scheduling'],
            ['supportsGroupEntry', 'Team / group entry'],
            ['supportsSchoolEntry', 'School entry'],
            ['requiresGuardianConsentForMinors', 'Guardian consent for minors'],
            ['requiresMedical', 'Medical disclosure'],
            ['requiresBootcampReadiness', 'Bootcamp readiness questions'],
          ] as const).map(([key, label]) => (
            <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))} />
              {label}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" disabled={saving || deleting} onClick={() => void save()}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create competition'}
          </Button>
          {isEdit && (
            <Button variant="danger" disabled={saving || deleting} onClick={() => void remove()}>
              {deleting ? 'Deleting…' : 'Delete competition'}
            </Button>
          )}
        </div>
      </Card>

      <Card title="Stages" style={{ marginBottom: 16 }}>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: colors.muted }}>
          {isEdit
            ? 'Contestants are auto-assigned to Stage 1 as soon as it exists. Each stage runs for a defined window: Run eviction marks the bottom Evicts% for elimination (with a grace period a judge can still save them in), Finalize locks that in once the grace period passes, and Advance survivors moves everyone else into the next stage.'
            : 'Queue stages now — they are created together with the contest when you save. Running eviction and advancing survivors happens afterwards, from this page in edit mode.'}
        </p>

        {stagesError && <p style={{ color: colors.danger, fontSize: 13, margin: '0 0 12px' }}>{stagesError}</p>}
        {evictionsLoading && <p style={{ color: colors.muted, fontSize: 12, margin: '0 0 12px' }}>Refreshing evictions…</p>}

        {(isEdit ? stagesLoading : false) ? (
          <p style={{ color: colors.muted, margin: '0 0 12px' }}>Loading stages…</p>
        ) : (
          <div style={{ marginBottom: 12 }}>
            {(isEdit ? stages.length === 0 : draftStages.length === 0) ? (
              <p style={{ color: colors.muted, fontSize: 13, margin: '0 0 12px' }}>No stages yet.</p>
            ) : (
              <div style={{ overflowX: 'auto', marginBottom: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thCell}>#</th>
                      <th style={thCell}>Name</th>
                      <th style={thCell}>Starts / Ends</th>
                      <th style={thCell}>Promotion criteria</th>
                      <th style={thCell}>Evicts</th>
                      <th style={thCell} />
                    </tr>
                  </thead>
                  <tbody>
                    {isEdit
                      ? stages.map((s) => (
                        <Fragment key={s.id}>
                          <tr>
                            <td style={tdCell}>{s.stageNumber}</td>
                            <td style={tdCell}><strong>{s.stageName}</strong></td>
                            <td style={tdCell}>{fmtRecentDate(s.votingStartsAt)} – {fmtRecentDate(s.votingEndsAt)}</td>
                            <td style={tdCell}>{s.promotionCriteria || '—'}</td>
                            <td style={tdCell}>{s.evictionPercentage}%</td>
                            <td style={tdCell}>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <Button sm disabled={evictingStage === s.stageNumber} onClick={() => void runEviction(s)}>
                                  {evictingStage === s.stageNumber ? 'Evicting…' : 'Run eviction'}
                                </Button>
                                <Button sm disabled={finalizingStage === s.stageNumber} onClick={() => void runFinalize(s)}>
                                  {finalizingStage === s.stageNumber ? 'Finalizing…' : 'Finalize'}
                                </Button>
                                <Button sm variant="primary" disabled={advancingStage === s.stageNumber} onClick={() => void runAdvance(s)}>
                                  {advancingStage === s.stageNumber ? 'Advancing…' : 'Advance survivors'}
                                </Button>
                                <Button sm variant="danger" onClick={() => void removeStage(s.id)}>Remove</Button>
                              </div>
                            </td>
                          </tr>
                          {(() => {
                            const stageEvictionRows = stageEvictions.filter((e) => e.stage_number === s.stageNumber);
                            const pending = stageEvictionRows.filter((e) => e.status === 'pending');
                            const resolved = stageEvictionRows.filter((e) => e.status !== 'pending');
                            if (stageEvictionRows.length === 0) return null;
                            return (
                              <tr>
                                <td />
                                <td colSpan={5} style={{ ...tdCell, background: colors.headBg }}>
                                  <div style={{ fontSize: 12, color: colors.text }}>
                                    {pending.length > 0 && (
                                      <>
                                        <strong>{pending.length} contestant(s) pending eviction</strong>. A judge can save one
                                        contestant per stage before its grace period ends; click <em>Finalize</em> once a grace
                                        period has passed to make that eviction permanent.
                                        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                                          {pending.map((r) => (
                                            <li key={r.id} style={{ marginBottom: 4 }}>
                                              {r.contestant_name || r.contestant_id} — {r.vote_count} votes (rank #{r.eviction_rank}) —
                                              grace period until {fmtRecentDate(r.grace_period_ends_at)}{' '}
                                              <Button
                                                sm
                                                variant="outline"
                                                disabled={savingEvictionId === r.id || !r.can_be_saved}
                                                onClick={() => void runSave(r.id)}
                                                style={{ marginLeft: 8 }}
                                              >
                                                {savingEvictionId === r.id ? 'Saving…' : 'Save'}
                                              </Button>
                                              <Button
                                                sm
                                                variant="outline"
                                                disabled={extendingEvictionId === r.id}
                                                onClick={() => void runExtend(r.id)}
                                                style={{ marginLeft: 6 }}
                                              >
                                                {extendingEvictionId === r.id ? 'Extending…' : 'Extend +24h'}
                                              </Button>
                                            </li>
                                          ))}
                                        </ul>
                                      </>
                                    )}
                                    {resolved.length > 0 && (
                                      <p style={{ margin: pending.length > 0 ? '8px 0 0' : 0, color: colors.muted }}>
                                        {resolved.filter((e) => e.status === 'saved').length > 0 &&
                                          `${resolved.filter((e) => e.status === 'saved').length} saved by a judge. `}
                                        {resolved.filter((e) => e.status === 'finalized').length > 0 &&
                                          `${resolved.filter((e) => e.status === 'finalized').length} finalized (evicted).`}
                                      </p>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })()}
                          {advanceResults[s.stageNumber] && (
                            <tr>
                              <td />
                              <td colSpan={5} style={{ ...tdCell, background: advanceResults[s.stageNumber].blockedReason ? '#fff4e5' : colors.headBg }}>
                                {advanceResults[s.stageNumber].blockedReason ? (
                                  <span style={{ fontSize: 12, color: colors.warning }}>⚠ {advanceResults[s.stageNumber].blockedReason}</span>
                                ) : (
                                  <span style={{ fontSize: 12, color: colors.success }}>
                                    ✓ {advanceResults[s.stageNumber].advancedCount} survivor(s) advanced to Stage {advanceResults[s.stageNumber].nextStageNumber}.
                                  </span>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))
                      : draftStages.map((d, i) => (
                        <tr key={i}>
                          <td style={tdCell}>{i + 1}</td>
                          <td style={tdCell}><strong>{d.stageName}</strong></td>
                          <td style={tdCell}>{d.votingStartsAt || '—'} – {d.votingEndsAt || '—'}</td>
                          <td style={tdCell}>{d.promotionCriteria || '—'}</td>
                          <td style={tdCell}>{d.evictionPercentage || 20}%</td>
                          <td style={tdCell}>
                            <Button sm variant="danger" onClick={() => removeDraftStage(i)}>Remove</Button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Stage name</label>
            <Input style={{ width: '100%' }} placeholder="e.g., Auditions, Semi-final, Grand finale"
              value={stageForm.stageName} onChange={(e) => setStageForm((f) => ({ ...f, stageName: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Starts</label>
            <Input style={{ width: '100%' }} type="date" value={stageForm.votingStartsAt}
              onChange={(e) => setStageForm((f) => ({ ...f, votingStartsAt: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Ends</label>
            <Input style={{ width: '100%' }} type="date" value={stageForm.votingEndsAt}
              onChange={(e) => setStageForm((f) => ({ ...f, votingEndsAt: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Evicts bottom %</label>
            <Input style={{ width: '100%' }} type="number" min={1} max={99} value={stageForm.evictionPercentage}
              onChange={(e) => setStageForm((f) => ({ ...f, evictionPercentage: e.target.value }))} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Promotion criteria</label>
          <Input style={{ width: '100%' }} placeholder="e.g., Top 10 by votes advance to the next stage"
            value={stageForm.promotionCriteria} onChange={(e) => setStageForm((f) => ({ ...f, promotionCriteria: e.target.value }))} />
        </div>
        <Button variant="primary" type="button" disabled={savingStage} onClick={() => void addStageToDraftOrContest()}>
          {savingStage ? 'Adding…' : isEdit ? 'Add stage' : 'Queue stage'}
        </Button>
      </Card>

      <Card title="Recently Created Contests" style={{ padding: 0, overflow: 'hidden' }}>
        {recentError && (
          <div style={{ padding: '0.75rem 1rem', color: colors.danger, fontSize: '0.85rem' }}>{recentError}</div>
        )}
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thCell}>Name</th>
              <th style={thCell}>Type</th>
              <th style={thCell}>Status</th>
              <th style={thCell}>Starts / Ends</th>
              <th style={thCell}>Created</th>
            </tr>
          </thead>
          <tbody>
            {recentLoading ? (
              <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={5}>Loading…</td></tr>
            ) : recent.length === 0 ? (
              <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={5}>No contests created yet.</td></tr>
            ) : (
              recent.slice((recentPage - 1) * RECENT_PAGE_SIZE, recentPage * RECENT_PAGE_SIZE).map((c) => (
                <tr key={c.id}>
                  <td style={tdCell}>
                    {c.slug ? (
                      <Link href={`/admin/competitions/create?id=${c.slug}`} style={{ color: colors.text, textDecoration: 'none', fontWeight: 600 }}>
                        {c.name}
                      </Link>
                    ) : (
                      <span style={{ fontWeight: 600 }}>{c.name} <span style={{ fontSize: 11, color: colors.muted, fontWeight: 400 }}>(no slug on file)</span></span>
                    )}
                  </td>
                  <td style={tdCell}>{c.contest_type}</td>
                  <td style={tdCell}><Badge text={c.status} color={recentStatusColor[c.status] ?? colors.muted} /></td>
                  <td style={tdCell}>{fmtRecentDate(c.start_date)} – {fmtRecentDate(c.end_date)}</td>
                  <td style={tdCell}>{fmtRecentDate(c.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderTop: `1px solid ${colors.border}`, fontSize: '0.85rem', color: colors.muted }}>
          <span>
            {recent.length === 0
              ? 'Showing 0 of 0 contests'
              : `Showing ${(recentPage - 1) * RECENT_PAGE_SIZE + 1}–${Math.min(recentPage * RECENT_PAGE_SIZE, recent.length)} of ${recent.length} contests`}
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button variant="outline" sm type="button" disabled={recentPage <= 1} onClick={() => setRecentPage((p) => Math.max(1, p - 1))}>
              Previous
            </Button>
            <span>Page {recentPage} of {Math.max(1, Math.ceil(recent.length / RECENT_PAGE_SIZE))}</span>
            <Button
              variant="outline"
              sm
              type="button"
              disabled={recentPage >= Math.max(1, Math.ceil(recent.length / RECENT_PAGE_SIZE))}
              onClick={() => setRecentPage((p) => Math.min(Math.max(1, Math.ceil(recent.length / RECENT_PAGE_SIZE)), p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </Page>
  );
}

export default function CreateCompetitionPage() {
  return (
    <Suspense fallback={<Page><p style={{ color: colors.muted }}>Loading…</p></Page>}>
      <CreateCompetitionContent />
    </Suspense>
  );
}
