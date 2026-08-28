import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ShieldCheck, Camera, CircleCheck, TriangleAlert } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';

import { useAccessionSample } from '@/features/health/lab/hooks';

type AccessionResult = { ok: boolean; status: 'ACCESSIONED' | 'breached' };

export default function LabProviderAccessioningScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const accession = useAccessionSample();

  const [barcode, setBarcode] = useState('');
  const [conditionOk, setConditionOk] = useState(true);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<AccessionResult | null>(null);

  const onAccession = async () => {
    const res = await accession.mutateAsync({
      orderId: orderId as string,
      barcode: barcode.trim(),
      conditionOk,
      note: note.trim() || undefined,
    });
    setResult(res);
  };

  if (result && result.status === 'ACCESSIONED') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Accessioning" subtitle="HL-6" />
        <StateView
          kind="empty"
          icon="CircleCheck"
          title="Sample accessioned"
          message="Chain of custody recorded. You can now enter results for this order."
          actionLabel="Enter results"
          onAction={() =>
            router.push({ pathname: '/health/lab/provider/result-entry', params: { orderId } })
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Accessioning" subtitle="HL-6" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.custody}>
          <ShieldCheck size={18} color={Colors.teal} />
          <Text style={styles.custodyText}>
            HL-6 chain of custody: confirm the sample identity and integrity on receipt before processing.
          </Text>
        </View>

        {result && result.status === 'breached' ? (
          <View style={styles.breachBanner}>
            <TriangleAlert size={20} color={Colors.error} />
            <View style={styles.breachText}>
              <Text style={styles.breachTitle}>Integrity breach</Text>
              <Text style={styles.breachMsg}>
                This sample failed the condition check and must be recollected (HL-6). Do not process it.
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sample barcode</Text>
          <TextInputField
            value={barcode}
            onChangeText={setBarcode}
            placeholder="Scan or enter barcode"
          />
          <Pressable style={styles.scanRow}>
            <Camera size={18} color={Colors.secondary} />
            <Text style={styles.scanText}>Scan barcode</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sample condition</Text>
          <View style={styles.conditionRow}>
            <Pressable
              style={[styles.conditionOpt, conditionOk && styles.conditionOkActive]}
              onPress={() => setConditionOk(true)}
            >
              <CircleCheck size={20} color={conditionOk ? Colors.teal : Colors.onSurfaceVariant} />
              <Text style={[styles.conditionLabel, conditionOk && { color: Colors.teal }]}>Condition OK</Text>
            </Pressable>
            <Pressable
              style={[styles.conditionOpt, !conditionOk && styles.conditionBreachActive]}
              onPress={() => setConditionOk(false)}
            >
              <TriangleAlert size={20} color={!conditionOk ? Colors.error : Colors.onSurfaceVariant} />
              <Text style={[styles.conditionLabel, !conditionOk && { color: Colors.error }]}>Integrity breach</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Note (optional)</Text>
          <TextInputField
            value={note}
            onChangeText={setNote}
            placeholder="Any observations on receipt"
            multiline
          />
        </View>

        {result && result.status === 'breached' ? (
          <PrimaryButton label="Flag for recollection" variant="ghost" onPress={() => goBack('/health/lab')} />
        ) : (
          <PrimaryButton
            label="Accession sample"
            onPress={onAccession}
            loading={accession.isPending}
            disabled={!barcode.trim()}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  custody: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.tertiaryContainer,
    padding: Spacing.md,
    borderRadius: Radius.lg,
  },
  custodyText: { ...Typography.bodySm, color: Colors.teal, flex: 1 },
  breachBanner: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.errorContainer,
    padding: Spacing.md,
    borderRadius: Radius.lg,
  },
  breachText: { flex: 1, gap: 2 },
  breachTitle: { ...Typography.labelLg, color: Colors.error },
  breachMsg: { ...Typography.bodySm, color: Colors.error },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...shadow1,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  scanText: { ...Typography.labelMd, color: Colors.secondary },
  conditionRow: { flexDirection: 'row', gap: Spacing.md },
  conditionOpt: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  conditionOkActive: { borderColor: Colors.teal, backgroundColor: Colors.tertiaryContainer },
  conditionBreachActive: { borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  conditionLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});
