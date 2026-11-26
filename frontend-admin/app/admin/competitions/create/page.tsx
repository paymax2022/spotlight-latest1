'use client';

import { useState, useEffect, useCallback, Suspense, Fragment, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import {
  createFullContest, updateFullContest, deleteFullContest, getFullContest, setContestStatus,
  listAdminContests, uploadContestBanner, uploadContestLogo, adminMediaUrl,
  listContestStages, createContestStage, deleteContestStage, advanceStageSurvivors,
  type FullContest, type ContestCategory, type ContestType, type RegionScope, type ContestPublishStatus,
  type AdminContest, type ContestStage, type AdvanceStageResult,
} from '@/services/contestsAdminService';
import { triggerStageEviction, finalizeStageEvictions, getContestEvictions, saveContestantFromEviction, extendGracePeriod } from '@/services/competitionsService';
import {
  listVotePackageTemplates, applyTemplatesToContest, listVotePackages, formatNaira,
  type VotePackageTemplate,
} from '@/services/votePackagesService';
import type { StageEvictionInfo } from '@/types/competitions';
import { listContestCategories, type ContestCategoryRow } from '@/services/contestCategoriesService';
import { listLocalGovernments, listVillages, type LocalityMode } from '@/services/localityAdminService';

// Real contest create/edit — POST/PATCH /api/admin/contests[/[slug]], the
// same route SME Pitch's console already uses. Previously this page was a
// 1222-line editor for prize pools, position awards and cash/non-cash
// benefits, all written to localStorage only — none of that has a real
// backend counterpart anywhere in this codebase, so "editing" a competition
// here never touched anything real. A contest created here with a votable
// contestType and "public voting" turned on auto-publishes to
// connect_contests, which is what the mobile app reads — that's the real
// "connect it to mobile app" path, not a fabricated prize schema.

// Categories are admin-managed rows now (see /admin/competitions/categories and
// public.contest_categories). This list is only the fallback for when that
// request fails: it is what the server enforced before the table existed, so a
// blip degrades to the old behaviour instead of an empty dropdown that makes
// the form unsubmittable.
const FALLBACK_CATEGORIES: ContestCategory[] = [
  'music', 'acting', 'comedy_content', 'dance', 'film_production',
  'stem_innovation', 'sme_pitch', 'school_campus', 'open_mic',
  'general_reality_show', 'other',
];

const TYPES: ContestType[] = [
  'online_contest', 'physical_audition', 'hybrid_contest',
  'public_voting_contest', 'bootcamp_reality_show', 'housemate_reality_show',
  'one_beat_one_verse',
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

/*
  'lga' and 'village' are the local contest the operator asked for: an edition open
  only to one defined local government, optionally narrowed to one village or quarter
  inside it (Onitsha North's Isiokwe, Mgbelekeke, Obikporo …). Both are display +
  filter scopes — nobody is blocked from entering or voting because of where they
  live — so the values decide what the app shows and can group by, not who is
  allowed in.

  Labels are deliberately longer than the four existing single words. `state` alone
  would read as the same choice as the new `lga` on a screen where the difference
  (a whole state vs one government area) is the whole point.
*/
const REGION_SCOPES: { value: RegionScope; label: string }[] = [
  { value: 'state', label: 'state' },
  { value: 'regional', label: 'regional' },
  { value: 'national', label: 'national' },
  { value: 'international', label: 'international' },
  { value: 'lga', label: 'lga — one local government' },
  { value: 'village', label: 'village — one village or quarter' },
];

const LOCAL_SCOPES: RegionScope[] = ['lga', 'village'];

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
    rulesText: '', bannerImageUrl: '', logoUrl: '',
    startDate: '', endDate: '', prizePool: '',
    // Sent empty on create so the route sees "no locality" as a decision rather
    // than as the caller not managing the schedule's sibling fields.
    localityState: '', localityLga: '', localityVillage: '',
  };
}

// A stored instant is UTC, so the first ten characters ARE the day the admin
// chose (23:59:59.999Z stays on its own date). Only the display is reduced to a
// day — the form keeps the full value, so an unrelated edit cannot truncate a
// deadline somebody set precisely.
function dayPart(value: string | undefined): string {
  return value && value.length >= 10 ? value.slice(0, 10) : '';
}

/*
  Options for a locality select: the curated list, plus whatever the form already
  holds. An LGA or village the reference data does not know — renamed, typed while the
  list was unreachable, or simply never curated — has to stay selectable, or opening a
  contest to fix its title would blank its locality on save. Same rule the Type select
  uses for a contestType that is not in TYPES.
*/
function localityOptions(current: string, values: string[]): string[] {
  return [...new Set([current, ...values].map((v) => v.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
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
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const [recent, setRecent] = useState<AdminContest[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentPage, setRecentPage] = useState(1);

  // Active categories, loaded from the admin API. Falls back to the built-in
  // list on failure so the form stays usable — an empty dropdown here would
  // block creating any competition at all.
  const [categories, setCategories] = useState<ContestCategoryRow[]>([]);
  const [categoriesFellBack, setCategoriesFellBack] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = (await listContestCategories()).filter((r) => r.active);
        if (cancelled) return;
        if (rows.length > 0) { setCategories(rows); setCategoriesFellBack(false); }
        else { setCategories([]); setCategoriesFellBack(true); }
      } catch {
        if (!cancelled) { setCategories([]); setCategoriesFellBack(true); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /*
    The two fetched tiers of the locality cascade. Both default to 'free_text' before a
    fetch resolves, so the worst case an admin can hit is typing a name into a box —
    never an empty dropdown, and never a blocked save. That is the same degradation the
    server answers with for an LGA nobody has curated villages under, which is why the
    mode comes from the payload instead of from "did the array come back non-empty": an
    in-flight fetch and a genuinely empty list must not look identical.
  */
  const [lgas, setLgas] = useState<string[]>([]);
  const [lgaMode, setLgaMode] = useState<LocalityMode>('free_text');
  const [villages, setVillages] = useState<string[]>([]);
  const [villageMode, setVillageMode] = useState<LocalityMode>('free_text');

  const isLocal = LOCAL_SCOPES.includes(form.regionScope);
  const localityState = (form.localityState ?? '').trim();
  const localityLga = (form.localityLga ?? '').trim();

  useEffect(() => {
    if (!isLocal || !localityState) { setLgas([]); setLgaMode('free_text'); return; }
    let cancelled = false;
    (async () => {
      try {
        const list = await listLocalGovernments(localityState);
        if (cancelled) return;
        setLgas(list.lgas);
        setLgaMode(list.mode);
      } catch {
        // A reference-data outage is not a reason to lose an edit: fall back to the
        // text box and let the admin type the LGA they know.
        if (cancelled) return;
        setLgas([]);
        setLgaMode('free_text');
      }
    })();
    return () => { cancelled = true; };
  }, [isLocal, localityState]);

  useEffect(() => {
    // Only a village-scoped contest needs the third tier; an 'lga' contest stores no
    // village at all, so fetching one would offer a field the route rejects.
    if (form.regionScope !== 'village' || !localityState || !localityLga) {
      setVillages([]);
      setVillageMode('free_text');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listVillages(localityState, localityLga);
        if (cancelled) return;
        setVillages(list.villages);
        setVillageMode(list.mode);
      } catch {
        if (cancelled) return;
        setVillages([]);
        setVillageMode('free_text');
      }
    })();
    return () => { cancelled = true; };
  }, [form.regionScope, localityState, localityLga]);


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
  // Voting packages — the reusable templates offered, which of them are picked,
  // and (in edit mode) the packages already attached to this contest. Mirrors the
  // stages pattern: selections made before the contest exists are queued and
  // flushed on save, because vote_packages.contest_id is NOT NULL.
  const [pkgTemplates, setPkgTemplates] = useState<VotePackageTemplate[]>([]);
  const [pkgSelected, setPkgSelected] = useState<string[]>([]);
  const [pkgAttached, setPkgAttached] = useState<Awaited<ReturnType<typeof listVotePackages>>>([]);
  const [pkgLoading, setPkgLoading] = useState(false);
  const [pkgError, setPkgError] = useState<string | null>(null);
  const [pkgNotice, setPkgNotice] = useState<string | null>(null);
  const [pkgApplying, setPkgApplying] = useState(false);

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
        rulesText: c.rulesText ?? '',
        bannerImageUrl: c.bannerImageUrl ?? '',
        logoUrl: c.logoUrl ?? '',
        // Without these three keys the editor silently reported "no deadline" for
        // every contest, and saving then sent a payload that omitted them.
        startDate: c.startDate ?? '',
        endDate: c.endDate ?? '',
        prizePool: c.prizePool ?? '',
        // Same omission class as the schedule above: loadContest is a field
        // whitelist, and a key it does not copy is a key the save never resends.
        // A local contest would then read back with its locality on the server and
        // none in the form — and the next unrelated edit would clear it.
        localityState: c.localityState ?? '',
        localityLga: c.localityLga ?? '',
        localityVillage: c.localityVillage ?? '',
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

  const loadPackages = useCallback(async () => {
    setPkgLoading(true);
    setPkgError(null);
    try {
      const [tpl, attached] = await Promise.all([
        listVotePackageTemplates(true),
        contestId ? listVotePackages(contestId) : Promise.resolve([]),
      ]);
      setPkgTemplates(tpl);
      setPkgAttached(attached);
    } catch (e) {
      setPkgError(e instanceof Error ? e.message : 'Failed to load voting packages');
    } finally {
      setPkgLoading(false);
    }
  }, [contestId]);

  useEffect(() => { void loadPackages(); }, [loadPackages]);

  /** Attach the picked templates to a contest that already exists. */
  const attachSelectedPackages = useCallback(async (targetContestId: string) => {
    if (pkgSelected.length === 0) return;
    setPkgApplying(true);
    setPkgError(null);
    try {
      const res = await applyTemplatesToContest(targetContestId, pkgSelected);
      const parts = [`Attached ${res.applied} package${res.applied === 1 ? '' : 's'}.`];
      if (res.skipped > 0) parts.push(`${res.skipped} already on this contest.`);
      if (res.missing.length > 0) parts.push(`${res.missing.length} template(s) no longer exist.`);
      setPkgNotice(parts.join(' '));
      setPkgSelected([]);
      await loadPackages();
    } catch (e) {
      setPkgError(e instanceof Error ? e.message : 'Failed to attach voting packages');
    } finally {
      setPkgApplying(false);
    }
  }, [pkgSelected, loadPackages]);

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

      // Attach the voting packages picked while creating. Done after the contest
      // exists because vote_packages.contest_id is NOT NULL — there is nothing to
      // attach them to until now. A failure here must not read as "contest not
      // saved": the contest IS saved, so surface it on the packages panel.
      if (saved.id && pkgSelected.length > 0) {
        await attachSelectedPackages(saved.id);
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
  }, [form, isEdit, editSlug, router, loadRecent, draftStages, pkgSelected, attachSelectedPackages]);

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

  // contest_type is shared with the unified engine, so a stored row can hold a
  // value the registration catalog never offered ('general', 'multi_skill',
  // 'reality_tv_show', 'STEM'). TYPES has no option for it, and a <select> with a
  // value matching no option displays the FIRST option while the form keeps the
  // real one — the editor showed "online_contest", sent "multi_skill", and the
  // save was refused for a field nobody touched. Offer the stored value, labelled
  // for what it is, so what the admin sees is what gets written.
  const typeOptions: string[] = TYPES.includes(form.contestType)
    ? TYPES
    : [...TYPES, form.contestType];

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
          <label style={labelStyle}>Voting rules & policies</label>
          <textarea
            value={form.rulesText ?? ''}
            placeholder="e.g. eligibility requirements, disqualification grounds, prize conditions…"
            onChange={(e) => setForm((f) => ({ ...f, rulesText: e.target.value }))}
            rows={4}
            style={{ display: 'block', width: '100%', padding: '0.5rem', border: `1px solid ${colors.border}`, borderRadius: 6, resize: 'vertical', boxSizing: 'border-box', font: 'inherit', fontSize: 13 }}
          />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: colors.muted }}>
            Shown on the mobile contest details screen, above the platform&apos;s default voting rules. Leave blank to show only the defaults.
          </p>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Banner image</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={bannerUploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              // Clear the input immediately: without this, re-picking the SAME
              // file after a failure fires no change event and the retry looks
              // like a dead button.
              e.target.value = '';
              if (!file) return;
              setBannerUploading(true);
              setBannerError(null);
              try {
                const url = await uploadContestBanner(file);
                setForm((f) => ({ ...f, bannerImageUrl: url }));
              } catch (err) {
                setBannerError(err instanceof Error ? err.message : String(err));
              } finally {
                setBannerUploading(false);
              }
            }}
            style={{ display: 'block', fontSize: 13 }}
          />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: colors.muted }}>
            JPG, PNG or WebP, up to 8MB. Shown on the mobile contest list and detail screens;
            leave empty for the default placeholder tile. The image uploads immediately —
            you still need to save the contest for it to take effect.
          </p>
          {bannerUploading && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: colors.muted }}>Uploading…</p>
          )}
          {bannerError && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: colors.danger }}>{bannerError}</p>
          )}
          {form.bannerImageUrl ? (
            <div style={{ marginTop: 8 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={adminMediaUrl(form.bannerImageUrl)}
                alt="Contest banner preview"
                style={{ display: 'block', maxWidth: 320, height: 120, objectFit: 'cover', borderRadius: 8, border: `1px solid ${colors.border}` }}
              />
              <Button
                sm
                variant="danger"
                type="button"
                style={{ marginTop: 6 }}
                onClick={() => setForm((f) => ({ ...f, bannerImageUrl: '' }))}
              >
                Remove banner
              </Button>
            </div>
          ) : null}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Contest logo</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={logoUploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              // Cleared so re-picking the same file after a failure still fires.
              e.target.value = '';
              if (!file) return;
              setLogoUploading(true);
              setLogoError(null);
              try {
                const url = await uploadContestLogo(file);
                setForm((f) => ({ ...f, logoUrl: url }));
              } catch (err) {
                setLogoError(err instanceof Error ? err.message : String(err));
              } finally {
                setLogoUploading(false);
              }
            }}
            style={{ display: 'block', fontSize: 13 }}
          />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: colors.muted }}>
            JPG, PNG or WebP, up to 8MB. A square image works best. Shown beside the contest name
            on the mobile app and the website; leave empty to show no logo. The image uploads
            immediately — you still need to save the contest for it to take effect.
          </p>
          {logoUploading && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: colors.muted }}>Uploading…</p>
          )}
          {logoError && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: colors.danger }}>{logoError}</p>
          )}
          {form.logoUrl ? (
            <div style={{ marginTop: 8 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={adminMediaUrl(form.logoUrl)}
                alt="Contest logo preview"
                style={{ display: 'block', width: 96, height: 96, objectFit: 'contain', borderRadius: 8, border: `1px solid ${colors.border}` }}
              />
              <Button
                sm
                variant="danger"
                type="button"
                style={{ marginTop: 6 }}
                onClick={() => setForm((f) => ({ ...f, logoUrl: '' }))}
              >
                Remove logo
              </Button>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <label style={labelStyle}>Category</label>
              <Link
                href="/admin/competitions/categories"
                style={{ fontSize: 11, color: colors.primary, textDecoration: 'none' }}
              >
                Manage
              </Link>
            </div>
            <select style={selectStyle} value={form.contestCategory} onChange={(e) => setForm((f) => ({ ...f, contestCategory: e.target.value as ContestCategory }))}>
              {categories.length > 0
                ? categories.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)
                : FALLBACK_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {categoriesFellBack && (
              // Say so rather than silently showing the old list: the admin may
              // have just added a category and would otherwise wonder why it is
              // missing.
              <div style={{ fontSize: 11, color: colors.warning, marginTop: 4 }}>
                Showing the built-in list — managed categories could not be loaded.
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle}>Type</label>
            <select
              aria-label="Contest type"
              style={selectStyle}
              value={form.contestType}
              onChange={(e) => setForm((f) => ({ ...f, contestType: e.target.value as ContestType }))}
            >
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {TYPES.includes(t as ContestType) ? t : `${t} — stored on this contest, not a standard type`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Region scope</label>
            <select
              aria-label="Region scope"
              style={selectStyle}
              value={form.regionScope}
              onChange={(e) => {
                const next = e.target.value as RegionScope;
                // Leaving a local scope clears the triple rather than leaving it
                // stranded: /api/admin/contests wipes it for a non-local scope
                // anyway, so keeping the picks here would show the admin values
                // that were never stored.
                setForm((f) => LOCAL_SCOPES.includes(next)
                  ? { ...f, regionScope: next }
                  : { ...f, regionScope: next, localityState: '', localityLga: '', localityVillage: '' });
              }}
            >
              {REGION_SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {/*
          The locality of a local contest: state, then its local government, then the
          village. These are what /api/admin/contests refuses to store without — an
          'lga'/'village' scope with no place on it would publish a contest the apps
          cannot label — so the fields appear exactly when the scope needs them and the
          save carries them as bare strings (contests.locality_state/_lga/_village).

          The village tier is the reason this exists: quarters like Ogbendida or
          Owelle Ebo are curated content in public.villages, so publishing one must not
          need a redeploy, and an LGA with no curated list still takes a typed name.
        */}
        {isLocal && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Contest state of origin</label>
              <select
                aria-label="Contest state of origin"
                style={selectStyle}
                value={form.localityState ?? ''}
                // A new state invalidates both deeper picks, so they reset with it —
                // otherwise "Anambra / Lagos" is a place that does not exist.
                onChange={(e) => setForm((f) => ({
                  ...f,
                  localityState: e.target.value,
                  localityLga: '',
                  localityVillage: '',
                }))}
              >
                <option value="">Select a state</option>
                {localityOptions(form.localityState ?? '', NIGERIA_STATES).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Contest local government</label>
              {lgaMode === 'curated' ? (
                <select
                  aria-label="Contest local government"
                  style={selectStyle}
                  value={form.localityLga ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, localityLga: e.target.value, localityVillage: '' }))}
                >
                  <option value="">Select a local government</option>
                  {localityOptions(form.localityLga ?? '', lgas).map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              ) : (
                <Input
                  aria-label="Contest local government"
                  style={{ width: '100%' }}
                  type="text"
                  placeholder="e.g. Onitsha North"
                  maxLength={80}
                  value={form.localityLga ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, localityLga: e.target.value, localityVillage: '' }))}
                />
              )}
            </div>
            {form.regionScope === 'village' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <label style={labelStyle}>Contest village</label>
                  {/* Same affordance as Category's "Manage": the list here is curated
                      content in public.villages, so the fix for a missing quarter is to
                      publish it, not to file a migration. */}
                  <Link
                    href="/admin/competitions/villages"
                    style={{ fontSize: 11, color: colors.primary, textDecoration: 'none' }}
                  >
                    Manage
                  </Link>
                </div>
                {villageMode === 'curated' ? (
                  <select
                    aria-label="Contest village"
                    style={selectStyle}
                    value={form.localityVillage ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, localityVillage: e.target.value }))}
                  >
                    <option value="">Select a village</option>
                    {localityOptions(form.localityVillage ?? '', villages).map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    aria-label="Contest village"
                    style={{ width: '100%' }}
                    type="text"
                    placeholder="Type the village or quarter"
                    maxLength={80}
                    value={form.localityVillage ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, localityVillage: e.target.value }))}
                  />
                )}
              </div>
            )}
          </div>
        )}

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

        {/*
          The contest window and the prize. These map onto real columns
          (contests.start_date / end_date / prize_pool) that the console had no
          field for, which mattered because 20261223000000 mirrors the two dates
          into connect_contests.opens_at/closes_at — the window mobile's
          getVotingWindow enforces. With no field, every contest was open-ended:
          votable the moment it was published, and still votable the week after
          its deadline. Empty means unbounded, which is the old behaviour.
        */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 4 }}>
          <div>
            <label style={labelStyle}>Start date</label>
            <Input aria-label="Contest start date" style={{ width: '100%' }} type="date"
              value={dayPart(form.startDate)}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>End date</label>
            <Input aria-label="Contest end date" style={{ width: '100%' }} type="date"
              value={dayPart(form.endDate)}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Price to be won</label>
            <Input aria-label="Price to be won" style={{ width: '100%' }} type="text"
              placeholder="₦500,000 + a management deal"
              value={form.prizePool ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, prizePool: e.target.value }))} />
          </div>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 11, color: colors.muted }}>
          The end date is inclusive — voting stays open through that whole day. Outside this window the mobile app refuses votes; leave either side empty for no bound.
        </p>

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

      <Card title="Voting packages" style={{ marginBottom: 16 }}>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: colors.muted }}>
          {isEdit
            ? 'Packages voters can buy on this contest. Attaching a template copies it onto the contest — later edits to the template do not change a contest that is already selling votes.'
            : 'Pick the packages this contest sells. They are attached when you save, because a package has to belong to a contest that exists.'}
          {' '}
          <Link href="/admin/voting/packages" style={{ color: colors.primary }}>Manage templates</Link>
        </p>

        {pkgError && (
          <div style={{ marginBottom: 10, color: colors.danger, fontSize: 12 }}>{pkgError}</div>
        )}
        {pkgNotice && (
          <div style={{ marginBottom: 10, color: colors.success, fontSize: 12 }}>{pkgNotice}</div>
        )}

        {isEdit && pkgAttached.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: colors.muted, marginBottom: 6 }}>
              Currently on this contest ({pkgAttached.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {pkgAttached.map((p) => (
                <span key={p.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
                  <strong>{p.name}</strong>{' — '}
                  {p.votes.toLocaleString('en-NG')}
                  {p.bonusVotes > 0 ? ` +${p.bonusVotes.toLocaleString('en-NG')}` : ''} votes
                  {' · '}{formatNaira(p.amount)}
                  {!p.isActive && <span style={{ color: colors.muted }}> · inactive</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {pkgLoading ? (
          <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>Loading packages…</p>
        ) : pkgTemplates.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>
            No package templates yet.{' '}
            <Link href="/admin/voting/packages" style={{ color: colors.primary }}>Create one first</Link>
            {' '}— then it can be attached to this and any other contest.
          </p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {pkgTemplates.map((t) => {
                const already = pkgAttached.some((p) => p.templateId === t.id);
                const checked = pkgSelected.includes(t.id);
                return (
                  <label
                    key={t.id}
                    style={{
                      display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10,
                      border: `1px solid ${checked ? colors.primary : colors.border}`,
                      borderRadius: 8, fontSize: 13,
                      opacity: already ? 0.55 : 1,
                      cursor: already ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={already}
                      checked={checked}
                      onChange={(e) =>
                        setPkgSelected((prev) =>
                          e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id),
                        )
                      }
                    />
                    <span>
                      <strong>{t.name}</strong>
                      {already && <span style={{ color: colors.muted, fontSize: 11 }}> · already attached</span>}
                      <div style={{ color: colors.muted, fontSize: 12 }}>
                        {t.votes.toLocaleString('en-NG')}
                        {t.bonusVotes > 0 ? ` +${t.bonusVotes.toLocaleString('en-NG')} bonus` : ''} votes
                        {' · '}{formatNaira(t.amount)}
                      </div>
                    </span>
                  </label>
                );
              })}
            </div>

            {isEdit ? (
              <Button
                variant="primary"
                type="button"
                style={{ marginTop: 12 }}
                disabled={pkgApplying || pkgSelected.length === 0 || !contestId}
                onClick={() => void attachSelectedPackages(contestId)}
              >
                {pkgApplying ? 'Attaching…' : `Attach ${pkgSelected.length || ''} package${pkgSelected.length === 1 ? '' : 's'}`.trim()}
              </Button>
            ) : (
              pkgSelected.length > 0 && (
                <p style={{ margin: '12px 0 0', fontSize: 12, color: colors.muted }}>
                  {pkgSelected.length} package{pkgSelected.length === 1 ? '' : 's'} will be attached when you save this contest.
                </p>
              )
            )}
          </>
        )}
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
