import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Spotlight Academy (K-12 EdTech) learner stack. Mock-first; the whole surface
 * sits behind the `academy` feature flag. Nested under app/learn/ so it doesn't
 * collide with the existing Invest Learn Center at app/learn/index.
 */
export default function AcademyLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Home */}
      <Stack.Screen name="index" />

      {/* Onboarding (A5–A9) */}
      <Stack.Screen name="onboarding/role" />
      <Stack.Screen name="onboarding/age" />
      <Stack.Screen name="onboarding/consent" />
      <Stack.Screen name="onboarding/class" />

      {/* Learning loop (L3–L13) */}
      <Stack.Screen name="subjects" />
      <Stack.Screen name="subject/[id]" />
      <Stack.Screen name="topic/[id]" />
      <Stack.Screen name="lesson/[id]" />
      <Stack.Screen name="practice/[objectiveId]" />
      <Stack.Screen name="mastery/[topicId]" />

      {/* Phase 2 — Learner (L2, L7, L8, L11, L14–L17, My path) */}
      <Stack.Screen name="goal/index" />
      <Stack.Screen name="path/index" />
      <Stack.Screen name="practice/adaptive" />
      <Stack.Screen name="lesson/transcript/[id]" />
      <Stack.Screen name="lesson/interactive/[id]" />
      <Stack.Screen name="search/index" />
      <Stack.Screen name="bookmarks/index" />
      <Stack.Screen name="notes/index" />
      <Stack.Screen name="downloads/index" />

      {/* Exam arenas — the Crown (X1–X9) */}
      <Stack.Screen name="exam/index" />
      <Stack.Screen name="exam/[arenaId]" />
      <Stack.Screen name="exam/setup/[arenaId]" />
      <Stack.Screen name="exam/cbt/[attemptId]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="exam/submit/[attemptId]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="exam/result/[attemptId]" />

      {/* Rewards (G6–G7) */}
      <Stack.Screen name="rewards/index" />
      <Stack.Screen name="rewards/redeem" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Wallet & store (W1, W5–W7) */}
      <Stack.Screen name="wallet/index" />
      <Stack.Screen name="store/index" />
      <Stack.Screen name="store/[bundleId]" />
      <Stack.Screen name="store/access-card" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Phase 2 — Parent / Guardian (P1–P13) + EduPay (P8–P10) */}
      <Stack.Screen name="parent/index" />
      <Stack.Screen name="parent/add-child" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="parent/child/[minorId]" />
      <Stack.Screen name="parent/child/[minorId]/subject/[subjectId]" />
      <Stack.Screen name="parent/child/[minorId]/controls" />
      <Stack.Screen name="parent/reports" />
      <Stack.Screen name="parent/approvals" />
      <Stack.Screen name="parent/edupay/index" />
      <Stack.Screen name="parent/edupay/pay/[feeId]" />
      <Stack.Screen name="parent/edupay/pots" />
      <Stack.Screen name="parent/scholarships" />
      <Stack.Screen name="parent/billing" />
      <Stack.Screen name="parent/notifications" />

      {/* Phase 3 — Trade & Skills, the Moat (S1–S8) */}
      <Stack.Screen name="trade/index" />
      <Stack.Screen name="trade/tracks" />
      <Stack.Screen name="trade/module/[id]" />
      <Stack.Screen name="trade/project/[id]" />
      <Stack.Screen name="trade/assessment/[id]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="trade/mentors" />

      {/* Phase 3 — Credentials & earning bridge (G10/G11 + S5/S6/S7) */}
      <Stack.Screen name="certificates/index" />
      <Stack.Screen name="certificates/[id]" />
      <Stack.Screen name="certificates/verify/[verificationId]" />
      <Stack.Screen name="earn/index" />
      <Stack.Screen name="earn/[id]" />

      {/* Phase 3 — Live, Community & Notifications (C1–C7) */}
      <Stack.Screen name="live/index" />
      <Stack.Screen name="live/room/[id]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="live/replay/[id]" />
      <Stack.Screen name="community/index" />
      <Stack.Screen name="community/discussions" />
      <Stack.Screen name="notifications/index" />
      <Stack.Screen name="announcements/index" />

      {/* Phase 4 — Tutor & School (T1–T8) */}
      <Stack.Screen name="tutor/index" />
      <Stack.Screen name="tutor/onboard" />
      <Stack.Screen name="tutor/profile" />
      <Stack.Screen name="tutor/roster" />
      <Stack.Screen name="tutor/assignments" />
      <Stack.Screen name="tutor/grade" />
      <Stack.Screen name="tutor/live" />
      <Stack.Screen name="tutor/earnings" />
      <Stack.Screen name="tutor/school" />
      <Stack.Screen name="tutor/school/[id]" />

      {/* Phase 4 — ECCE / Little Learners (E1–E3) */}
      <Stack.Screen name="ecce/index" />
      <Stack.Screen name="ecce/play/[id]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="ecce/gate" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* EdTech School-Fees — Parent (PA-01 … PA-16) · mock-first behind
          EXPO_PUBLIC_ACADEMY_FEES_USE_MOCK. Live path → /api/finance/academy/fees. */}
      <Stack.Screen name="fees/index" />
      <Stack.Screen name="fees/onboarding" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="fees/invoices/[childId]" />
      <Stack.Screen name="fees/invoice/[invoiceId]" />
      <Stack.Screen name="fees/pay/[invoiceId]" />
      <Stack.Screen name="fees/installments/[invoiceId]" />
      <Stack.Screen name="fees/disclosure/[invoiceId]" />
      <Stack.Screen name="fees/vault/index" />
      <Stack.Screen name="fees/vault/auto-save/[vaultId]" />
      <Stack.Screen name="fees/receipts" />
      <Stack.Screen name="fees/hardship" />
      <Stack.Screen name="fees/sponsor" />
      <Stack.Screen name="fees/directory" />

      {/* EdTech Cross-School Competition — Student (SA-121 … SA-126) */}
      <Stack.Screen name="competition/index" />
      <Stack.Screen name="competition/leaderboard" />
      <Stack.Screen name="competition/challenge" />
      <Stack.Screen name="competition/badges" />
    </Stack>
  );
}
