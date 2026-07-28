import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Minus, Plus, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useEvent } from '@/features/events/hooks';
import { EventColors, formatNaira } from '@/features/events/constants/events.constants';

export default function CheckoutTiers() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { data: e, isLoading, isError, refetch } = useEvent(eventId ?? '');
  const [tierId, setTierId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);

  if (isLoading) return <Shell><StateView kind="loading" message="Loading tickets…" /></Shell>;
  if (isError || !e) return <Shell><StateView kind="error" title="Couldn't load tickets" message="Please try again." actionLabel="Retry" onAction={() => refetch()} /></Shell>;

  const selected = e.tiers.find((t) => t.id === tierId);
  const remaining = selected ? selected.capacity - selected.sold : 0;
  const maxQty = Math.min(10, selected ? Math.max(0, remaining) : 10);
  const totalKobo = (selected?.price_kobo ?? 0) * qty;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Select tickets" subtitle={e.title} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {e.tiers.filter((t) => t.active).map((t) => {
          const active = t.id === tierId;
          const left = t.capacity - t.sold;
          const soldOut = left <= 0;
          return (
            <Pressable
              key={t.id}
              disabled={soldOut}
              onPress={() => { setTierId(t.id); setQty(1); }}
              style={[styles.tier, active && styles.tierActive, soldOut && styles.tierDim]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.tierName}>{t.name}</Text>
                {left <= 30 && left > 0 ? (
                  <Text style={styles.lowStock}>Only {left} left</Text>
                ) : soldOut ? <Text style={styles.soldOut}>Sold out</Text> : null}
              </View>
              <View style={styles.tierRight}>
                <Text style={styles.tierPrice}>{t.price_kobo === 0 ? 'Free' : formatNaira(t.price_kobo)}</Text>
                {active ? <View style={styles.check}><Check size={14} color={Colors.onPrimary} strokeWidth={3} /></View> : null}
              </View>
            </Pressable>
          );
        })}

        {selected ? (
          <View style={styles.qtyCard}>
            <Text style={styles.qtyLabel}>Quantity</Text>
            <View style={styles.qtyRow}>
              <Pressable onPress={() => setQty((q) => Math.max(1, q - 1))} style={styles.qtyBtn}><Minus size={18} color={Colors.onSurface} /></Pressable>
              <Text style={styles.qtyValue}>{qty}</Text>
              <Pressable onPress={() => setQty((q) => Math.min(maxQty, q + 1))} style={styles.qtyBtn}><Plus size={18} color={Colors.onSurface} /></Pressable>
            </View>
          </View>
        ) : null}

        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{formatNaira(totalKobo)}</Text>
        </View>
        <PrimaryButton
          label="Review order"
          disabled={!selected}
          onPress={() => router.push({ pathname: '/events/checkout/review', params: { eventId: e.id, tierId: selected!.id, qty: String(qty) } })}
        />
      </View>
    </SafeAreaView>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Select tickets" />{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  tier: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1.5, borderColor: Colors.transparent, ...shadow1 },
  tierActive: { borderColor: EventColors.brand, backgroundColor: Colors.surfaceContainerLowest },
  tierDim: { opacity: 0.5 },
  tierName: { ...Typography.titleMd, color: Colors.onSurface },
  tierDesc: { ...Typography.bodySm, color: EventColors.muted, marginTop: 2 },
  perks: { ...Typography.caption, color: EventColors.accent, marginTop: 4 },
  lowStock: { ...Typography.caption, color: EventColors.warnText, marginTop: 4 },
  soldOut: { ...Typography.caption, color: EventColors.danger, marginTop: 4 },
  tierRight: { alignItems: 'flex-end', gap: Spacing.sm },
  tierPrice: { ...Typography.labelLg, color: EventColors.brand },
  check: { width: 22, height: 22, borderRadius: 11, backgroundColor: EventColors.brand, alignItems: 'center', justifyContent: 'center' },
  qtyCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, ...shadow1 },
  qtyLabel: { ...Typography.titleMd, color: Colors.onSurface },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  qtyBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { ...Typography.titleLg, color: Colors.onSurface, minWidth: 24, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, gap: Spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...Typography.bodyMd, color: EventColors.muted },
  totalValue: { ...Typography.headlineMd, color: EventColors.brand },
});
