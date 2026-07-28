import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, Search } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { BookingStateBanner } from '@/features/stays/components';
import { useStaysStore } from '@/features/stays/store';
import { STAYS_ERRORS, StaysColors } from '@/features/stays/constants/stays.constants';
import type { StaysErrorCode } from '@/features/stays/constants/stays.constants';

/**
 * Booking failure / auto-release notice (PRD §11 — the #1 invariant). Explains
 * that the wallet hold was released, no charge was made, and offers retry or
 * alternatives. This is the structural answer to "I paid but the hotel has no
 * record" — money is never charged without a confirmed room.
 */
export default function FailureScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { draft, resetBooking, setPrebook } = useStaysStore();
  const errCode = (code as StaysErrorCode) ?? 'BOOK_REJECTED_BY_SUPPLIER';
  const message = STAYS_ERRORS[errCode] ?? STAYS_ERRORS.BOOK_REJECTED_BY_SUPPLIER;

  const retry = () => {
    // Re-run prebook → book by sending the user back to confirm with a fresh quote.
    setPrebook(null);
    if (draft) router.replace('/stays/book/confirm');
    else router.replace('/stays');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Booking not confirmed" showBack={false} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <BookingStateBanner state="BOOK_FAILED" message={message} />

        {/* Auto-release reassurance */}
        <View style={styles.releaseCard}>
          <View style={styles.releaseIcon}><ShieldCheck size={24} color={StaysColors.ok} strokeWidth={2} /></View>
          <Text style={styles.releaseTitle}>Your hold was released — no charge</Text>
          <Text style={styles.releaseBody}>
            We never charge you without a confirmed room. The money we held on your wallet has been released in full.
            You can retry now or pick a similar stay.
          </Text>
        </View>

        {draft ? (
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>{draft.propertyName}</Text>
            <Text style={styles.summaryLine}>{draft.roomTypeName} · {draft.ratePlanName}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <PrimaryButton label="Retry booking" onPress={retry} />
          <View style={styles.altRow}>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                label="See alternatives"
                variant="secondary"
                onPress={() => { resetBooking(); router.replace('/stays/results/list'); }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                label="Back to stays"
                variant="ghost"
                onPress={() => { resetBooking(); router.replace('/stays'); }}
              />
            </View>
          </View>
        </View>

        <View style={styles.helpRow}>
          <Search size={14} color={Colors.onSurfaceVariant} />
          <Text style={styles.helpText}>Error code: {errCode}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  releaseCard: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  releaseIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  releaseTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  releaseBody: { ...Typography.bodySm, color: Colors.onSurface, textAlign: 'center', lineHeight: 20 },
  summary: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  summaryTitle: { ...Typography.titleMd, color: Colors.onSurface },
  summaryLine: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  actions: { gap: Spacing.sm, marginTop: Spacing.sm },
  altRow: { flexDirection: 'row', gap: Spacing.sm },
  helpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: Spacing.sm },
  helpText: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
