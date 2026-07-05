import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollText, FlaskConical, CalendarPlus, Star, ChevronRight, ClipboardCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useConsultSummary } from '@/features/health/vet/hooks';
import { formatDate } from '@/features/health/constants/health.constants';

const SOAP_LABELS: { key: 'subjective' | 'objective' | 'assessment' | 'plan'; label: string }[] = [
  { key: 'subjective', label: 'Subjective' },
  { key: 'objective', label: 'Objective' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'plan', label: 'Plan' },
];

export default function ConsultSummaryScreen() {
  const { id, appointmentId } = useLocalSearchParams<{ id: string; appointmentId?: string }>();
  const { data: summary, isLoading, isError, refetch } = useConsultSummary(id);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Consult summary" />
        <StateView kind="loading" message="Loading summary…" />
      </SafeAreaView>
    );
  }
  if (isError || !summary) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Consult summary" />
        <StateView kind="error" title="Couldn't load the summary" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Consult summary" subtitle={`${summary.vetName} · ${formatDate(summary.completedAt)}`} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.doneCard}>
          <View style={styles.doneIcon}>
            <ClipboardCheck size={22} color={Colors.teal} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.doneTitle}>Consult completed</Text>
            <Text style={styles.doneSub}>Summary for {summary.petName}</Text>
          </View>
        </View>

        {/* Diagnosis */}
        <View style={[styles.card, shadow1]}>
          <Text style={styles.diagLabel}>Diagnosis</Text>
          <Text style={styles.diag}>{summary.diagnosis}</Text>
        </View>

        {/* SOAP */}
        <Text style={styles.sectionTitle}>Clinical notes (SOAP)</Text>
        <View style={[styles.card, shadow1]}>
          {SOAP_LABELS.map((s) => (
            <View key={s.key} style={styles.soapRow}>
              <Text style={styles.soapLabel}>{s.label}</Text>
              <Text style={styles.soapText}>{summary.soap[s.key]}</Text>
            </View>
          ))}
        </View>

        {/* Care handoffs */}
        {summary.prescriptionId ? (
          <Pressable
            style={[styles.handoff, shadow1]}
            onPress={() => router.push({ pathname: '/health/vet/eprescription/[id]', params: { id: summary.prescriptionId! } })}
          >
            <View style={[styles.handoffIcon, { backgroundColor: Colors.iconBgBlue }]}>
              <ScrollText size={18} color={Colors.secondary} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.handoffTitle}>e-Prescription issued</Text>
              <Text style={styles.handoffSub}>View and send to a pharmacy</Text>
            </View>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        ) : null}

        <Pressable
          style={[styles.handoff, shadow1]}
          onPress={() => router.push({ pathname: '/health/vet/order-lab', params: { petId: summary.petId, appointmentId: summary.appointmentId } })}
        >
          <View style={[styles.handoffIcon, { backgroundColor: Colors.iconBgTeal }]}>
            <FlaskConical size={18} color={Colors.teal} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.handoffTitle}>Order a pet lab test</Text>
            <Text style={styles.handoffSub}>Hand off to the lab vertical</Text>
          </View>
          <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
        </Pressable>

        {summary.followUpRecommended ? (
          <Pressable
            style={[styles.handoff, shadow1]}
            onPress={() => router.push({ pathname: '/health/vet/follow-up', params: { vetId: summary.vetId, petId: summary.petId } })}
          >
            <View style={[styles.handoffIcon, { backgroundColor: Colors.iconBgPurple }]}>
              <CalendarPlus size={18} color={Colors.primary} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.handoffTitle}>Book a follow-up</Text>
              <Text style={styles.handoffSub}>{summary.followUpNote ?? 'Recommended by your vet'}</Text>
            </View>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label="Rate this consult"
          variant="secondary"
          onPress={() => router.push({ pathname: '/health/vet/ratings', params: { vetId: summary.vetId, appointmentId: summary.appointmentId } })}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  doneCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md },
  doneIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { ...Typography.titleMd, fontSize: 16, color: Colors.tertiaryContainer },
  doneSub: { ...Typography.bodySm, color: Colors.tertiaryContainer },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  diagLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.4 },
  diag: { ...Typography.titleMd, color: Colors.onSurface },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  soapRow: { gap: 2 },
  soapLabel: { ...Typography.labelMd, color: Colors.secondary },
  soapText: { ...Typography.bodySm, color: Colors.onSurface, lineHeight: 20 },
  handoff: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  handoffIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  handoffTitle: { ...Typography.titleMd, fontSize: 15, color: Colors.onSurface },
  handoffSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
