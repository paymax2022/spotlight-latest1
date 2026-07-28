import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Upload, MessageSquareWarning, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import RestrictionBanner from '@/features/visitor/components/RestrictionBanner';
import { useRestrictionStatus, visitorKeys } from '@/features/visitor/hooks/useVisitor';
import { __setRestriction } from '@/features/visitor/api/visitor.api';
import { formatNairaFromKobo } from '@/features/visitor/utils/visitorFormatters';
import { RESTRICTION_COPY } from '@/features/visitor/constants/visitor.constants';

export default function VisitorRestrictedScreen() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useRestrictionStatus();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Visitor access" />
        <StateView kind="loading" message="Checking your access…" />
      </SafeAreaView>
    );
  }
  if (isError || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Visitor access" />
        <StateView kind="error" title="Couldn't check access" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      </SafeAreaView>
    );
  }

  const copy = RESTRICTION_COPY[data.state];
  const restricted = data.state === 'hard_ban' || data.state === 'soft_restriction';

  // In a live build this routes to the Payments module. Here we simulate a
  // successful payment so the restore flow can be demonstrated end-to-end.
  const payToRestore = () => {
    __setRestriction({ state: 'restoration_pending' });
    qc.invalidateQueries({ queryKey: visitorKeys.restriction() });
    setTimeout(() => {
      __setRestriction({ state: 'access_restored', outstandingBalanceKobo: 0 });
      qc.invalidateQueries({ queryKey: visitorKeys.restriction() });
    }, 1800);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Visitor access" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={[styles.hero, restricted ? styles.heroDanger : styles.heroOk]}>
          <View style={[styles.heroIcon, { backgroundColor: Colors.white }]}>
            {restricted
              ? <Ban size={30} color={Colors.error} strokeWidth={1.8} />
              : <ShieldCheck size={30} color={Colors.teal} strokeWidth={1.8} />}
          </View>
          <Text style={styles.heroTitle}>{copy.title}</Text>
          <Text style={styles.heroBody}>{copy.body}</Text>
          {data.outstandingBalanceKobo > 0 ? (
            <View style={styles.balancePill}>
              <Text style={styles.balanceLabel}>Outstanding balance</Text>
              <Text style={styles.balanceValue}>{formatNairaFromKobo(data.outstandingBalanceKobo)}</Text>
            </View>
          ) : null}
        </View>

        {/* What's affected (PRD §10 / Section I) */}
        {restricted ? (
          <View style={styles.affectedCard}>
            <Text style={styles.affectedTitle}>What’s affected</Text>
            {['Creating visitor access codes', 'Voting in elections', 'Booking facilities', 'Posting in the community'].map((t) => (
              <View key={t} style={styles.affectedRow}>
                <View style={styles.affectedDot} />
                <Text style={styles.affectedText}>{t}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {data.state === 'restoration_pending' ? (
          <RestrictionBanner status={data} />
        ) : null}
      </ScrollView>

      {/* Footer actions */}
      <View style={styles.footer}>
        {data.state === 'hard_ban' || data.state === 'soft_restriction' ? (
          <>
            <PrimaryButton label="Pay to restore access" onPress={payToRestore} />
            <View style={styles.secondaryRow}>
              <SecondaryAction icon={<Upload size={18} color={Colors.secondary} />} label="Upload proof" onPress={() => router.push('/visitor/restriction/proof')} />
              <SecondaryAction icon={<MessageSquareWarning size={18} color={Colors.secondary} />} label="Appeal" onPress={() => router.push('/visitor/restriction/appeal')} />
            </View>
          </>
        ) : data.state === 'restoration_pending' ? (
          <PrimaryButton label="Refresh status" onPress={() => refetch()} />
        ) : (
          <PrimaryButton label="Continue to Visitors" onPress={() => router.replace('/visitor')} />
        )}
      </View>
    </SafeAreaView>
  );
}

function SecondaryAction({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.8 }]}>
      {icon}
      <Text style={styles.secondaryLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  hero: {
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    ...shadow1,
  },
  heroDanger: { backgroundColor: Colors.errorContainer },
  heroOk: { backgroundColor: Colors.iconBgTeal },
  heroIcon: { width: 60, height: 60, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  heroBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  balancePill: {
    marginTop: Spacing.sm,
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  balanceLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  balanceValue: { ...Typography.headlineMd, color: Colors.error },
  affectedCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerLow,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  affectedTitle: { ...Typography.labelLg, color: Colors.onSurface },
  affectedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  affectedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.error },
  affectedText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerLow,
    gap: Spacing.sm,
  },
  secondaryRow: { flexDirection: 'row', gap: Spacing.md },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 48,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLow,
  },
  secondaryLabel: { ...Typography.labelMd, color: Colors.secondary },
});
