import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Activity, Plus, X, TrendingUp, TrendingDown, Minus } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, StatusBadge } from '@/features/doctor/components';
import { usePetChronicMonitoring, useSavePetChronicMonitoring } from '@/features/doctor/hooks';
import { PET_CHRONIC_TREND_LABELS } from '@/features/doctor/constants';
import type { StatusTone } from '@/features/doctor/components';
import type { PetChronicTrend } from '@/types/doctor.batch5';

const TREND_TONE: Record<PetChronicTrend, StatusTone> = {
  improving: 'success', stable: 'info', worsening: 'danger',
};
const TREND_ICON: Record<PetChronicTrend, LucideIcon> = {
  improving: TrendingUp, stable: Minus, worsening: TrendingDown,
};
const TREND_OPTIONS: PetChronicTrend[] = ['improving', 'stable', 'worsening'];

export default function PetChronicScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const petId = String(id);

  const { data: entries = [], isLoading, isError, refetch } = usePetChronicMonitoring(petId);
  const saveEntry = useSavePetChronicMonitoring();

  const [open, setOpen] = useState(false);
  const [condition, setCondition] = useState('');
  const [metricLabel, setMetricLabel] = useState('');
  const [value, setValue] = useState('');
  const [trend, setTrend] = useState<PetChronicTrend>('stable');
  const [note, setNote] = useState('');

  const save = async () => {
    if (!condition.trim() || !metricLabel.trim() || !value.trim()) {
      Alert.alert('Incomplete', 'Add a condition, metric and value.');
      return;
    }
    try {
      await saveEntry.mutateAsync({ petId, condition, metricLabel, value, trend, note: note || undefined });
      setOpen(false); setCondition(''); setMetricLabel(''); setValue(''); setNote(''); setTrend('stable');
      Alert.alert('Saved', 'The monitoring entry has been recorded.');
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Chronic Monitoring" />

      {isLoading && entries.length === 0 ? (
        <StateView variant="loading" label="Loading monitoring" />
      ) : isError ? (
        <StateView variant="error" message="We could not load chronic monitoring." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {entries.length === 0 ? (
            <StateView variant="empty" icon={Activity} title="No monitoring entries" message="Record a metric to start tracking a chronic condition." />
          ) : (
            <View style={styles.list}>
              {entries.map((e) => {
                const Icon = TREND_ICON[e.trend];
                return (
                  <SectionCard key={e.id} style={styles.card}>
                    <View style={styles.head}>
                      <View style={styles.headBody}>
                        <Text style={styles.condition}>{e.condition}</Text>
                        <Text style={styles.metric}>{e.metricLabel}: {e.value}</Text>
                      </View>
                      <View style={styles.trendChip}>
                        <Icon size={13} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
                        <StatusBadge label={PET_CHRONIC_TREND_LABELS[e.trend]} tone={TREND_TONE[e.trend]} />
                      </View>
                    </View>
                    <Text style={styles.recorded}>{new Date(e.recordedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}{e.note ? ` - ${e.note}` : ''}</Text>
                  </SectionCard>
                );
              })}
            </View>
          )}

          <Pressable style={styles.addBtn} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Record monitoring entry">
            <Plus size={18} color={Colors.primary} strokeWidth={2.4} />
            <Text style={styles.addText}>Record entry</Text>
          </Pressable>
        </ScrollView>
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Record entry</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.fieldLabel}>Condition</Text>
            <TextInput style={styles.input} placeholder="e.g. Diabetes mellitus" placeholderTextColor={Colors.outline} value={condition} onChangeText={setCondition} />
            <Text style={styles.fieldLabel}>Metric</Text>
            <TextInput style={styles.input} placeholder="e.g. Blood glucose" placeholderTextColor={Colors.outline} value={metricLabel} onChangeText={setMetricLabel} />
            <Text style={styles.fieldLabel}>Value</Text>
            <TextInput style={styles.input} placeholder="e.g. 6.8 mmol/L" placeholderTextColor={Colors.outline} value={value} onChangeText={setValue} />
            <SelectField
              label="Trend"
              value={PET_CHRONIC_TREND_LABELS[trend]}
              options={TREND_OPTIONS.map((t) => PET_CHRONIC_TREND_LABELS[t])}
              onChange={(label) => setTrend(TREND_OPTIONS.find((t) => PET_CHRONIC_TREND_LABELS[t] === label) ?? 'stable')}
              searchable={false}
            />
            <Text style={styles.fieldLabel}>Note (optional)</Text>
            <TextInput style={styles.input} placeholder="Context…" placeholderTextColor={Colors.outline} value={note} onChangeText={setNote} />
            <PrimaryButton label="Save entry" onPress={save} loading={saveEntry.isPending} style={styles.btn} />
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  list:        { gap: Spacing.md },
  card:        { marginBottom: 0 },
  head:        { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.sm },
  headBody:    { flex: 1, gap: 2 },
  condition:   { ...Typography.labelLg, color: Colors.onSurface },
  metric:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  trendChip:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  recorded:    { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  addBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary, backgroundColor: Colors.primaryFixed, marginTop: Spacing.md },
  addText:     { ...Typography.labelMd, color: Colors.primary },
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '85%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  fieldLabel:  { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm, marginBottom: Spacing.xs },
  input:       { height: 48, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, backgroundColor: Colors.surfaceContainerLow, ...Typography.bodyMd, color: Colors.onSurface },
  btn:         { marginTop: Spacing.md },
});
