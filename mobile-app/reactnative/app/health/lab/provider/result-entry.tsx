import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Plus, X, TriangleAlert } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SegmentedControl from '@/components/SegmentedControl';

import { useEnterResult } from '@/features/health/lab/hooks';
import type { ResultEntryAnalyte, AnalyteFlag } from '@/features/health/lab/types';

const FLAG_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

function emptyAnalyte(id: string): ResultEntryAnalyte {
  return { id, name: '', value: '', unit: '', referenceRange: '', flag: 'normal' };
}

export default function LabProviderResultEntryScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const enterResult = useEnterResult();

  const [analytes, setAnalytes] = useState<ResultEntryAnalyte[]>([
    emptyAnalyte('a_1'),
    emptyAnalyte('a_2'),
    emptyAnalyte('a_3'),
  ]);
  const [interpretation, setInterpretation] = useState('');

  const update = (id: string, patch: Partial<ResultEntryAnalyte>) => {
    setAnalytes((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const addRow = () => {
    setAnalytes((prev) => [...prev, emptyAnalyte(`a_${Date.now()}`)]);
  };

  const removeRow = (id: string) => {
    setAnalytes((prev) => prev.filter((a) => a.id !== id));
  };

  const hasCritical = analytes.some((a) => a.flag === 'critical');
  const canSave = analytes.length > 0 && analytes.every((a) => a.name.trim() && a.value.trim());

  const onSave = async () => {
    const created = await enterResult.mutateAsync({
      orderId: orderId as string,
      analytes,
      interpretation: interpretation.trim() || undefined,
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Result entry" subtitle="Enter & validate" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {analytes.map((a, idx) => (
          <View key={a.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Analyte {idx + 1}</Text>
              <Pressable onPress={() => removeRow(a.id)} hitSlop={8}>
                <X size={18} color={Colors.onSurfaceVariant} />
              </Pressable>
            </View>
            <TextInputField
              label="Name"
              value={a.name}
              onChangeText={(t) => update(a.id, { name: t })}
              placeholder="e.g. Haemoglobin"
            />
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
              onChange={(v) => update(a.id, { flag: v as AnalyteFlag })}
              scrollable
            />
          </View>
        ))}

        <PrimaryButton label="+ Add analyte" variant="ghost" onPress={addRow} />

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
