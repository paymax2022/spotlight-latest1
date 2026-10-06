// State that belongs to the signed-in user but lives outside the react-query
// cache: persisted keys and module-level stores. Logout cleared tokens and the
// query cache only, so on a shared device the next user inherited the previous
// user's carts, drafts and recents — and the academy offline queue replayed the
// previous user's rewards and quiz attempts under the new user's token.
//
// Stores are imported lazily so the root layout does not pull every feature
// module into startup just to be able to clear it.
import { deleteSecureItem } from '@/lib/secureStorage';
import { clearIntentKeys } from '@/utils/intentKey';

const PERSISTED_KEYS = ['recent_addresses_v1', 'mkt_recent_searches'];

export async function resetUserScopedState(): Promise<void> {
  clearIntentKeys();
  const steps: (() => Promise<unknown> | unknown)[] = [
    ...PERSISTED_KEYS.map((key) => () => deleteSecureItem(key)),
    async () => (await import('@/features/academy/offlineQueue')).clearOfflineQueue(),
    async () => (await import('@/features/crowdfunding/store/campaignDraftStore')).useCampaignDraft.getState().reset(),
    async () => (await import('@/features/food/cartStore')).useCartStore.getState().clear(),
    async () => (await import('@/features/health/pharmacy/cartStore')).useCartStore.getState().clear(),
    async () => (await import('@/features/realtor/store/applyStore')).useApplyStore.getState().reset(),
    async () => (await import('@/features/merchant/store/onboardingDraftStore')).useOnboardingDraft.getState().reset(),
  ];
  // Each step is independent: one failing store must not leave the rest behind.
  await Promise.all(steps.map(async (step) => {
    try { await step(); } catch { /* best-effort */ }
  }));
}
