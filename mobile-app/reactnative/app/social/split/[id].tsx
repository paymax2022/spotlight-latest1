import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SplitShareRow from '@/features/social/components/SplitShareRow';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useSplit, usePaySplitShare } from '@/features/social/hooks';
import { SocialColors, formatNaira } from '@/features/social/constants/social.constants';

export default function SplitDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const splitId = String(id);
  const split = useSplit(splitId);
  const payShare = usePaySplitShare(splitId);
  const pay = usePurchasePayment();

  if (split.isLoading) return <Shell><StateView kind="loading" message="Loading split…" /></Shell>;
  if (split.isError || !split.data) return <Shell><StateView kind="error" title="Couldn't load split" actionLabel="Retry" onAction={() => split.refetch()} /></Shell>;

  const s = split.data;
  const pct = Math.min(100, Math.round((s.collectedKobo / s.totalKobo) * 100));
  const yourShare = s.shares.find((sh) => sh.isYou);

  const payYourShare = () => {
    if (!yourShare || yourShare.state === 'paid') return;
    pay.start({
      amountKobo: yourShare.amountKobo,
      title: `Pay your share of ${s.title}`,
      charge: () => payShare.mutateAsync({ shareId: yourShare.id, amountKobo: yourShare.amountKobo }),
    });
  };

  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>{s.title}</Text>
          <Text style={styles.heroAmount}>{formatNaira(s.totalKobo)}</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
          <Text style={styles.heroSub}>{formatNaira(s.collectedKobo)} collected · {pct}% · {s.status === 'settled' ? 'Settled' : 'Collecting'}</Text>
        </View>

        <Text style={styles.sectionTitle}>Shares ({s.shares.length})</Text>
        <View style={styles.card}>
          {s.shares.map((sh) => (
            <SplitShareRow
              key={sh.id}
              share={sh}
              onPay={sh.isYou ? payYourShare : undefined}
              paying={payShare.isPending}
            />
          ))}
        </View>

        {yourShare && yourShare.state === 'paid' ? (
          <View style={styles.paidNote}><Text style={styles.paidText}>You've paid your share of {formatNaira(yourShare.amountKobo)}.</Text></View>
        ) : null}

        <View style={{ height: Spacing.xl }} />
      </ScrollView>
      <PaymentSheet controller={pay} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Split bill" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  heroTitle: { ...Typography.titleMd, color: Colors.inversePrimary },
  heroAmount: { ...Typography.headlineLg, color: Colors.onPrimary },
  heroSub: { ...Typography.labelSm, color: Colors.inversePrimary },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.onPrimary },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  card: { backgroundColor: SocialColors.surface, borderRadius: Radius.lg, paddingHorizontal: Spacing.cardPadding, paddingVertical: Spacing.xs, ...shadow1 },
  paidNote: { backgroundColor: SocialColors.okBg, borderRadius: Radius.md, padding: Spacing.md },
  paidText: { ...Typography.bodySm, color: SocialColors.ok },
});
