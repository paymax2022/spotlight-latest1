import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowDown, ArrowUp, Minus, Sparkles, FlaskConical, AlertTriangle, FileText, X, Check } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, AlertCard } from '@/features/doctor/components';
import { usePetLabResult, useMarkPetLabResultReviewed, useAddPetLabInterpretation } from '@/features/doctor/hooks';
import { PET_SPECIES_LABELS } from '@/features/doctor/constants';
import type { PetLabResultValue } from '@/types/doctor.phase3';
import { alertAsync } from '@/lib/confirm';

const FLAG_CONFIG: Record<PetLabResultValue['flag'], { icon: LucideIcon; color: string; bg: string; label: string }> = {
  normal: { icon: Minus,    color: Colors.teal,      bg: Colors.iconBgTeal, label: 'Normal' },
  low:    { icon: ArrowDown, color: Colors.secondary, bg: Colors.iconBgBlue, label: 'Low' },
  high:   { icon: ArrowUp,   color: Colors.error,     bg: Colors.iconBgRed,  label: 'High' },
};

export default function PetLabResultScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { data: result, isLoading, isError, refetch } = usePetLabResult(String(orderId));
  const markReviewed = useMarkPetLabResultReviewed();
  const addInterpretation = useAddPetLabInterpretation();

  const [interpOpen, setInterpOpen] = useState(false);
  const [interpretation, setInterpretation] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [followUpNote, setFollowUpNote] = useState('');

  const hasAbnormal = !!result?.values.some((v) => v.flag !== 'normal');

  const handleReview = async () => {
    if (!result) return;
    try {
      await markReviewed.mutateAsync({ resultId: result.id });
      await alertAsync({ title: 'Marked as reviewed', message: 'This result has been marked as reviewed.' });
      goBack('/vet');
    } catch {
      alertAsync({ title: 'Failed', message: 'Please try again.' });
    }
  };

  const handleInterpret = async () => {
    if (!result) return;
    if (!interpretation.trim()) { alertAsync({ title: 'Add interpretation', message: 'Enter your interpretation of this result.' }); return; }
    try {
      await addInterpretation.mutateAsync({
        resultId: result.id,
        interpretation,
        followUpRecommended: followUp,
        followUpNote: followUp ? followUpNote : undefined,
      });
      setInterpOpen(false);
      alertAsync({ title: 'Interpretation saved', message: 'Your interpretation has been recorded.' });
    } catch { alertAsync({ title: 'Failed', message: 'Please try again.' }); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pet Lab Result" />

      {isLoading && !result ? (
        <StateView variant="loading" label="Loading result" />
      ) : isError ? (
        <StateView variant="error" message="We could not load this result." onRetry={() => refetch()} />
      ) : !result ? (
        <StateView variant="empty" icon={FlaskConical} title="No result yet" message="This order has not been resulted." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={styles.headIcon}>
              <FlaskConical size={26} color={Colors.teal} strokeWidth={2} />
            </View>
            <View style={styles.headerBody}>
              <Text style={styles.pet} numberOfLines={1}>{result.petName}</Text>
              <Text style={styles.ref}>{result.ref} - {PET_SPECIES_LABELS[result.petSpecies]}</Text>
            </View>
          </View>

          {/* U.9 — Pet abnormal result alert */}
          {hasAbnormal && (
            <View style={styles.alertWrap}>
              <AlertCard icon={AlertTriangle} tone="warning" title="Abnormal values detected" body="One or more results are outside the reference range. Review and add an interpretation." />
            </View>
          )}

          <SectionCard title="Report details" style={styles.card}>
            <InfoRow label="Lab" value={result.labName} />
            <InfoRow label="Reported" value={new Date(result.reportedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />
            <InfoRow label="Status" value={result.reviewed ? 'Reviewed' : 'Awaiting review'} valueColor={result.reviewed ? Colors.teal : Colors.secondary} />
          </SectionCard>

          <SectionCard title="Results" style={styles.card}>
            {result.values.map((v, i) => {
              const cfg = FLAG_CONFIG[v.flag];
              const Icon = cfg.icon;
              return (
                <View key={v.testName} style={[styles.valueRow, i > 0 && styles.rowBorder]}>
                  <View style={styles.valueBody}>
                    <Text style={styles.valueName}>{v.testName}</Text>
                    <Text style={styles.valueRange}>Ref: {v.refRange}</Text>
                  </View>
                  <View style={styles.valueRight}>
                    <Text style={styles.valueNum}>{v.value} <Text style={styles.valueUnit}>{v.unit}</Text></Text>
                    <View style={[styles.flag, { backgroundColor: cfg.bg }]}>
                      <Icon size={11} color={cfg.color} strokeWidth={2.5} />
                      <Text style={[styles.flagText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </SectionCard>

          <Pressable
            style={styles.aiBtn}
            onPress={() => router.push(`/(doctor)/ai/lab-explanation?resultId=${result.id}`)}
            accessibilityRole="button"
            accessibilityLabel="Explain with AI"
          >
            <Sparkles size={18} color={Colors.primary} strokeWidth={2.2} />
            <Text style={styles.aiText}>Explain with AI</Text>
          </Pressable>

          {/* U.10 — Add interpretation */}
          <Pressable style={styles.interpBtn} onPress={() => setInterpOpen(true)} accessibilityRole="button" accessibilityLabel="Add interpretation">
            <FileText size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.aiText}>Add interpretation</Text>
          </Pressable>

          {!result.reviewed && (
            <PrimaryButton label="Mark as reviewed" onPress={handleReview} loading={markReviewed.isPending} style={styles.btn} />
          )}
        </ScrollView>
      )}

      {/* U.10 / U.11 — interpretation + follow-up sheet */}
      <Modal visible={interpOpen} transparent animationType="slide" onRequestClose={() => setInterpOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setInterpOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Result interpretation</Text>
            <Pressable onPress={() => setInterpOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          <TextInput style={styles.input} placeholder="Interpret these results…" placeholderTextColor={Colors.outline} value={interpretation} onChangeText={setInterpretation} multiline />
          <Pressable style={styles.checkLine} onPress={() => setFollowUp((f) => !f)} accessibilityRole="checkbox" accessibilityState={{ checked: followUp }} accessibilityLabel="Recommend follow-up">
            <View style={[styles.checkbox, followUp && styles.checkboxOn]}>{followUp && <Check size={12} color={Colors.onPrimary} strokeWidth={3} />}</View>
            <Text style={styles.checkLineText}>Recommend follow-up</Text>
          </Pressable>
          {followUp && (
            <TextInput style={styles.input} placeholder="Follow-up note (optional)" placeholderTextColor={Colors.outline} value={followUpNote} onChangeText={setFollowUpNote} multiline />
          )}
          <PrimaryButton label="Save interpretation" onPress={handleInterpret} loading={addInterpretation.isPending} style={styles.btn} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  alertWrap:  { marginBottom: Spacing.md },
  header:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  headIcon:   { width: 56, height: 56, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgTeal },
  headerBody: { flex: 1, gap: 2 },
  pet:        { ...Typography.headlineMd, color: Colors.onSurface },
  ref:        { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card:       { marginBottom: Spacing.md },
  valueRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.sm },
  rowBorder:  { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  valueBody:  { flex: 1, gap: 2 },
  valueName:  { ...Typography.labelLg, color: Colors.onSurface },
  valueRange: { ...Typography.caption, color: Colors.onSurfaceVariant },
  valueRight: { alignItems: 'flex-end', gap: 4 },
  valueNum:   { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' },
  valueUnit:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  flag:       { flexDirection: 'row', alignItems: 'center', gap: 3, height: 22, paddingHorizontal: 8, borderRadius: Radius.full },
  flagText:   { ...Typography.labelSm, fontWeight: '700' },
  aiBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.primaryContainer, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.md },
  aiText:     { ...Typography.labelMd, color: Colors.primary },
  interpBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.md },
  btn:        { marginTop: Spacing.sm },
  backdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:      { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '85%' },
  sheetHandle:{ width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle: { ...Typography.titleMd, color: Colors.onSurface },
  input:      { minHeight: 80, borderRadius: Radius.lg, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLow, ...Typography.bodyMd, color: Colors.onSurface, marginTop: Spacing.sm, textAlignVertical: 'top' },
  checkLine:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, marginTop: Spacing.sm },
  checkLineText:{ ...Typography.bodyMd, color: Colors.onSurface },
  checkbox:   { width: 22, height: 22, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
});
