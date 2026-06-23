import { Stack } from 'expo-router';

export default function DoctorLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="signup/index" />
      <Stack.Screen name="signup/pending" />

      {/* ── Section A · Splash · Onboarding · Authentication (entries 1–20) ── */}
      <Stack.Screen name="onboarding/index" />
      <Stack.Screen name="onboarding/intro" />
      <Stack.Screen name="onboarding/upgrade-merchant" />
      <Stack.Screen name="onboarding/provider-type" />
      <Stack.Screen name="onboarding/builder" />
      <Stack.Screen name="onboarding/consents" />
      <Stack.Screen name="onboarding/consent/[kind]" />
      <Stack.Screen name="onboarding/permissions/index" />
      <Stack.Screen name="onboarding/permissions/[kind]" />
      <Stack.Screen name="onboarding/submit" />
      <Stack.Screen name="availability" />
      <Stack.Screen name="patient/[id]" />
      <Stack.Screen name="consult/[id]/chat" />
      <Stack.Screen name="consult/[id]/call" />
      <Stack.Screen name="consult/[id]/notes" />
      <Stack.Screen name="consult/[id]/pre-call" />
      <Stack.Screen name="consult/[id]/prescription" />
      <Stack.Screen name="consult/[id]/lab-order" />
      <Stack.Screen name="consult/[id]/hmo" />
      <Stack.Screen name="prescriptions/index" />
      <Stack.Screen name="lab/[orderId]" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="support" />
      <Stack.Screen name="settings" />

      {/* ── Phase 2 ── */}
      <Stack.Screen name="pharmacy/index" />
      <Stack.Screen name="pharmacy/[id]" />
      <Stack.Screen name="pharmacy/[id]/delivery" />
      <Stack.Screen name="refills/index" />
      <Stack.Screen name="referrals/index" />
      <Stack.Screen name="referrals/new" />
      <Stack.Screen name="referrals/[id]" />
      <Stack.Screen name="records/[patientId]" />
      <Stack.Screen name="claims/index" />
      <Stack.Screen name="claims/[id]" />
      <Stack.Screen name="follow-ups/index" />
      <Stack.Screen name="follow-ups/new" />
      <Stack.Screen name="reviews/index" />
      <Stack.Screen name="earnings/report" />
      <Stack.Screen name="compliance/index" />

      {/* ── Section B: Profile builder wizard (screens 1–23) ── */}
      <Stack.Screen name="profile/setup/index" />
      <Stack.Screen name="profile/setup/personal" />
      <Stack.Screen name="profile/setup/photo" />
      <Stack.Screen name="profile/setup/bio" />
      <Stack.Screen name="profile/setup/specialty" />
      <Stack.Screen name="profile/setup/sub-specialty" />
      <Stack.Screen name="profile/setup/experience" />
      <Stack.Screen name="profile/setup/languages" />
      <Stack.Screen name="profile/setup/licence-number" />
      <Stack.Screen name="profile/setup/licence-upload" />
      <Stack.Screen name="profile/setup/government-id" />
      <Stack.Screen name="profile/setup/certificates" />
      <Stack.Screen name="profile/setup/association" />
      <Stack.Screen name="profile/setup/affiliations" />
      <Stack.Screen name="profile/setup/education" />
      <Stack.Screen name="profile/setup/work-experience" />
      <Stack.Screen name="profile/setup/pricing" />
      <Stack.Screen name="profile/setup/free-follow-up" />
      <Stack.Screen name="profile/setup/bank-account" />
      <Stack.Screen name="profile/setup/tax-info" />
      <Stack.Screen name="profile/setup/preview" />
      <Stack.Screen name="profile/setup/submit" />

      {/* ── Section B: Verification lifecycle (screens 24, 26–28) ── */}
      <Stack.Screen name="profile/verification/submitted" />
      <Stack.Screen name="profile/verification/approved" />
      <Stack.Screen name="profile/verification/failed" />
      <Stack.Screen name="profile/verification/resubmit" />

      {/* ── Phase 3: Vet mode (screens 1–5) ── */}
      <Stack.Screen name="vet/index" />
      <Stack.Screen name="vet/pet/[id]/index" />
      <Stack.Screen name="vet/pet/[id]/prescription" />
      <Stack.Screen name="vet/pet/[id]/lab-order" />
      <Stack.Screen name="vet/lab-result/[orderId]" />
      <Stack.Screen name="vet/pet-store" />

      {/* ── Phase 3: AI assist (screens 6–8) ── */}
      <Stack.Screen name="ai/note-summary" />
      <Stack.Screen name="ai/rx-safety" />
      <Stack.Screen name="ai/lab-explanation" />

      {/* ── Phase 3: Practice management (screens 9–10) ── */}
      <Stack.Screen name="analytics/index" />
      <Stack.Screen name="clinics/index" />

      {/* ── Section B: Licence lifecycle & published (screens 29–31) ── */}
      <Stack.Screen name="profile/licence/expiry" />
      <Stack.Screen name="profile/licence/renew" />
      <Stack.Screen name="profile/published" />

      {/* ── Batch 1 · Section C — Vet profile builder + verification ── */}
      <Stack.Screen name="vet/profile/setup/index" />
      <Stack.Screen name="vet/profile/setup/personal" />
      <Stack.Screen name="vet/profile/setup/specialty" />
      <Stack.Screen name="vet/profile/setup/species" />
      <Stack.Screen name="vet/profile/setup/licence-number" />
      <Stack.Screen name="vet/profile/setup/licence-upload" />
      <Stack.Screen name="vet/profile/setup/certificates" />
      <Stack.Screen name="vet/profile/setup/affiliations" />
      <Stack.Screen name="vet/profile/setup/experience" />
      <Stack.Screen name="vet/profile/setup/pricing" />
      <Stack.Screen name="vet/profile/setup/preview" />
      <Stack.Screen name="vet/profile/verification" />
      <Stack.Screen name="vet/profile/licence/renew" />

      {/* ── Batch 1 · Section D — Dashboard detail ── */}
      <Stack.Screen name="announcement" />

      {/* ── Batch 1 · Section E — Schedule management ── */}
      <Stack.Screen name="schedule/settings" />
      <Stack.Screen name="schedule/blocked-dates" />
      <Stack.Screen name="schedule/vacation" />
      <Stack.Screen name="schedule/reminders" />
      <Stack.Screen name="schedule/recurring" />
      <Stack.Screen name="schedule/timezone" />

      {/* ── Batch 1 · Section F — Appointment & consultation queue ── */}
      <Stack.Screen name="appointments/[id]" />
      <Stack.Screen name="appointments/requests/index" />
      <Stack.Screen name="appointments/requests/[id]" />
      <Stack.Screen name="queue/index" />
      <Stack.Screen name="queue/waiting-room" />

      {/* ── Batch 3 · Sections K · L · M · N ── */}
      <Stack.Screen name="prescriptions/[id]/issued" />
      <Stack.Screen name="pharmacy/directory" />
      <Stack.Screen name="pharmacy/[id]/chat" />
      <Stack.Screen name="lab/inbox" />
      <Stack.Screen name="lab/order/[orderId]" />

      {/* ── Batch 4 · Sections O · P · Q · R ── */}
      <Stack.Screen name="hmo/plan-coverage" />
      <Stack.Screen name="hmo/pre-auth" />
      <Stack.Screen name="hmo/pre-auth/[id]" />
      <Stack.Screen name="hmo/support" />
      <Stack.Screen name="referrals/incoming" />
      <Stack.Screen name="referrals/incoming/[id]" />
      <Stack.Screen name="referrals/[id]/care-team" />
      <Stack.Screen name="care-plans/index" />
      <Stack.Screen name="care-plans/new" />
      <Stack.Screen name="emergency/index" />
      <Stack.Screen name="emergency/[caseId]" />

      {/* ── Batch 6 · Sections W · X · Y · Z ── */}
      {/* W — Medical records */}
      <Stack.Screen name="records/[patientId]/access-log" />
      <Stack.Screen name="records/[patientId]/category/[category]" />
      {/* X — Notifications */}
      <Stack.Screen name="notifications/preferences" />
      {/* Y — Earnings / wallet / payout */}
      <Stack.Screen name="earnings/payout/[id]" />
      <Stack.Screen name="earnings/bank-account" />
      <Stack.Screen name="earnings/invoice/[id]" />
      {/* Z — Ratings / reviews / reputation */}
      <Stack.Screen name="reviews/quality-score" />
      <Stack.Screen name="reviews/ranking" />
      <Stack.Screen name="reviews/improvements" />

      {/* ── Batch 5 · Sections S · T · U · V — Veterinary ── */}
      {/* S — Vet consultation */}
      <Stack.Screen name="vet/appointments" />
      <Stack.Screen name="vet/requests" />
      <Stack.Screen name="vet/history" />
      <Stack.Screen name="vet/consult/[id]/chat" />
      <Stack.Screen name="vet/consult/[id]/call" />
      <Stack.Screen name="vet/consult/[id]/summary" />
      <Stack.Screen name="vet/pet/[id]/soap" />
      <Stack.Screen name="vet/pet/[id]/referral" />
      {/* T — Pet e-prescription */}
      <Stack.Screen name="vet/pet/[id]/prescription/issue" />
      <Stack.Screen name="vet/prescriptions" />
      <Stack.Screen name="vet/refills" />
      {/* U — Vet lab & pet health */}
      <Stack.Screen name="vet/lab-inbox" />
      <Stack.Screen name="vet/pet/[id]/vaccinations" />
      <Stack.Screen name="vet/pet/[id]/health-record" />
      <Stack.Screen name="vet/pet/[id]/growth" />
      <Stack.Screen name="vet/pet/[id]/chronic" />
      {/* V — Pet store */}
      <Stack.Screen name="vet/product/[id]" />
      <Stack.Screen name="vet/fulfilments" />

      {/* ── Batch 7 · Sections AA · AB · AC · AD ── */}
      {/* AA — Support & dispute */}
      <Stack.Screen name="support/tickets/new" />
      <Stack.Screen name="support/chat/[threadId]" />
      <Stack.Screen name="support/disputes/index" />
      <Stack.Screen name="support/disputes/new" />
      <Stack.Screen name="support/dispute/[id]" />
      {/* AB — Compliance, privacy & audit */}
      <Stack.Screen name="compliance/privacy" />
      <Stack.Screen name="compliance/audit/[scope]" />
      <Stack.Screen name="compliance/training" />
      <Stack.Screen name="compliance/safety-issue" />
      <Stack.Screen name="compliance/account-review" />
      {/* AC — Settings */}
      <Stack.Screen name="settings/security" />
      <Stack.Screen name="settings/security/change-password" />
      <Stack.Screen name="settings/security/two-factor" />
      <Stack.Screen name="settings/app-preferences" />
      <Stack.Screen name="settings/devices" />
      <Stack.Screen name="settings/delete-account" />
      {/* AD — Empty / error / edge-state gates */}
      <Stack.Screen name="app-status" />
      <Stack.Screen name="account-status/index" />
      <Stack.Screen name="account-status/session-expired" />
      <Stack.Screen name="account-status/access-denied" />
    </Stack>
  );
}
