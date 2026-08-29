import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function CrowdfundingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="search" options={{ animation: 'fade' }} />
      <Stack.Screen name="campaigns" />
      <Stack.Screen name="categories" />
      <Stack.Screen name="saved" />
      <Stack.Screen name="recently-viewed" />
      <Stack.Screen name="filter" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="sort" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Detail (D) */}
      <Stack.Screen name="campaign/[id]/index" />
      <Stack.Screen name="campaign/[id]/media" />
      <Stack.Screen name="campaign/[id]/rewards" />
      <Stack.Screen name="campaign/[id]/story" />
      <Stack.Screen name="campaign/[id]/budget" />
      <Stack.Screen name="campaign/[id]/creator" />
      <Stack.Screen name="campaign/[id]/contributors" />
      <Stack.Screen name="campaign/[id]/updates" />
      <Stack.Screen name="campaign/[id]/milestones" />
      <Stack.Screen name="campaign/[id]/documents" />
      <Stack.Screen name="campaign/[id]/faq" />
      <Stack.Screen name="campaign/[id]/report" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="campaign/[id]/share" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Updates & communication (H) */}
      <Stack.Screen name="campaign/[id]/comments" />
      <Stack.Screen name="campaign/[id]/post-update" />
      <Stack.Screen name="campaign/[id]/broadcast" />

      {/* Contribution flow (E) */}
      <Stack.Screen name="contribute/[id]/index" />
      <Stack.Screen name="contribute/[id]/summary" />
      <Stack.Screen name="contribute/[id]/processing" options={{ gestureEnabled: false }} />
      <Stack.Screen name="contribute/[id]/success" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="contribute/[id]/failed" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="contribute/[id]/receipt" />

      {/* Contribution history */}
      <Stack.Screen name="contributions/index" />
      <Stack.Screen name="contributions/[id]/index" />
      <Stack.Screen name="contributions/[id]/refund" options={{ animation: 'slide_from_bottom' }} />

      {/* Creator dashboard (F) */}
      <Stack.Screen name="creator/index" />
      <Stack.Screen name="creator/campaigns" />
      <Stack.Screen name="creator/campaign/[id]/index" />
      <Stack.Screen name="creator/campaign/[id]/edit" />
      <Stack.Screen name="creator/performance/[id]" />
      <Stack.Screen name="creator/withdrawals" />
      <Stack.Screen name="creator/notifications" />

      {/* Campaign creation wizard (G) */}
      <Stack.Screen name="create/index" />
      <Stack.Screen name="create/category" />
      <Stack.Screen name="create/details" />
      <Stack.Screen name="create/story" />
      <Stack.Screen name="create/media" />
      <Stack.Screen name="create/funding" />
      <Stack.Screen name="create/beneficiary" />
      <Stack.Screen name="create/budget" />
      <Stack.Screen name="create/preview" />
      <Stack.Screen name="create/success" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Wallet, funds & withdrawal (I) */}
      <Stack.Screen name="wallet/index" />
      <Stack.Screen name="wallet/ledger" />
      <Stack.Screen name="wallet/transaction/[id]" />
      <Stack.Screen name="wallet/withdraw" />

      {/* Milestones & impact (J) */}
      <Stack.Screen name="milestones/[id]/index" />
      <Stack.Screen name="milestones/[id]/[milestoneId]" />
      <Stack.Screen name="milestones/[id]/impact" />

      {/* Reward fulfilment (K) */}
      <Stack.Screen name="rewards/index" />
      <Stack.Screen name="rewards/[backerId]" />

      {/* Notifications (N) */}
      <Stack.Screen name="notifications" />

      {/* Support & disputes (O) */}
      <Stack.Screen name="support/index" />
      <Stack.Screen name="support/tickets" />
      <Stack.Screen name="support/create" />
      <Stack.Screen name="support/ticket/[id]" />

      {/* Settings (P) */}
      <Stack.Screen name="settings/index" />
      <Stack.Screen name="settings/profile" />
      <Stack.Screen name="settings/verification" />
      <Stack.Screen name="settings/bank-accounts" />
      <Stack.Screen name="settings/payment" />
      <Stack.Screen name="settings/notifications" />
      <Stack.Screen name="settings/language" />
      <Stack.Screen name="settings/theme" />
      <Stack.Screen name="settings/security" />
      <Stack.Screen name="settings/change-password" />
      <Stack.Screen name="settings/add-card" />
      <Stack.Screen name="settings/add-bank" />
      <Stack.Screen name="settings/privacy" />
      <Stack.Screen name="settings/data-export" />
      <Stack.Screen name="settings/delete" options={{ animation: 'slide_from_bottom' }} />

      {/* Investment crowdfunding (L) — feature-flagged */}
      <Stack.Screen name="investment/index" />
      <Stack.Screen name="investment/education" />
      <Stack.Screen name="investment/quiz" />
      <Stack.Screen name="investment/risk-profile" />
      <Stack.Screen name="investment/offers" />
      <Stack.Screen name="investment/offer/[id]" />
      <Stack.Screen name="investment/invest/[id]" />
      <Stack.Screen name="investment/certificate" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="investment/portfolio" />

      {/* Corporate CSR / matching (M) — feature-flagged */}
      <Stack.Screen name="csr/index" />
      <Stack.Screen name="csr/campaigns" />
      <Stack.Screen name="csr/campaign/[id]" />
      <Stack.Screen name="csr/match/[id]" />
      <Stack.Screen name="csr/matches" />
      <Stack.Screen name="csr/reports" />
      <Stack.Screen name="csr/invoices" />
      <Stack.Screen name="csr/employee-giving" />

      {/* Edge & error states (Q) */}
      <Stack.Screen name="edge/[type]" options={{ animation: 'fade' }} />
    </Stack>
  );
}
