import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Signature, TriangleAlert, Check, CircleCheck } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';

import { useReleaseResult } from '@/features/health/lab/hooks';

export default function LabProviderResultReleaseScreen() {
  const { orderId, resultId, critical } = useLocalSearchParams<{
    orderId: string;
    resultId: string;
    critical: string;
  }>();
  const release = useReleaseResult();

  const isCritical = critical === '1';
  const [signedBy, setSignedBy] = useState('');
  const [criticalAck, setCriticalAck] = useState(false);
  const [released, setReleased] = useState(false);

  const canRelease = signedBy.trim().length > 0 && (!isCritical || criticalAck);

  const onRelease = async () => {
    await release.mutateAsync({
      orderId: orderId as string,
      resultId: resultId as string,
      signedBy: signedBy.trim(),
      criticalAcknowledged: isCritical ? criticalAck : undefined,
    });
    setReleased(true);
  };

  if (released) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Release result" subtitle="HL-7 sign-off" />
        <StateView
          kind="empty"
          icon="CircleCheck"
          title="Result released"
          message={
            isCritical
              ? 'The result has been released. The patient and on-call clinician have been notified via the critical escalation pathway.'
              : 'The result has been signed off and released to the patient.'
          }
          actionLabel="Back to orders"
          onAction={() => router.replace('/health/lab/provider/orders')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Release result" subtitle="HL-7 sign-off" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.signHeader}>
            <Signature size={20} color={Colors.secondary} />
            <Text style={styles.cardTitle}>Scientist sign-off</Text>
          </View>
          <Text style={styles.note}>
            A qualified scientist validates and releases this result. Your name and licence are recorded
            against the release.
          </Text>
          <TextInputField
            label="Signed by"
            value={signedBy}
            onChangeText={setSignedBy}
            placeholder="e.g. J. Okafor, AMLSCN"
          />
        </View>

        {isCritical ? (
          <View style={styles.criticalCard}>
            <View style={styles.criticalHeader}>
              <TriangleAlert size={20} color={Colors.error} />
              <Text style={styles.criticalTitle}>Critical result</Text>
            </View>
            <Text style={styles.criticalBody}>
              This is a CRITICAL result. Releasing it triggers the escalation pathway, which notifies a
              clinician and the patient. This is never silent — you must acknowledge it.
            </Text>
            <Pressable style={styles.checkbox} onPress={() => setCriticalAck((v) => !v)}>
              <View style={[styles.checkBox, criticalAck && styles.checkBoxOn]}>
                {criticalAck ? <Check size={16} color={Colors.white} /> : null}
              </View>
              <Text style={styles.checkLabel}>
                I acknowledge the critical escalation pathway will notify the clinician and patient.
              </Text>
            </Pressable>
          </View>
        ) : null}

        <PrimaryButton
          label="Sign off & release"
          onPress={onRelease}
          loading={release.isPending}
          disabled={!canRelease}
          variant={isCritical ? 'danger' : 'primary'}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...shadow1,
  },
  signHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  criticalCard: {
    backgroundColor: Colors.errorContainer,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  criticalHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  criticalTitle: { ...Typography.titleMd, color: Colors.error },
  criticalBody: { ...Typography.bodySm, color: Colors.error },
  checkbox: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: Radius.sm,
    borderWidth: 2,
    borderColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { backgroundColor: Colors.error },
  checkLabel: { ...Typography.bodySm, color: Colors.error, flex: 1 },
});
