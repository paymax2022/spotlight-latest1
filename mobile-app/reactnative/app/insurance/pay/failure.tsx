// ── Protection — purchase failed ─────────────────────────────────────────────
// A provider-side failure at bind is a FIRST-CLASS state here, not a rare edge.
// MyCover settles binds against a prefunded distributor float; when that float
// is empty every bind fails, and the person in front of the screen did nothing
// wrong.
//
// So this screen has three jobs, in order of importance:
//   1. Say plainly that they have NOT been charged. Nothing frightens someone
//      more than a failed payment screen that is vague about their money.
//   2. Not blame them, and not leak provider internals. "Insufficient wallet
//      fund for purchase" is our operational problem stated in our vendor's
//      words; showing it to a customer is both confusing and embarrassing.
//   3. Keep their application. Retrying reuses the same draft and the same
//      idempotency key, so a retry cannot become a second charge.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LifeBuoy, ShieldOff, WalletMinimal } from 'lucide-react-native';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import { getDraft } from '@/features/insurance/live/draft';
import { nairaFromKobo } from '@/features/insurance/live/money';

/**
 * What to tell the user, by failure code.
 *
 * Every branch says the same thing about their money, because that is the fact
 * they need first and it is true in all of them: the user debit is conditional
 * on a successful bind.
 */
function copyFor(code: string): { title: string; body: string; canRetry: boolean } {
  switch (code) {
    case 'PROVIDER_FLOAT_EXHAUSTED':
    case 'PROVIDER_UNAVAILABLE':
    case 'PROVIDER_TIMEOUT':
      return {
        title: "We couldn't complete your purchase",
        body:
          "The insurer couldn't issue your policy just now. This is on our side, not yours — and you have not been charged. Your answers are saved, so trying again takes one tap.",
        canRetry: true,
      };
    case 'QUOTE_EXPIRED':
      return {
        title: 'That price has expired',
        body:
          "Insurers only hold a price for a short while. You have not been charged. Get a fresh price and your details will still be there.",
        canRetry: true,
      };
    case 'KYC_TIER_INSUFFICIENT':
      return {
        title: 'One more verification step',
        body:
          'This cover needs a higher verification level on your Paymax account before it can be issued. You have not been charged.',
        canRetry: false,
      };
    case 'INSUFFICIENT_FUNDS':
      return {
        title: 'Not enough in your wallet',
        body:
          'There wasn’t enough in your Paymax wallet to pay this premium. Nothing was taken — top up and try again.',
        canRetry: true,
      };
    case 'NO_POLICY_RETURNED':
      return {
        title: "We couldn't confirm your policy",
        body:
          "The purchase didn't come back with a policy, so we've treated it as unsuccessful and you have not been charged. If anything does appear on your statement, contact us and we'll reverse it the same day.",
        canRetry: true,
      };
    default:
      return {
        title: "We couldn't complete your purchase",
        body:
          "Something went wrong before your policy could be issued. You have not been charged, and your answers are saved.",
        canRetry: true,
      };
  }
}

export default function PurchaseFailed() {
  const { draft: draftId, code } = useLocalSearchParams<{ draft?: string; code?: string }>();
  const draft = getDraft(draftId);
  const { title, body, canRetry } = copyFor(String(code ?? ''));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.iconWrap}>
          <ShieldOff size={34} color={Colors.error} strokeWidth={1.8} />
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>

        {/* The money statement gets its own block. It is the single fact people
            most need, and burying it in a paragraph is how it gets missed. */}
        <View style={styles.assurance}>
          <WalletMinimal size={18} color={InsuranceColors.ok} />
          <Text style={styles.assuranceText}>
            You have not been charged. We only take the premium once the insurer confirms your
            policy.
          </Text>
        </View>

        {draft ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Your application</Text>
            <Text style={styles.cardValue}>{draft.product.name}</Text>
            <Text style={styles.cardMeta}>
              {draft.product.underwriter}
              {draft.quote ? ` · ${nairaFromKobo(draft.quote.premiumKobo)}` : ''}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {canRetry ? (
          <>
            <PrimaryButton
              label={draft ? 'Try again' : 'Start again'}
              // Retrying reuses the SAME draft, and therefore the same
              // idempotency key — a retry can never become a second charge.
              onPress={() =>
                router.replace(
                  draft ? `/insurance/quote/review?draft=${draft.id}` : '/insurance/browse',
                )
              }
            />
            <PrimaryButton
              label="Back to Protection"
              variant="ghost"
              onPress={() => router.replace('/insurance')}
            />
          </>
        ) : (
          <PrimaryButton label="Back to Protection" onPress={() => router.replace('/insurance')} />
        )}
        <View style={styles.helpRow}>
          <LifeBuoy size={14} color={Colors.onSurfaceVariant} />
          <Text style={styles.helpText}>
            If you think you were charged, contact support and we'll sort it out.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.containerMargin,
    gap: Spacing.md,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: Radius.full,
    backgroundColor: Colors.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  body: {
    ...Typography.bodyMd,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 24,
  },
  assurance: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: InsuranceColors.okBg,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  assuranceText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 20 },
  card: {
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    padding: Spacing.md,
  },
  cardLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  cardValue: { ...Typography.labelLg, color: Colors.onSurface, marginTop: 2 },
  cardMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  footer: { padding: Spacing.containerMargin, gap: Spacing.sm },
  helpRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, justifyContent: 'center' },
  helpText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
