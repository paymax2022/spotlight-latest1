import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useDraft } from '@/features/registration/hooks/useRegistration';
import { statusLabel } from '@/features/registration/utils/status';

export default function RegistrationSuccessScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appId = id ?? '';
  const draftQuery = useDraft(appId);
  const draft = draftQuery.data?.draft;

  if (draftQuery.isLoading || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StateView kind="loading" message="Finalising…" />
      </SafeAreaView>
    );
  }

  const awaitingPayment = draft.status === 'awaiting_payment';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.body}>
        <View style={[styles.iconBox, awaitingPayment && styles.iconBoxWarn]}>
          {awaitingPayment ? (
            <Clock size={48} color={Colors.onWarning} />
          ) : (
            <CheckCircle2 size={48} color={Colors.teal} />
          )}
        </View>

        <Text style={styles.title}>
          {awaitingPayment ? 'Almost there!' : 'Application submitted'}
        </Text>
        <Text style={styles.subtitle}>
          {awaitingPayment
            ? 'Your application is saved and awaiting payment of the registration fee to complete entry.'
            : 'Your Spotlight application has been received. We’ll review it and keep you posted.'}
        </Text>

        <View style={styles.refCard}>
          <Text style={styles.refLabel}>Application reference</Text>
          <Text style={styles.refValue}>{draft.reference}</Text>
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>{statusLabel(draft.status)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Track status" onPress={() => router.replace(`/registration/${appId}/status` as never)} />
        <PrimaryButton label="Back to contests" variant="secondary" onPress={() => router.replace('/registration' as never)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: {
    width: 96, height: 96, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm,
  },
  iconBoxWarn: { backgroundColor: Colors.iconBgGold },
  title: { ...Typography.headlineLg, color: Colors.onSurface, textAlign: 'center' },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', paddingHorizontal: Spacing.md },
  refCard: {
    width: '100%', marginTop: Spacing.lg, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant,
    alignItems: 'center', gap: Spacing.xs,
  },
  refLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  refValue: { ...Typography.titleLg, color: Colors.primary, fontWeight: '700' as const, letterSpacing: 1 },
  statusPill: { marginTop: Spacing.sm, paddingHorizontal: 12, paddingVertical: 4, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainer },
  statusPillText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '700' as const },
  footer: { padding: Spacing.containerMargin, gap: Spacing.sm },
});
