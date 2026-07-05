import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import StockIcon from '@/features/stocks/components/StockIcon';
import { usePublicOffer } from '@/features/stocks/hooks/useStocks';
import { formatMoneyObj, formatDateTime } from '@/features/stocks/utils/stockFormatters';
import { NO_ADVICE_DISCLOSURE } from '@/features/stocks/constants/stocks.constants';
import type { PublicOffer } from '@/features/stocks/types/stocks.types';

const KIND_LABEL: Record<PublicOffer['kind'], string> = {
  ipo: 'IPO',
  rights: 'Rights issue',
};

const STATUS_NOTE: Record<PublicOffer['status'], string> = {
  open: 'This offer is open for applications.',
  upcoming: 'This offer has not opened yet. Applications open on the open date.',
  closed: 'This offer is closed and no longer accepting applications.',
};

export default function PublicOfferDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const offer = usePublicOffer(id);

  if (offer.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Offer" />
        <StateView kind="loading" message="Loading offer…" />
      </SafeAreaView>
    );
  }
  if (offer.isError || !offer.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Offer" />
        <StateView kind="error" title="Couldn't load offer" message="This offer could not be found." actionLabel="Retry" onAction={() => offer.refetch()} />
      </SafeAreaView>
    );
  }

  const o = offer.data;
  const isOpen = o.status === 'open';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={o.symbol} subtitle={KIND_LABEL[o.kind]} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <View style={styles.hero}>
          <StockIcon symbol={o.symbol} color={Colors.primary} size={48} />
          <Text style={styles.heroTitle}>{o.name}</Text>
          <View style={styles.kindBadge}>
            <Text style={styles.kindText}>{KIND_LABEL[o.kind]}</Text>
          </View>
        </View>

        <Text style={styles.summary}>{o.summary}</Text>

        {/* Detail card */}
        <View style={styles.card}>
          <Row label="Price band" value={`${formatMoneyObj(o.priceLow)} – ${formatMoneyObj(o.priceHigh)}`} />
          <View style={styles.divider} />
          <Row label="Minimum units" value={o.minUnits.toLocaleString('en-US')} />
          <View style={styles.divider} />
          <Row label="Opens" value={formatDateTime(o.openDate)} />
          <Row label="Closes" value={formatDateTime(o.closeDate)} />
          <View style={styles.divider} />
          <Row label="Status" value={STATUS_NOTE[o.status].split('.')[0]} />
        </View>

        {!isOpen ? (
          <View style={styles.statusNote}>
            <Text style={styles.statusNoteText}>{STATUS_NOTE[o.status]}</Text>
          </View>
        ) : null}

        {/* No-advice disclosure */}
        <View style={styles.disclosure}>
          <Info size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.disclosureText}>{NO_ADVICE_DISCLOSURE}</Text>
        </View>

        <View style={styles.actionWrap}>
          {isOpen ? (
            <PrimaryButton label="Apply" onPress={() => router.push({ pathname: '/stocks/offers/apply', params: { id: o.id } })} />
          ) : (
            <PrimaryButton label={o.status === 'upcoming' ? 'Not yet open' : 'Closed'} onPress={() => {}} disabled />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  hero: {
    alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.lg, gap: 8,
  },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.sm, textAlign: 'center' },
  kindBadge: { backgroundColor: Colors.iconBgPurple, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 4 },
  kindText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const },
  summary: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 20, paddingHorizontal: Spacing.xs },
  card: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 0 },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, textAlign: 'right', flexShrink: 1 },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  statusNote: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.lg, padding: Spacing.md },
  statusNoteText: { ...Typography.labelMd, color: Colors.onSurfaceVariant, lineHeight: 18 },
  disclosure: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: Spacing.xs },
  disclosureText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  actionWrap: { marginTop: Spacing.sm },
});
