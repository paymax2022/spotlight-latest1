import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, CircleCheck, TriangleAlert, Info } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';

import { useLogCustody } from '@/features/health/lab/hooks';

type Outcome = 'ok' | 'breach' | null;

export default function ChainOfCustodyScreen() {
  const { orderId, patient } = useLocalSearchParams<{ orderId: string; patient: string }>();
  const logCustody = useLogCustody();

  const [barcode, setBarcode] = useState('');
  const [conditionOk, setConditionOk] = useState(true);
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<Outcome>(null);

  const onLog = async () => {
    const res = await logCustody.mutateAsync({
      orderId,
      barcode: barcode.trim(),
      conditionOk,
      note: note.trim() || undefined,
    });
    setOutcome(res.breach ? 'breach' : 'ok');
  };

  if (outcome === 'ok') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Chain of custody" subtitle={patient} />
        <StateView
          kind="empty"
          icon="CircleCheck"
          title="Custody logged"
          message="Sample sealed and tracked. Proceed to drop it off at the lab for accessioning."
          actionLabel="Continue to drop-off"
          onAction={() =>
            router.push({
              pathname: '/health/lab/phlebotomist/drop-off',
              params: { orderId, barcode: barcode.trim() },
            })
          }
        />
      </SafeAreaView>
    );
  }

  if (outcome === 'breach') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Chain of custody" subtitle={patient} />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.breachBanner}>
            <TriangleAlert size={22} color={Colors.error} />
            <Text style={styles.breachText}>
              Integrity breach recorded. This sample must be recollected — it cannot proceed to
              accessioning (HL-6).
            </Text>
          </View>
          <PrimaryButton
            label="Back to assignments"
            variant="ghost"
            onPress={() => router.replace('/health/lab/phlebotomist/assignments')}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Chain of custody" subtitle={patient} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.note}>
          <Info size={18} color={Colors.primary} />
          <Text style={styles.noteText}>
            Once logged, this sample is tracked immutably from collection to accession.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sample barcode</Text>
          <TextInputField
            label="Barcode / accession ID"
            value={barcode}
            onChangeText={setBarcode}
            placeholder="Scan or enter barcode"
          />
          <View style={styles.scanRow}>
            <Camera size={18} color={Colors.onSurfaceVariant} />
            <Text style={styles.scanText}>Tap to scan the tube barcode</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sample condition</Text>

          <Pressable
            style={[styles.option, conditionOk && styles.optionActiveOk]}
            onPress={() => setConditionOk(true)}
          >
            <CircleCheck size={22} color={Colors.teal} />
            <Text style={styles.optionLabel}>Seal intact / cold chain OK</Text>
          </Pressable>

          <Pressable
            style={[styles.option, !conditionOk && styles.optionActiveBad]}
            onPress={() => setConditionOk(false)}
          >
            <TriangleAlert size={22} color={Colors.error} />
            <Text style={styles.optionLabel}>Integrity issue</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Note (optional)</Text>
          <TextInputField
            value={note}
            onChangeText={setNote}
            placeholder="Add any handling notes"
            multiline
          />
        </View>

        <PrimaryButton
          label="Log custody & seal"
          onPress={onLog}
          loading={logCustody.isPending}
          disabled={!barcode.trim()}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  note: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.iconBgBlue,
  },
  noteText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...shadow1,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  scanText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
  },
  optionActiveOk: { borderColor: Colors.teal, backgroundColor: Colors.tertiaryContainer },
  optionActiveBad: { borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  optionLabel: { ...Typography.bodyLg, color: Colors.onSurface, flex: 1 },
  breachBanner: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Colors.errorContainer,
  },
  breachText: { ...Typography.bodyMd, color: Colors.error, flex: 1 },
});
