import { env } from '@/config/env';
import type {
  Competition,
  CompetitionConfig,
  Contestant,
  ContestantState,
  ScreeningItem,
  ScreeningDecision,
  MeritEntry,
  MeritVerifyResult,
  PotView,
  PotSplit,
  Credential,
  CredentialVerifyLog,
  CredentialType,
  ProctorAttestInput,
  JudgeScoreInput,
  SponsorSlot,
  AwardBinding,
  RailConfig,
  QuizQuestion,
  QuizStage,
  QuizListResult,
  QuizStats,
  QuizImportResult,
} from '@/types/arenaAdmin';

// Arena (Naija Driver contest) admin console — service layer.
// Backend: Go, admin routes mounted at /api/arena/admin (per-route RBAC:
// arena.admin.*, arena.reviewer.screen, arena.proctor.attest, arena.judge.score,
// arena.auditor.read). Public GETs live at /api/arena/...
// Auth: Bearer localStorage 'spotlight_admin_access_token' (matches kyc/transfers).
//
// Backend / feature flag may not be running — default to deterministic fixtures
// unless explicitly disabled, so every screen renders. Mirrors kycAdminService.
const USE_FIXTURES =
  (process.env.NEXT_PUBLIC_ARENA_ADMIN_USE_MOCK ?? 'true') !== 'false';

// env.apiBaseUrl looks like http://localhost:8080/api/v1 → /api/arena/admin
// (and /api/arena for the public GETs).
export function arenaAdminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/arena/admin');
}
export function arenaPublicBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/arena');
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (!token) return { 'Content-Type': 'application/json' };
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export function formatKobo(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 120));
}

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FIXTURE_COMPETITIONS: Competition[] = [
  { id: 'cmp_ndc26', slug: 'naija-driver-2026', name: 'Naija Driver Contest 2026', status: 'LIVE', config_version: 3, published_at: iso(20_000), created_at: iso(40_000), updated_at: iso(120) },
  { id: 'cmp_ndc25', slug: 'naija-driver-2025', name: 'Naija Driver Contest 2025 (pilot)', status: 'COMPLETED', config_version: 5, published_at: iso(400_000), created_at: iso(500_000), updated_at: iso(300_000) },
  { id: 'cmp_draft', slug: 'naija-driver-lagos-invitational', name: 'Lagos Invitational (draft)', status: 'DRAFT', config_version: null, published_at: null, created_at: iso(300), updated_at: iso(60) },
];

const FIXTURE_CONFIG: Record<string, CompetitionConfig> = {
  cmp_ndc26: {
    competition_id: 'cmp_ndc26',
    rails: [
      { kind: 'MERIT', enabled: true, params: { sources: 'THEORY_EXAM,PRACTICAL,FIRST_AID', telematics: false } },
      { kind: 'SUPPORT', enabled: true, params: { min_kobo: 50_000, variant: 'Back-a-Driver+State Pride', pot_share_pct: 100 } },
      { kind: 'PLAY_ALONG', enabled: true, params: { pass_threshold: 70, cashback_kobo: 20_000, predict_champion: true } },
      { kind: 'SPONSOR', enabled: true, params: { slots: 6, weight_engagement: true } },
    ],
    award_bindings: [
      { award: 'NAIJA_DRIVER_CROWN', rail: 'MERIT', locked: true },
      { award: 'PEOPLES_CHAMPION', rail: 'SUPPORT', locked: false },
      { award: 'STATE_PRIDE_WINNER', rail: 'SUPPORT', locked: false },
      { award: 'CERTIFIED_SAFE_DRIVER', rail: 'PLAY_ALONG', locked: false },
    ],
    screening_schema_version: 'screen-v2',
    rubric_version: 'rubric-2026.1',
    exam_schema_version: 'theory-v3',
    published: true,
    config_version: 3,
  },
  cmp_draft: {
    competition_id: 'cmp_draft',
    rails: [
      { kind: 'MERIT', enabled: true, params: { sources: 'THEORY_EXAM,PRACTICAL', telematics: false } },
      { kind: 'SUPPORT', enabled: false, params: {} },
      { kind: 'PLAY_ALONG', enabled: true, params: { pass_threshold: 65 } },
      { kind: 'SPONSOR', enabled: false, params: {} },
    ],
    award_bindings: [
      { award: 'NAIJA_DRIVER_CROWN', rail: 'MERIT', locked: true },
      { award: 'CERTIFIED_SAFE_DRIVER', rail: 'PLAY_ALONG', locked: false },
    ],
    screening_schema_version: 'screen-v1',
    rubric_version: 'rubric-draft',
    exam_schema_version: 'theory-v3',
    published: false,
    config_version: null,
  },
};

const FIXTURE_CONTESTANTS: Contestant[] = [
  { id: 'con_a1', user_id: 'usr_8f2a', full_name: 'Adaeze Okonkwo', state: 'THEORY_TAKEN', home_state: 'Anambra', theory_batch: 'B1', merit_total: 88.4, updated_at: iso(90) },
  { id: 'con_a2', user_id: 'usr_3c7d', full_name: 'Emeka Balogun', state: 'THEORY_TAKEN', home_state: 'Lagos', theory_batch: 'B1', merit_total: 61.2, updated_at: iso(88) },
  { id: 'con_a3', user_id: 'usr_5e1f', full_name: 'Bright Adeyemi', state: 'QUALIFIED', home_state: 'Oyo', theory_batch: 'B2', merit_total: 91.7, updated_at: iso(70) },
  { id: 'con_a4', user_id: 'usr_9a4b', full_name: 'Chidinma Eze', state: 'FINALIST', home_state: 'Enugu', theory_batch: 'B2', merit_total: 94.1, updated_at: iso(40) },
  { id: 'con_a5', user_id: 'usr_2b8c', full_name: 'Tunde Ogundipe', state: 'FINALIST', home_state: 'Ogun', theory_batch: 'B3', merit_total: 89.9, updated_at: iso(38) },
  { id: 'con_a6', user_id: 'usr_7d3e', full_name: 'Ngozi Umeh', state: 'SCREENED', home_state: 'Imo', theory_batch: null, merit_total: null, updated_at: iso(300) },
  { id: 'con_a7', user_id: 'usr_4f9a', full_name: 'Sadiq Bello', state: 'APPLIED', home_state: 'Kano', theory_batch: null, merit_total: null, updated_at: iso(600) },
  { id: 'con_a8', user_id: 'usr_1c2d', full_name: 'Grace Effiong', state: 'TRAINED', home_state: 'Akwa Ibom', theory_batch: null, merit_total: null, updated_at: iso(250) },
];

const FIXTURE_SCREENING: ScreeningItem[] = [
  { contestant_id: 'con_a7', user_id: 'usr_4f9a', full_name: 'Sadiq Bello', home_state: 'Kano', state: 'APPLIED', batch: null, flags: [], submitted_at: iso(600), rubric_version: 'screen-v2', document_refs: [{ id: 'doc_a7_lic', kind: 'drivers_license', label: "Driver's licence" }, { id: 'doc_a7_id', kind: 'nin', label: 'NIN slip' }] },
  { contestant_id: 'con_a9', user_id: 'usr_6b3f', full_name: 'Fatima Yusuf', home_state: 'Kaduna', state: 'APPLIED', batch: null, flags: ['licence_expiry_soon'], submitted_at: iso(420), rubric_version: 'screen-v2', document_refs: [{ id: 'doc_a9_lic', kind: 'drivers_license', label: "Driver's licence" }] },
  { contestant_id: 'con_a10', user_id: 'usr_0a1e', full_name: 'Peter Obi Jr.', home_state: 'Delta', state: 'APPLIED', batch: null, flags: ['doc_glare'], submitted_at: iso(120), rubric_version: 'screen-v2', document_refs: [{ id: 'doc_a10_lic', kind: 'drivers_license', label: "Driver's licence" }] },
];

// A hash-chained merit ledger for one contestant (con_a4) — the A6 trust surface.
const FIXTURE_MERIT: MeritEntry[] = [
  { id: 'mer_1', contestant_id: 'con_a4', competition_id: 'cmp_ndc26', stage: 'THEORY_B2', source_type: 'THEORY_EXAM', source_adapter_id: 'adapter.theory.smileproctor', rubric_version: 'theory-v3', raw_score: 47, normalized_score: 92.0, signature: 'sig:9f3ac21e…b40', entry_hash: 'h0:1a2b3c4d', prev_hash: null, signed_at: iso(2_000), recorded_at: iso(1_999) },
  { id: 'mer_2', contestant_id: 'con_a4', competition_id: 'cmp_ndc26', stage: 'FINALE_PRACTICAL', source_type: 'PRACTICAL', source_adapter_id: 'adapter.practical.judgepanel', rubric_version: 'rubric-2026.1', raw_score: 88, normalized_score: 95.5, signature: 'sig:c1d2e3f4…7aa', entry_hash: 'h1:5e6f7a8b', prev_hash: 'h0:1a2b3c4d', signed_at: iso(60), recorded_at: iso(59) },
  { id: 'mer_3', contestant_id: 'con_a4', competition_id: 'cmp_ndc26', stage: 'FINALE_FIRSTAID', source_type: 'FIRST_AID', source_adapter_id: 'adapter.firstaid.crashsite', rubric_version: 'rubric-2026.1', raw_score: 40, normalized_score: 94.8, signature: 'sig:0099aabb…cd1', entry_hash: 'h2:9c0d1e2f', prev_hash: 'h1:5e6f7a8b', signed_at: iso(45), recorded_at: iso(44) },
  { id: 'mer_4', contestant_id: 'con_a3', competition_id: 'cmp_ndc26', stage: 'THEORY_B2', source_type: 'THEORY_EXAM', source_adapter_id: 'adapter.theory.smileproctor', rubric_version: 'theory-v3', raw_score: 46, normalized_score: 91.7, signature: 'sig:44ee55ff…21c', entry_hash: 'h0:aa11bb22', prev_hash: null, signed_at: iso(1_800), recorded_at: iso(1_799) },
  { id: 'mer_5', contestant_id: 'con_a1', competition_id: 'cmp_ndc26', stage: 'THEORY_B1', source_type: 'THEORY_EXAM', source_adapter_id: 'adapter.theory.smileproctor', rubric_version: 'theory-v3', raw_score: 44, normalized_score: 88.4, signature: 'sig:778899aa…f04', entry_hash: 'h0:cc33dd44', prev_hash: null, signed_at: iso(2_100), recorded_at: iso(2_099) },
];

const FIXTURE_POT: Record<string, PotView> = {
  cmp_ndc26: {
    competition_id: 'cmp_ndc26',
    total_kobo: 42_500_000,
    split_formula: 'crown 50% · peoples_champion 20% · state_pride 10% · scholarships 20% (formula-2026.1)',
    disbursement_status: 'PENDING_APPROVAL',
    approvals_required: 2,
    approvals: [{ approver_id: 'usr_admin1', approver_email: 'ops@spotlight.ng', approved_at: iso(30) }],
    contributions: [
      { id: 'pc_1', source: 'Back-a-Driver', contestant_id: 'con_a4', amount_kobo: 18_000_000, ledger_entry_id: 'led_p1', created_at: iso(1_200) },
      { id: 'pc_2', source: 'State Pride (Enugu)', contestant_id: 'con_a4', amount_kobo: 9_500_000, ledger_entry_id: 'led_p2', created_at: iso(900) },
      { id: 'pc_3', source: 'Back-a-Driver', contestant_id: 'con_a5', amount_kobo: 11_000_000, ledger_entry_id: 'led_p3', created_at: iso(600) },
      { id: 'pc_4', source: 'State Pride (Ogun)', contestant_id: 'con_a5', amount_kobo: 4_000_000, ledger_entry_id: 'led_p4', created_at: iso(200) },
    ],
    splits: [
      { label: 'NAIJA_DRIVER_CROWN prize', beneficiary: 'con_a4', amount_kobo: 21_250_000 },
      { label: "PEOPLES_CHAMPION", beneficiary: 'con_a5', amount_kobo: 8_500_000 },
      { label: 'STATE_PRIDE_WINNER', beneficiary: 'Enugu pool', amount_kobo: 4_250_000 },
      { label: 'Scholarships', beneficiary: 'scholarship pool', amount_kobo: 8_500_000 },
    ],
  },
};

const FIXTURE_CREDENTIALS: Credential[] = [
  { id: 'cred_1', user_id: 'usr_2b8c', contestant_id: 'con_a5', type: 'CERTIFIED_SAFE_DRIVER', status: 'ISSUED', verifiable_hash: 'vh:8a7b6c5d…e21', issued_at: iso(500) },
  { id: 'cred_2', user_id: 'usr_5e1f', contestant_id: 'con_a3', type: 'CERTIFIED_SAFE_DRIVER', status: 'ISSUED', verifiable_hash: 'vh:1f2e3d4c…9b0', issued_at: iso(300) },
  { id: 'cred_3', user_id: 'usr_1c2d', contestant_id: null, type: 'CERTIFIED_SAFE_DRIVER', status: 'REVOKED', verifiable_hash: 'vh:aa00bb11…7cc', issued_at: iso(2_000), revoked_at: iso(120), revoke_reason: 'Play-Along pass invalidated — quiz integrity flag' },
];

const FIXTURE_VERIFY_LOGS: CredentialVerifyLog[] = [
  { id: 'cvl_1', credential_id: 'cred_1', verifier: 'transport-onboarding', result: 'valid', verified_at: iso(80) },
  { id: 'cvl_2', credential_id: 'cred_1', verifier: 'insurance-pricing', result: 'valid', verified_at: iso(40) },
  { id: 'cvl_3', credential_id: 'cred_3', verifier: 'public', result: 'revoked', verified_at: iso(15) },
];

const FIXTURE_SPONSORS: SponsorSlot[] = [
  { id: 'spn_1', sponsor: 'MyCover.ai', placement: 'finale_overlay', starts_at: iso(1_440), ends_at: iso(-1_440), impressions: 812_400, status: 'live' },
  { id: 'spn_2', sponsor: 'TotalEnergies', placement: 'home', starts_at: iso(2_880), ends_at: iso(-2_880), impressions: 1_204_900, status: 'live' },
  { id: 'spn_3', sponsor: 'FRSC', placement: 'driver_profile', starts_at: iso(-60), ends_at: iso(-4_320), impressions: null, status: 'scheduled' },
];

// ─── Public GETs (context) ───────────────────────────────────────────────────

export async function listCompetitions(): Promise<Competition[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_COMPETITIONS]);
  const res = await fetch(`${arenaPublicBase()}/competitions`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Arena competitions list failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? data.competitions ?? [];
}

export async function getCompetition(id: string): Promise<Competition> {
  if (USE_FIXTURES) {
    const found = FIXTURE_COMPETITIONS.find((c) => c.id === id);
    if (!found) throw new Error(`Competition ${id} not found`);
    return delay(found);
  }
  const res = await fetch(`${arenaPublicBase()}/competitions/${encodeURIComponent(id)}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Arena competition fetch failed: ${res.status}`);
  return res.json();
}

// ─── A1 — Competition config ─────────────────────────────────────────────────

export async function createCompetition(input: { slug: string; name: string }): Promise<Competition> {
  if (USE_FIXTURES) {
    return delay({ id: `cmp_${Math.random().toString(36).slice(2, 8)}`, slug: input.slug, name: input.name, status: 'DRAFT', config_version: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }
  const res = await fetch(`${arenaAdminBase()}/competitions`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(input) });
  if (!res.ok) throw new Error(`Create competition failed: ${res.status}`);
  return res.json();
}

export async function getCompetitionConfig(id: string): Promise<CompetitionConfig> {
  if (USE_FIXTURES) {
    return delay(
      FIXTURE_CONFIG[id] ?? {
        competition_id: id,
        rails: [
          { kind: 'MERIT', enabled: true, params: {} },
          { kind: 'SUPPORT', enabled: false, params: {} },
          { kind: 'PLAY_ALONG', enabled: false, params: {} },
          { kind: 'SPONSOR', enabled: false, params: {} },
        ],
        award_bindings: [{ award: 'NAIJA_DRIVER_CROWN', rail: 'MERIT', locked: true }],
        screening_schema_version: 'screen-v1',
        rubric_version: 'rubric-v1',
        exam_schema_version: 'theory-v1',
        published: false,
        config_version: null,
      },
    );
  }
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(id)}/config`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
  return res.json();
}

// Publish creates an immutable config_version (guarded, versioned, audited).
// NDC-1: the crown←Merit binding is enforced locked server-side too.
export async function publishConfig(
  id: string,
  config: { rails: RailConfig[]; award_bindings: AwardBinding[]; screening_schema_version: string; rubric_version: string; exam_schema_version: string },
): Promise<CompetitionConfig> {
  if (USE_FIXTURES) {
    return delay({ competition_id: id, ...config, published: true, config_version: (FIXTURE_CONFIG[id]?.config_version ?? 0) + 1 });
  }
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(id)}/config/publish`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(config) });
  if (!res.ok) throw new Error(`Publish config failed: ${res.status}`);
  return res.json();
}

// ─── A2 — Screening review queue ─────────────────────────────────────────────

export async function listScreening(competitionId: string): Promise<ScreeningItem[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_SCREENING]);
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/screening`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Screening queue failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? data.items ?? [];
}

// Guarded transition: APPLIED → SCREENED | NEEDS_MORE_INFO | REJECTED. Reason required.
export async function decideScreening(
  competitionId: string,
  contestantId: string,
  decision: ScreeningDecision,
  reason: string,
): Promise<void> {
  if (USE_FIXTURES) { await delay(null); return; }
  const res = await fetch(
    `${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/screening/${encodeURIComponent(contestantId)}/decide`,
    { method: 'POST', headers: authHeaders(), body: JSON.stringify({ decision, reason }) },
  );
  if (!res.ok) throw new Error(`Screening decision failed: ${res.status}`);
}

// ─── A5 — Lifecycle transitions ──────────────────────────────────────────────

export async function listContestants(competitionId: string): Promise<Contestant[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_CONTESTANTS]);
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/contestants`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Contestants list failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? data.contestants ?? [];
}

// Guarded transition. Only legal `to` states are offered by the UI; the backend
// rejects anything not in the LOCKED state machine (NDC-5) and side-effects are
// atomic with the transition (e.g. →CROWNED issues credential + finalizes award
// + triggers disbursement in one txn).
export async function runTransition(
  competitionId: string,
  contestantId: string,
  to: ContestantState,
  reason: string,
): Promise<void> {
  if (USE_FIXTURES) { await delay(null); return; }
  const res = await fetch(
    `${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/transitions/${encodeURIComponent(contestantId)}`,
    { method: 'POST', headers: authHeaders(), body: JSON.stringify({ to, reason }) },
  );
  if (!res.ok) throw new Error(`Transition failed: ${res.status}`);
}

// ─── A6 — Merit ledger + integrity ───────────────────────────────────────────

export async function listMerit(competitionId: string): Promise<MeritEntry[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_MERIT]);
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/merit`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Merit ledger fetch failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? data.entries ?? [];
}

// Verify signatures + hash chain for a set of entries (per contestant). Client
// runs a structural check on fixtures; against a live backend the same endpoint
// returns the authoritative proof (public integrity proof, NDC-6).
export async function verifyMerit(competitionId: string, contestantId?: string): Promise<MeritVerifyResult> {
  if (USE_FIXTURES) {
    const rows = FIXTURE_MERIT
      .filter((e) => !contestantId || e.contestant_id === contestantId)
      .sort((a, b) => new Date(a.signed_at).getTime() - new Date(b.signed_at).getTime());
    let chainValid = true;
    let brokenAt: string | null = null;
    let prev: string | null = null;
    for (const e of rows) {
      const sigValid = typeof e.signature === 'string' && e.signature.startsWith('sig:');
      const linkValid = (e.prev_hash ?? null) === prev;
      if (!sigValid || !linkValid) { chainValid = false; brokenAt = e.id; break; }
      prev = e.entry_hash;
    }
    return delay({
      contestant_id: contestantId ?? null,
      stage: null,
      entries_checked: rows.length,
      signatures_valid: chainValid,
      chain_valid: chainValid,
      broken_at: brokenAt,
      verified_at: new Date().toISOString(),
    });
  }
  const qs = contestantId ? `?contestant_id=${encodeURIComponent(contestantId)}` : '';
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/merit/verify${qs}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Merit verify failed: ${res.status}`);
  return res.json();
}

// ─── A7 — Pot & disbursement ─────────────────────────────────────────────────

export async function getPot(competitionId: string): Promise<PotView> {
  if (USE_FIXTURES) {
    return delay(
      FIXTURE_POT[competitionId] ?? {
        competition_id: competitionId,
        total_kobo: 0,
        split_formula: '—',
        disbursement_status: 'NONE',
        approvals_required: 2,
        approvals: [],
        contributions: [],
        splits: [],
      },
    );
  }
  const res = await fetch(`${arenaPublicBase()}/competitions/${encodeURIComponent(competitionId)}/pot`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Pot fetch failed: ${res.status}`);
  return res.json();
}

export async function finalizeAwards(competitionId: string): Promise<void> {
  if (USE_FIXTURES) { await delay(null); return; }
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/awards/finalize`, { method: 'POST', headers: authHeaders(), body: '{}' });
  if (!res.ok) throw new Error(`Awards finalize failed: ${res.status}`);
}

// Multi-approve disbursement. The backend requires N distinct approvers before
// executing; amounts reconcile against the derived pot; every movement ledgered
// + audited (NDC-4). This one call registers the caller's approval + executes if
// the threshold is met server-side.
export async function disbursePot(competitionId: string, splits: PotSplit[]): Promise<void> {
  if (USE_FIXTURES) { await delay(null); return; }
  const res = await fetch(
    `${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/pot/disburse`,
    { method: 'POST', headers: authHeaders(), body: JSON.stringify({ splits }) },
  );
  if (!res.ok) throw new Error(`Pot disburse failed: ${res.status}`);
}

// ─── A9 — Credentials ────────────────────────────────────────────────────────

export async function listCredentials(competitionId: string): Promise<Credential[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_CREDENTIALS]);
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/credentials`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Credentials list failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? data.credentials ?? [];
}

export async function listCredentialVerifyLogs(competitionId: string): Promise<CredentialVerifyLog[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_VERIFY_LOGS]);
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/credentials/verify-logs`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Credential verify logs failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? data.logs ?? [];
}

// Issue only from Merit-derived state (NDC-7 — independently revocable).
export async function issueCredential(competitionId: string, userId: string, type: CredentialType): Promise<Credential> {
  if (USE_FIXTURES) {
    return delay({ id: `cred_${Math.random().toString(36).slice(2, 8)}`, user_id: userId, type, status: 'ISSUED', verifiable_hash: `vh:${Math.random().toString(16).slice(2, 10)}…new`, issued_at: new Date().toISOString() });
  }
  const res = await fetch(
    `${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/credentials/issue`,
    { method: 'POST', headers: authHeaders(), body: JSON.stringify({ user_id: userId, type }) },
  );
  if (!res.ok) throw new Error(`Credential issue failed: ${res.status}`);
  return res.json();
}

export async function revokeCredential(competitionId: string, credentialId: string, reason: string): Promise<void> {
  if (USE_FIXTURES) { await delay(null); return; }
  const res = await fetch(
    `${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/credentials/${encodeURIComponent(credentialId)}/revoke`,
    { method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason }) },
  );
  if (!res.ok) throw new Error(`Credential revoke failed: ${res.status}`);
}

// ─── A3 — Proctor console (scaffold, service wired) ──────────────────────────

export async function proctorAttest(competitionId: string, input: ProctorAttestInput): Promise<void> {
  if (USE_FIXTURES) { await delay(null); return; }
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/proctor/attest`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(input) });
  if (!res.ok) throw new Error(`Proctor attest failed: ${res.status}`);
}

// ─── A4 — Judge console (scaffold, service wired) ────────────────────────────

export async function judgeScore(competitionId: string, input: JudgeScoreInput): Promise<void> {
  if (USE_FIXTURES) { await delay(null); return; }
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/judge/score`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(input) });
  if (!res.ok) throw new Error(`Judge score failed: ${res.status}`);
}

// ─── A8 — Sponsor / Featured Placement (scaffold) ────────────────────────────

export async function listSponsorSlots(competitionId: string): Promise<SponsorSlot[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_SPONSORS]);
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/sponsors`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Sponsor slots fetch failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? data.slots ?? [];
}

// ─── Quiz bank (Naija Driver quiz management) ────────────────────────────────
// The 90-question bank (3 stages × 30, 120s each). This is the FULL ADMIN view:
// rows carry answers + explanation (teaching/QA), unlike the contestant view.
// Default bank imported is the Naija Driver seed bank (naija_driver_quiz_seed.json).
// NOTE: bankKey and rubricVersion are DISTINCT — the backend matches template rows on
// bank_key; 'naija_driver_v1.0.0' is the rubric VERSION, not the key.
export const DEFAULT_QUIZ_BANK_KEY = 'naija_driver_safe_driving_assessment';
export const DEFAULT_QUIZ_RUBRIC_VERSION = 'naija_driver_v1.0.0';

// Representative fixture — ~6 questions across the 3 stages, mirroring the seed
// shape (stage pass marks 70/75/80, 120s each). Only mounted on cmp_ndc26 so the
// empty state (no bank imported) is demonstrable on other competitions.
const FIXTURE_QUIZ: QuizQuestion[] = [
  { id: 'q_s1_01', externalId: 'ND-S1-Q01', stage: 1, category: 'road_signs', prompt: "In Nigeria, what shape are most warning signs (e.g. 'bend ahead', 'narrow bridge')?", options: ['Rectangular', 'Triangular', 'Circular', 'Octagonal'], correctIndex: 1, correctAnswer: 'Triangular', explanation: 'Triangular signs warn of hazards ahead. Circular signs give orders; rectangular signs give information.', timeLimitSeconds: 120, passMarkPercent: 70 },
  { id: 'q_s1_05', externalId: 'ND-S1-Q05', stage: 1, category: 'traffic_rules', prompt: "Which agency is primarily responsible for road traffic safety and driver's licensing in Nigeria?", options: ['NAFDAC', 'FRSC (Federal Road Safety Corps)', 'NDLEA', 'EFCC'], correctIndex: 1, correctAnswer: 'FRSC (Federal Road Safety Corps)', explanation: "The FRSC administers road safety, driver's licences and highway regulations in Nigeria.", timeLimitSeconds: 120, passMarkPercent: 70 },
  { id: 'q_s2_01', externalId: 'ND-S2-Q01', stage: 2, category: 'safe_practice', prompt: "The 'two-second rule' is used to:", options: ['Time traffic lights', 'Keep a safe following distance from the vehicle ahead', 'Calculate fuel consumption', 'Measure engine speed'], correctIndex: 1, correctAnswer: 'Keep a safe following distance from the vehicle ahead', explanation: 'Pick a fixed point; if you pass it less than two seconds after the car ahead, you are too close.', timeLimitSeconds: 120, passMarkPercent: 75 },
  { id: 'q_s2_02', externalId: 'ND-S2-Q02', stage: 2, category: 'night_weather', prompt: 'On wet roads or in rain, your following distance should be:', options: ['The same as in dry weather', 'Ignored because of the wipers', 'Reduced to stay in convoy', 'At least doubled — about four seconds'], correctIndex: 3, correctAnswer: 'At least doubled — about four seconds', explanation: 'Wet roads can double stopping distances, so double your gap to at least four seconds.', timeLimitSeconds: 120, passMarkPercent: 75 },
  { id: 'q_s3_01', externalId: 'ND-S3-Q01', stage: 3, category: 'emergency_response', prompt: 'If your brakes fail while driving, you should first:', options: ['Accelerate to escape the traffic around you', 'Switch off the engine and remove the key', 'Jump out of the moving vehicle', 'Pump the brake pedal, shift to a lower gear and apply the handbrake gradually'], correctIndex: 3, correctAnswer: 'Pump the brake pedal, shift to a lower gear and apply the handbrake gradually', explanation: 'Pumping may restore pressure; engine braking and gradual handbrake use scrub off speed under control.', timeLimitSeconds: 120, passMarkPercent: 80 },
  { id: 'q_s3_03', externalId: 'ND-S3-Q03', stage: 3, category: 'hazard_perception', prompt: 'A child chasing a ball toward the road ahead is best treated as:', options: ['A distraction to ignore', 'A developing hazard — slow down and cover the brake', 'A reason to sound the horn and maintain speed', 'Someone else’s responsibility'], correctIndex: 1, correctAnswer: 'A developing hazard — slow down and cover the brake', explanation: 'Anticipate that the child may enter the road; reduce speed early and be ready to stop.', timeLimitSeconds: 120, passMarkPercent: 80 },
];

function quizCounts(rows: QuizQuestion[]): QuizListResult['counts'] {
  const perStage = ([1, 2, 3] as QuizStage[]).map((stage) => ({ stage, count: rows.filter((q) => q.stage === stage).length }));
  const catMap = new Map<string, number>();
  for (const q of rows) catMap.set(q.category, (catMap.get(q.category) ?? 0) + 1);
  return { total: rows.length, perStage, perCategory: [...catMap.entries()].map(([category, count]) => ({ category, count })) };
}

// Which competitions have an imported bank in fixture mode (drives empty state).
const FIXTURE_QUIZ_IMPORTED = new Set<string>(['cmp_ndc26']);

export async function listQuizQuestions(
  competitionId: string,
  filters?: { stage?: QuizStage; category?: string },
): Promise<QuizListResult> {
  if (USE_FIXTURES) {
    const has = FIXTURE_QUIZ_IMPORTED.has(competitionId);
    let rows = has ? [...FIXTURE_QUIZ] : [];
    if (filters?.stage) rows = rows.filter((q) => q.stage === filters.stage);
    if (filters?.category) rows = rows.filter((q) => q.category === filters.category);
    return delay({ questions: rows, counts: quizCounts(has ? FIXTURE_QUIZ : []) });
  }
  const params = new URLSearchParams();
  if (filters?.stage) params.set('stage', String(filters.stage));
  if (filters?.category) params.set('category', filters.category);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/questions${qs}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Quiz questions fetch failed: ${res.status}`);
  const data = await res.json();
  return { questions: data.questions ?? [], counts: data.counts ?? quizCounts(data.questions ?? []) };
}

export async function quizStats(competitionId: string): Promise<QuizStats> {
  if (USE_FIXTURES) {
    const has = FIXTURE_QUIZ_IMPORTED.has(competitionId);
    const source = has ? FIXTURE_QUIZ : [];
    const perStage = ([1, 2, 3] as QuizStage[]).map((stage) => {
      const questionCount = source.filter((q) => q.stage === stage).length;
      // Deterministic-ish sample telemetry so the badges render meaningfully.
      const attemptCount = has ? [1420, 980, 540][stage - 1] : 0;
      const passRate = has ? [0.82, 0.71, 0.58][stage - 1] : 0;
      return { stage, questionCount, attemptCount, passRate };
    });
    return delay({ perStage, totalQuestions: source.length });
  }
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/questions/stats`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Quiz stats fetch failed: ${res.status}`);
  return res.json();
}

export async function importQuizBank(
  competitionId: string,
  opts?: { bankKey?: string; rubricVersion?: string },
): Promise<QuizImportResult> {
  if (USE_FIXTURES) {
    FIXTURE_QUIZ_IMPORTED.add(competitionId);
    return delay({ imported: FIXTURE_QUIZ.length, stages: ([1, 2, 3] as QuizStage[]).map((stage) => ({ stage, count: FIXTURE_QUIZ.filter((q) => q.stage === stage).length })) });
  }
  const body = { bankKey: opts?.bankKey ?? DEFAULT_QUIZ_BANK_KEY, rubricVersion: opts?.rubricVersion ?? DEFAULT_QUIZ_RUBRIC_VERSION };
  const res = await fetch(`${arenaAdminBase()}/competitions/${encodeURIComponent(competitionId)}/questions/import`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Quiz bank import failed: ${res.status}`);
  return res.json();
}

