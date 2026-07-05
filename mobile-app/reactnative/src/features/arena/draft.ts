// ── Arena — application draft (save-as-you-go) ───────────────────────────────
// Module singleton the C2 application form reads/writes as the user types, and a
// parallel autosave buffer for the C6 exam runner. Follows the kycverify `draft`
// pattern: transient client-only state kept out of React Query.
//
// Persisting here means a user who backgrounds the app (or gets KYC-stepped-up)
// returns to a pre-filled form instead of starting over (UX rule: save-as-you-go).

// ─── C2 application draft ────────────────────────────────────────────────────

export interface ArenaApplicationDraft {
  competitionId: string | null;
  homeState: string;
  fullName: string;
  phone: string;
  yearsDriving: string;
  vehicleType: string;
  /** License upload stub — deterministic sandbox base64 (real capture plugs in). */
  licenseB64: string | null;
  /** Free-form "why you should win" pitch. */
  motivation: string;
  agreedRules: boolean;
}

function emptyApplication(): ArenaApplicationDraft {
  return {
    competitionId: null,
    homeState: '',
    fullName: '',
    phone: '',
    yearsDriving: '',
    vehicleType: '',
    licenseB64: null,
    motivation: '',
    agreedRules: false,
  };
}

export const arenaApplicationDraft: { current: ArenaApplicationDraft } = {
  current: emptyApplication(),
};

/** Start / continue a draft for a competition (keeps existing values if same). */
export function ensureApplicationDraft(competitionId: string) {
  if (arenaApplicationDraft.current.competitionId !== competitionId) {
    arenaApplicationDraft.current = emptyApplication();
    arenaApplicationDraft.current.competitionId = competitionId;
  }
}

export function resetApplicationDraft() {
  arenaApplicationDraft.current = emptyApplication();
}

/** Shallow-merge a patch into the live draft (save-as-you-go). */
export function patchApplicationDraft(patch: Partial<ArenaApplicationDraft>) {
  arenaApplicationDraft.current = { ...arenaApplicationDraft.current, ...patch };
}

// ─── C6 exam autosave buffer (answers survive a paused/dropped session) ──────

export interface ExamAutosave {
  competitionId: string | null;
  /** questionId → optionId. Persisted per keystroke so a reconnect resumes. */
  answers: Record<string, string>;
  /** Index of the question the user is currently on. */
  currentIndex: number;
}

export const examAutosave: { current: ExamAutosave } = {
  current: { competitionId: null, answers: {}, currentIndex: 0 },
};

export function ensureExamAutosave(competitionId: string) {
  if (examAutosave.current.competitionId !== competitionId) {
    examAutosave.current = { competitionId, answers: {}, currentIndex: 0 };
  }
}

export function autosaveExamAnswer(questionId: string, optionId: string, index: number) {
  examAutosave.current.answers = { ...examAutosave.current.answers, [questionId]: optionId };
  examAutosave.current.currentIndex = index;
}

export function resetExamAutosave() {
  examAutosave.current = { competitionId: null, answers: {}, currentIndex: 0 };
}

/**
 * Deterministic base64 stub for a sandbox capture (license photo, exam proctor
 * frame). Real capture SDK output plugs in where this is called.
 * Mirrors kycverify/draft.stubCaptureBase64 exactly for consistency.
 */
export function stubCaptureBase64(kind: string): string {
  const payload = `PAYMAX-ARENA-SANDBOX-${kind.toUpperCase()}`;
  const g = globalThis as unknown as { btoa?: (s: string) => string };
  if (typeof g.btoa === 'function') return g.btoa(payload);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < payload.length; i += 3) {
    const b1 = payload.charCodeAt(i);
    const b2 = payload.charCodeAt(i + 1);
    const b3 = payload.charCodeAt(i + 2);
    out += chars[b1 >> 2];
    out += chars[((b1 & 3) << 4) | (b2 >> 4)];
    out += Number.isNaN(b2) ? '=' : chars[((b2 & 15) << 2) | (b3 >> 6)];
    out += Number.isNaN(b3) ? '=' : chars[b3 & 63];
  }
  return out;
}
