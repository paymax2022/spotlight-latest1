import React from 'react';
import { FlatList, View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { BadgeCheck, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useOffers } from '@/features/crowdfunding/hooks/useInvestment';
import { formatNairaCompact, progressPct } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { OfferStatus } from '@/features/crowdfunding/types/investment.types';

const STATUS: Record<OfferStatus, { label: string; fg: string; bg: string }> = {
  OPEN: { label: 'Open', fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  CLOSING_SOON: { label: 'Closing soon', fg: '#B65A00', bg: Colors.iconBgOrange },
  CLOSED: { label: 'Closed', fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  FUNDED: { label: 'Funded', fg: Colors.secondary, bg: Colors.iconBgBlue },
};

export default function OffersListScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useOffers();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Investment offers" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load offers" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderItem={({ item }) => {
            const meta = STATUS[item.status];
            const pct = progressPct(item.raisedKobo, item.targetKobo);
            return (
              <Pressable style={({ pressed }) => [styles.card, shadow1, pressed && { opacity: 0.9 }]} onPress={() => router.push(`/crowdfunding/investment/offer/${item.id}`)} accessibilityRole="button">
                <View style={styles.imageWrap}>
                  {item.coverImage ? <Image source={{ uri: item.coverImage }} style={styles.image} resizeMode="cover" /> : <View style={[styles.image, styles.imagePlaceholder]} />}
                  <View style={[styles.statusChip, { backgroundColor: meta.bg }]}><Text style={[styles.statusText, { color: meta.fg }]}>{meta.label}</Text></View>
                </View>
                <View style={styles.body}>
                  <View style={styles.metaRow}>
                    <Text style={styles.model}>{item.model.replace('_', ' ')}</Text>
                    {item.issuerVerified && <BadgeCheck size={14} color={Colors.secondary} strokeWidth={2.2} />}
                  </View>
                  <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.issuer}>{item.issuerName} · {item.sector}</Text>

                  <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
                  <View style={styles.statsRow}>
                    <Text style={styles.raised}>{formatNairaCompact(item.raisedKobo)} <Text style={styles.raisedSub}>of {formatNairaCompact(item.targetKobo)}</Text></Text>
                    <View style={styles.returnPill}><TrendingUp size={12} color={Colors.tertiaryContainer} strokeWidth={2} /><Text style={styles.returnText}>{item.projectedReturnPct}% / {item.termMonths}mo</Text></View>
                  </View>
                  <Text style={styles.min}>Min. {formatNairaCompact(item.minTicketKobo)} · {item.investorCount} investors</Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={<StateView kind="empty" icon="TrendingUp" title="No open offers" message="Check back soon for new investment opportunities." />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 60, flexGrow: 1 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  imageWrap: { position: 'relative', height: 140 },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { backgroundColor: Colors.surfaceContainerHigh },
  statusChip: { position: 'absolute', top: Spacing.sm, left: Spacing.sm, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { ...Typography.caption, fontWeight: '700' as const },
  body: { padding: Spacing.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  model: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  issuer: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  track: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.teal },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  raised: { ...Typography.labelLg, color: Colors.onSurface },
  raisedSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '400' as const },
  returnPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  returnText: { ...Typography.caption, color: Colors.tertiaryContainer, fontWeight: '600' as const },
  min: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 4 },
});
