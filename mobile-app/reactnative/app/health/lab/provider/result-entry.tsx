import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SegmentedControl from '@/components/SegmentedControl';

import { useOrder, useEnterResult } from '@/features/health/lab/hooks';
import type { ResultEntryAnalyte } from '@/features/health/lab/types';

const FLAG_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export default function LabProviderResultEntryScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const order = useOrder(orderId as string);
  const enterResult = useEnterResult();

  const [analytes, setAnalytes] = useState<ResultEntryAnalyte[] | null>(null);
  const [interpretation, setInterpretation] = useState('');
  const [scannedBarcode, setScannedBarcode] = useState('');

  // Result rows are the order's own ordered tests, not free-text entries — a
  // result can only bind to a test that was actually ordered (the real
  // backend rejects any test_id not on this order's lines). One row per line,
  // testId locked to the real catalog id (LabOrderLine.refId).
  useEffect(() => {
    if (order.data && analytes === null) {
      setAnalytes(
        order.data.lines.map((l) => ({
          id: l.refId, testId: l.refId, name: l.name, value: '', unit: '', referenceRange: '', flag: 'normal',
        })),
      );
    }
  }, [order.data, analytes]);

  const update = (id: string, patch: Partial<ResultEntryAnalyte>) => {
    setAnalytes((prev) => (prev ? prev.map((a) => (a.id === id ? { ...a, ...patch } : a)) : prev));
  };

  const rows = analytes ?? [];
  const hasCritical = rows.some((a) => a.flag === 'critical');
  const canSave = rows.length > 0 && rows.every((a) => a.value.trim());

  const onSave = async () => {
    const created = await enterResult.mutateAsync({
      orderId: orderId as string,
      analytes: rows,
      interpretation: interpretation.trim() || undefined,
      scannedBarcode: scannedBarcode.trim() || undefined,
    });
    router.push({
      pathname: '/health/lab/provider/result-release',
      params: {
        orderId: orderId as string,
        resultId: created.id,
        critical: created.hasCritical ? '1' : '0',
      },
    });
  };

  if (order.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Result entry" subtitle="Enter & validate" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  if (order.isError || !order.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Result entry" subtitle="Enter & validate" />
        <StateView kind="error" title="Couldn't load order" message="Please try again." actionLabel="Retry" onAction={() => order.refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Result entry" subtitle="Enter & validate" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sample verification</Text>
          <TextInputField
            label="Scanned barcode (optional)"
            value={scannedBarcode}
            onChangeText={setScannedBarcode}
            placeholder="Scan or enter the tube barcode"
          />
          <Text style={styles.note}>
            If entered, this must match the accessioned sample's barcode (LR-001) or result entry is rejected.
          </Text>
        </View>

        {rows.map((a) => (
          <View key={a.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{a.name}</Text>
            </View>
            <View style={styles.inlineRow}>
              <TextInputField
                label="Value"
                value={a.value}
                onChangeText={(t) => update(a.id, { value: t })}
                placeholder="13.5"
                style={styles.inlineField}
              />
              <TextInputField
                label="Unit"
                value={a.unit}
                onChangeText={(t) => update(a.id, { unit: t })}
                placeholder="g/dL"
                style={styles.inlineField}
              />
            </View>
            <TextInputField
              label="Reference range"
              value={a.referenceRange}
              onChangeText={(t) => update(a.id, { referenceRange: t })}
              placeholder="12.0 - 16.0"
            />
            <Text style={styles.flagLabel}>Flag</Text>
            <SegmentedControl
              options={FLAG_OPTIONS}
              value={a.flag}
              onChange={(v) => update(a.id, { flag: v as ResultEntryAnalyte['flag'] })}
              scrollable
            />
          </View>
        ))}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Interpretation (optional)</Text>
          <TextInputField
            value={interpretation}
            onChangeText={setInterpretation}
            placeholder="Clinical interpretation or comments"
            multiline
          />
        </View>

        {hasCritical ? (
          <View style={styles.criticalNotice}>
            <TriangleAlert size={20} color={Colors.error} />
            <Text style={styles.criticalText}>
              A critical value has been entered. Releasing this result will trigger the HL-7 escalation
              pathway to notify a clinician and the patient.
            </Text>
          </View>
        ) : null}

        <PrimaryButton
          label="Save & continue to release"
          onPress={onSave}
          loading={enterResult.isPending}
          disabled={!canSave}
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  inlineRow: { flexDirection: 'row', gap: Spacing.md },
  inlineField: { flex: 1 },
  flagLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  criticalNotice: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.errorContainer,
    padding: Spacing.md,
    borderRadius: Radius.lg,
  },
  criticalText: { ...Typography.bodySm, color: Colors.error, flex: 1 },
});
