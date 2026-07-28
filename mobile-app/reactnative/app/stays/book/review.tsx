import React from 'react';
import { View, Text, StyleSheet, Image, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CalendarRange, Users, BedDouble, ShieldCheck, Ban, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PriceBreakdown } from '@/features/stays/components';
import { useStaysStore } from '@/features/stays/store';
import { usePreviewBreakdown } from '@/features/stays/hooks';
import {
  formatStayRange, formatGuestSummary, BOARD_LABEL, StaysColors,
} from '@/features/stays/constants/stays.constants';

export default function BookingReview() {
  const { draft, addOnKeys, promoCode, useLoyalty } = useStaysStore();
  const preview = usePreviewBreakdown(
    draft ? { draft, addOnKeys, promoCode, useLoyalty } : ({} as any),
    !!draft,
  );

  if (!draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review booking" />
        <StateView kind="empty" icon="BedDouble" title="No room selected" message="Pick a rate plan to continue." actionLabel="Back to stays" onAction={() => router.replace('/stays')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review your booking" subtitle="Step 1 of 5" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Property summary */}
        <View style={styles.card}>
          <Image source={{ uri: draft.coverUrl }} style={styles.cover} />
          <View style={styles.cardBody}>
            <Text style={styles.name}>{draft.propertyName}</Text>
            <Text style={styles.city}>{draft.city}</Text>
          </View>
        </View>

        {/* Stay details */}
        <View style={styles.section}>
          <Detail icon={<CalendarRange size={18} color={StaysColors.brand} />} label="Dates" value={formatStayRange(draft.checkIn, draft.checkOut)} />
          <Detail icon={<Users size={18} color={StaysColors.brand} />} label="Guests" value={formatGuestSummary(draft.guests)} />
          <Detail icon={<BedDouble size={18} color={StaysColors.brand} />} label="Room" value={`${draft.roomTypeName} · ${draft.ratePlanName}`} />
          <Detail
            icon={draft.refundable ? <ShieldCheck size={18} color={StaysColors.ok} /> : <Ban size={18} color={Colors.error} />}
            label="Policy"
            value={draft.refundable ? 'Free cancellation available' : 'Non-refundable'}
            valueColor={draft.refundable ? StaysColors.ok : Colors.error}
          />
          <Detail label="Board" value={BOARD_LABEL[draft.board]} />
        </View>

        {/* Add-ons link */}
        <Pressable style={styles.linkRow} onPress={() => router.push('/stays/book/addons')}>
          <Text style={styles.linkLabel}>Add-ons & extras</Text>
          <View style={styles.linkRight}>
            <Text style={styles.linkValue}>{addOnKeys.length > 0 ? `${addOnKeys.length} selected` : 'None'}</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} />
          </View>
        </Pressable>
        <Pressable style={styles.linkRow} onPress={() => router.push('/stays/book/promo')}>
          <Text style={styles.linkLabel}>Promo & loyalty</Text>
          <View style={styles.linkRight}>
            <Text style={styles.linkValue}>{promoCode ? promoCode : useLoyalty ? 'Loyalty applied' : 'Add code'}</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} />
          </View>
        </Pressable>

        {/* Price preview */}
        <Text style={styles.priceHeading}>Price preview</Text>
        {preview.isLoading ? (
          <StateView kind="loading" message="Calculating price…" compact />
        ) : preview.isError || !preview.data ? (
          <StateView kind="error" title="Price unavailable" actionLabel="Retry" onAction={() => preview.refetch()} compact />
        ) : (
          <PriceBreakdown data={preview.data} />
        )}

        <Text style={styles.disclaimer}>
          We re-check live price and availability before charging. You won't be charged until the hotel confirms.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Continue to guest details" onPress={() => router.push('/stays/book/lead-guest')} />
      </View>
    </SafeAreaView>
  );
}

function Detail({ icon, label, value, valueColor }: { icon?: React.ReactNode; label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.detailRow}>
      {icon ? <View style={styles.detailIcon}>{icon}</View> : <View style={styles.detailIcon} />}
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, valueColor ? { color: valueColor } : null]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  card: { flexDirection: 'row', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, overflow: 'hidden', ...shadow1 },
  cover: { width: 96, height: 96, backgroundColor: Colors.surfaceContainerHigh },
  cardBody: { flex: 1, padding: Spacing.md, justifyContent: 'center' },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  city: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  section: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  detailIcon: { width: 28, alignItems: 'center' },
  detailLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant, width: 70 },
  detailValue: { ...Typography.bodySm, color: Colors.onSurface, fontWeight: '600' as const, flex: 1 },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  linkLabel: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
  linkRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkValue: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  priceHeading: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  disclaimer: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, ...shadow2 },
});
