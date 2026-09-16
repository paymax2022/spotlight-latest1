import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Tag, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import { usePartnerOffers, formatNaira } from '@/features/loyalty/black';
import { LoyaltyColors } from '@/features/loyalty/constants/loyalty.constants';
import type { PartnerOffer } from '@/features/loyalty/black';
import { HomeMenuButton } from '@/components/HomeMenu';

export default function BlackPartners() {
  const offers = usePartnerOffers();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/loyalty/black')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Partner offers</Text>
        <HomeMenuButton />
      </View>

      {offers.isLoading ? (
        <StateView kind="loading" message="Loading offers…" />
      ) : offers.isError ? (
        <StateView kind="error" title="Couldn't load offers" actionLabel="Retry" onAction={() => offers.refetch()} />
      ) : (offers.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No offers right now" message="Check back soon for new Black partner deals." icon="Tag" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {offers.data!.map((o) => <OfferCard key={o.id} offer={o} />)}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function OfferCard({ offer }: { offer: PartnerOffer }) {
  return (
    <View style={styles.card}>
      <View style={[styles.badge, { backgroundColor: offer.thumbColor }]}><Text style={styles.badgeText}>{offer.partner[0]}</Text></View>
      <View style={{ flex: 1 }}>
        <View style={styles.titleRow}>
          <Text style={styles.partner}>{offer.partner}</Text>
          <View style={styles.catChip}><Text style={styles.catText}>{offer.category}</Text></View>
        </View>
        <Text style={styles.title}>{offer.title}</Text>
        <Text style={styles.desc}>{offer.description}</Text>
        <View style={styles.footer}>
          {offer.valueKobo ? <View style={styles.valueChip}><Tag size={12} color={LoyaltyColors.ok} /><Text style={styles.valueText}>Worth {formatNaira(offer.valueKobo)}</Text></View> : null}
          <View style={styles.expiry}><Clock size={12} color={LoyaltyColors.muted} /><Text style={styles.expiryText}>Ends {new Date(offer.expiresAtISO).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}</Text></View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.md },
  card: { flexDirection: 'row', gap: Spacing.md, backgroundColor: LoyaltyColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, ...shadow1 },
  badge: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  badgeText: { ...Typography.headlineMd, color: '#FFFFFF' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  partner: { ...Typography.labelMd, color: LoyaltyColors.muted },
  catChip: { backgroundColor: LoyaltyColors.surfaceAlt, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  catText: { ...Typography.labelSm, color: LoyaltyColors.muted },
  title: { ...Typography.titleMd, color: LoyaltyColors.text, marginTop: 2 },
  desc: { ...Typography.bodySm, color: LoyaltyColors.muted, marginTop: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.sm, flexWrap: 'wrap' },
  valueChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: LoyaltyColors.okBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  valueText: { ...Typography.labelSm, color: LoyaltyColors.ok },
  expiry: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  expiryText: { ...Typography.labelSm, color: LoyaltyColors.muted },
});
