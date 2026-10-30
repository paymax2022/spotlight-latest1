// FX verification runs the same real checks as the KYC step-up wizard — the Go
// /api/finance/kyc gateway — but keeps its own session so the two flows never
// overwrite each other's target tier or passed-check list. Created once per FX
// attempt (kyc/index → Start verification) and reused on retries/back-nav; a
// reload starts a fresh session, which the service treats as a new attempt.
export const fxKycSession: { sessionId: string | null; consentRecorded: boolean } = {
  sessionId: null,
  consentRecorded: false,
};

export function resetFxKycSession() {
  fxKycSession.sessionId = null;
  fxKycSession.consentRecorded = false;
}
