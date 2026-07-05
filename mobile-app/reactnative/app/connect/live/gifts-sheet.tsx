import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Lock, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TierLimitBar from '@/features/connect/components/TierLimitBar';
import LiveMoneyNotice from '@/features/connect/components/live-MoneyNotice';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { useTierStatus } from '@/features/connect/hooks/useConnect';
import { useGifts, useSendGift } from '@/features/connect/live/hooks';
import { makeIdempotencyKey } from '@/features/connect/live/api';
import type { LiveGift } from '@/features/connect/live/types';

/**
 * Gift drawer (PRD §10.6 LV-06/07/08). Gifts are REAL Naira wallet money:
 *  - renders TierLimitBar (tier + daily limit + remaining allowance)
 *  - blocks gifts above the remaining allowance / above the user's tier
 *  - sends an Idempotency-Key on confirm (money-handling iron rule)
 */
export default function GiftsSheetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const streamId = id ?? '';
  const tier = useTierStatus();
  const giftsQ = useGifts();
  const send = useSendGift();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sent, setSent] = useState<{ amountKobo: number } | null>(null);

  const gifts = giftsQ.data ?? [];
  const selected = useMemo(() => gifts.find((g) => g.id === selectedId) ?? null, [gifts, selectedId]);

  const remaining = tier.data?.remainingKobo ?? null;
  const tierNum = tier.data?.tier ?? 0;

  function affordability(g: LiveGift): 'ok' | 'tier' | 'limit' {
    if (tierNum < g.tierMin) return 'tier';
    if (remaining != null && g.priceKobo > remaining) return 'limit';
    return 'ok';
  }

  const selectedAfford = selected ? affordability(selected) : 'ok';
  const canSend = !!selected && selectedAfford === 'ok' && !send.isPending;

  function onConfirm() {
    if (!selected || selectedAfford !== 'ok') return;
    send.mutate(
      {
        streamId,
        giftId: selected.id,
        amountKobo: selected.priceKobo,
        idempotencyKey: makeIdempotencyKey(`gift-${streamId}-${selected.id}`),
      },
      { onSuccess: () => setSent({ amountKobo: selected.priceKobo }) },
    );
  }

  if (sent) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScreenHeader title="Gift sent" showBack={false} />
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <CircleCheck size={40} color={ConnectColors.ok} strokeWidth={2} />
          </View>
          <Text style={styles.successTitle}>{formatKobo(sent.amountKobo)} gift sent</Text>
          <Text style={styles.successBody}>Real money was debited from your wallet and a balanced ledger entry recorded.</Text>
          <View style={{ width: '100%', marginTop: Spacing.lg }}>
            <PrimaryButton label="Back to stream" onPress={() => router.back()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Send a gift" subtitle="Real money from your wallet" />

      {tier.isLoading || giftsQ.isLoading ? (
        <StateView kind="loading" message="Loading gifts…" />
      ) : tier.isError || giftsQ.isError ? (
        <StateView kind="error" title="Couldn't load gifts" actionLabel="Retry" onAction={() => { tier.refetch(); giftsQ.refetch(); }} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {tier.data ? <TierLimitBar tier={tier.data} /> : null}
            <View style={{ height: Spacing.sm }} />
            <LiveMoneyNotice variant="real-money" />
            <View style={{ height: Spacing.md }} />

            <Text style={styles.sectionLabel}>Choose a gift</Text>
            <View style={styles.grid}>
              {gifts.map((g) => {
                const aff = affordability(g);
                const active = selectedId === g.id;
                const IconCmp =
                  (Icons as unknown as Record<string, Icons.LucideIcon>)[pascal(g.icon)] ?? Icons.Gift;
                return (
                  <Pressable
                    key={g.id}
                    disabled={aff === 'tier'}
                    onPress={() => setSelectedId(g.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: aff === 'tier' }}
                    style={[styles.giftCard, active && styles.giftCardActive, aff !== 'ok' && styles.giftCardDim]}
                  >
                    <View style={styles.giftIcon}>
                      <IconCmp size={26} color={ConnectColors.brand} strokeWidth={2} />
                    </View>
                    <Text style={styles.giftName}>{g.name}</Text>
                    <Text style={styles.giftPrice}>{formatKobo(g.priceKobo)}</Text>
                    {aff === 'tier' ? (
                      <View style={styles.lockRow}>
                        <Lock size={11} color={Colors.onWarning} strokeWidth={2.2} />
                        <Text style={styles.lockText}>Tier {g.tierMin}+</Text>
                      </View>
                    ) : aff === 'limit' ? (
                      <Text style={styles.overLimit}>Over today's limit</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            {selected ? (
              <Text style={styles.footerSummary}>
                {selected.name} · {formatKobo(selected.priceKobo)}
                {remaining != null ? `  ·  ${formatKobo(remaining)} left today` : ''}
              </Text>
            ) : (
              <Text style={styles.footerHint}>Select a gift to continue</Text>
            )}
            {selectedAfford === 'tier' ? (
              <PrimaryButton label="Upgrade tier to unlock" variant="secondary" onPress={() => router.push('/connect/me' as never)} />
            ) : selectedAfford === 'limit' ? (
              <Text style={styles.limitBlock}>This gift exceeds your remaining daily allowance. Choose a smaller gift or upgrade your tier.</Text>
            ) : (
              <PrimaryButton
                label={send.isPending ? 'Sending…' : selected ? `Send ${formatKobo(selected.priceKobo)} gift` : 'Send gift'}
                onPress={onConfirm}
                disabled={!canSend}
                loading={send.isPending}
              />
            )}
            {send.isError ? <Text style={styles.errText}>Gift failed. No money was moved — try again.</Text> : null}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

// lucide icon names in our mock are kebab-case; map to the PascalCase export.
function pascal(kebab: string): string {
  return kebab.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.lg },
  sectionLabel: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  giftCard: { width: '31%', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: ConnectColors.border, padding: Spacing.sm, alignItems: 'center', gap: 4 },
  giftCardActive: { borderColor: ConnectColors.brand, backgroundColor: Colors.iconBgPurple },
  giftCardDim: { opacity: 0.85 },
  giftIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  giftName: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
  giftPrice: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  lockText: { ...Typography.labelSm, color: Colors.onWarning, fontSize: 10 },
  overLimit: { ...Typography.labelSm, color: Colors.error, fontSize: 10, textAlign: 'center' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: ConnectColors.border, gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest },
  footerSummary: { ...Typography.labelMd, color: Colors.onSurface, textAlign: 'center' },
  footerHint: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  limitBlock: { ...Typography.bodySm, color: Colors.error, textAlign: 'center' },
  errText: { ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: ConnectColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  successTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  successBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xs },
});
