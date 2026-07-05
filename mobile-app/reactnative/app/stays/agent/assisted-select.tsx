import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useAgentProperty } from '@/features/stays/agent';
import { formatNaira, formatStayRange } from '@/features/stays/constants/stays.constants';

const RATE_PLANS = [
  { id: 'rp_flex', name: 'Flexible · Breakfast', refundable: true },
  { id: 'rp_nonref', name: 'Non-refundable · Room only', refundable: false },
];

/** Agent: assisted property/room selection (PRD §20.3). */
export default function AssistedSelectScreen() {
  const { customerId, propertyId, checkIn, checkOut } = useLocalSearchParams<{ customerId: string; propertyId: string; checkIn: string; checkOut: string }>();
  const property = useAgentProperty(propertyId ?? '');
  const [ratePlanId, setRatePlanId] = React.useState(RATE_PLANS[0].id);

  if (property.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Select room & rate" />
        <StateView kind="loading" message="Loading property…" />
      </SafeAreaView>
    );
  }
  if (property.isError || !property.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Select room & rate" />
        <StateView kind="error" title="Couldn't load property" actionLabel="Back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const p = property.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Select room & rate" subtitle={p.name} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Image source={{ uri: p.coverUrl }} style={styles.cover} />
        <View style={styles.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{p.name}</Text>
            <Text style={styles.line}>{p.area}, {p.city}</Text>
          </View>
          <View style={styles.scoreChip}>
            <Star size={12} color={Colors.gold} fill={Colors.gold} />
            <Text style={styles.scoreText}>{p.reviewScore.toFixed(1)}</Text>
          </View>
        </View>
        {checkIn && checkOut ? <Text style={styles.dates}>{formatStayRange(checkIn, checkOut)}</Text> : null}

        <Text style={styles.section}>Room type</Text>
        <View style={styles.roomCard}>
          <Text style={styles.roomName}>Deluxe Room</Text>
          <Text style={styles.line}>Sleeps 2 · 1 king bed</Text>
        </View>

        <Text style={styles.section}>Rate plan</Text>
        {RATE_PLANS.map((rp) => {
          const active = ratePlanId === rp.id;
          return (
            <Pressable key={rp.id} style={[styles.rate, active && styles.rateActive]} onPress={() => setRatePlanId(rp.id)}>
              <View style={[styles.radio, active && styles.radioOn]}>{active ? <Check size={12} color={Colors.onPrimary} strokeWidth={3} /> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rateName}>{rp.name}</Text>
                <Text style={styles.rateSub}>{rp.refundable ? 'Free cancellation' : 'Non-refundable'}</Text>
              </View>
              <Text style={styles.ratePrice}>{formatNaira(p.leadPriceMinor)}/night</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label="Build quote & hold"
          onPress={() => router.push({ pathname: '/stays/agent/quote-hold', params: { customerId, propertyId, ratePlanId, checkIn, checkOut } })}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  cover: { width: '100%', height: 170, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainer },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  line: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  scoreChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  scoreText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '700' as const },
  dates: { ...Typography.caption, color: Colors.onSurfaceVariant },
  section: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.md },
  roomCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: 2 },
  roomName: { ...Typography.titleMd, color: Colors.onSurface },
  rate: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  rateActive: { borderColor: Colors.primary },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  rateName: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' as const },
  rateSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  ratePrice: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' as const },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, ...shadow2 },
});
