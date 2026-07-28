import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, Check, X, FileCheck, MessageSquare } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { formatKobo } from '@/api/doctor.batch4.api';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, CoverageBar, AlertCard } from '@/features/doctor/components';
import { useHmoPlanCoverage } from '@/features/doctor/hooks';

// Section O (O3, O5) — NEW screen: plan coverage summary (benefits / limits /
// co-pay). REUSES the consult HMO eligibility flow; this adds the plan-level
// benefit lines + annual cap bar + co-pay notice banner.
export default function HmoPlanCoverageScreen() {
  const { patientId } = useLocalSearchParams<{ patientId?: string }>();
  const id = patientId ? String(patientId) : 'pat-2';
  const { data: plan, isLoading, isError, refetch } = useHmoPlanCoverage(id);

  const fmtDate = (iso: string) => new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Plan Coverage" />

      {isLoading && !plan ? (
        <StateView variant="loading" label="Loading plan coverage" />
      ) : isError || !plan ? (
        <StateView variant="error" message="We could not load this plan." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <ShieldCheck size={32} color={Colors.teal} strokeWidth={2} />
            </View>
            <Text style={styles.heroTitle}>{plan.planName}</Text>
            <View style={styles.patientRow}>
              <DoctorAvatar initials={plan.patient.initials} color={plan.patient.avatarColor} size={28} />
              <Text style={styles.patientName}>{plan.patient.name}</Text>
            </View>
          </View>

          {/* O5 — co-pay notice banner */}
          {(plan.coPayKobo > 0 || (plan.coPayPct ?? 0) > 0) && (
            <View style={styles.banner}>
              <AlertCard
                icon={ShieldCheck}
                tone="info"
                title="Co-payment applies"
                body={`Patient pays ${plan.coPayKobo > 0 ? formatKobo(plan.coPayKobo) : ''}${plan.coPayKobo > 0 && (plan.coPayPct ?? 0) > 0 ? ' + ' : ''}${(plan.coPayPct ?? 0) > 0 ? `${plan.coPayPct}%` : ''} per eligible encounter.`}
              />
            </View>
          )}

          <SectionCard title="Plan details" style={styles.card}>
            <InfoRow label="Provider" value={plan.provider} />
            <InfoRow label="Member ID" value={plan.memberId} />
            <InfoRow label="Co-pay" value={plan.coPayKobo > 0 ? formatKobo(plan.coPayKobo) : 'None'} />
            <InfoRow label="Valid" value={`${fmtDate(plan.validFrom)} – ${fmtDate(plan.validTo)}`} />
          </SectionCard>

          <SectionCard title="Annual cover" style={styles.card}>
            <CoverageBar label="Annual limit" usedKobo={plan.annualUsedKobo} capKobo={plan.annualLimitKobo} format={formatKobo} />
          </SectionCard>

          <SectionCard title="Benefits" style={styles.card}>
            {plan.benefits.length === 0 ? (
              <Text style={styles.muted}>No benefit lines on this plan.</Text>
            ) : (
              plan.benefits.map((b, i) => (
                <View key={b.id} style={[styles.benefit, i > 0 && styles.rowBorder]}>
                  <View style={styles.benefitHead}>
                    {b.covered
                      ? <Check size={16} color={Colors.teal} strokeWidth={2.5} />
                      : <X size={16} color={Colors.error} strokeWidth={2.5} />}
                    <Text style={styles.benefitName} numberOfLines={1}>{b.service}</Text>
                  </View>
                  {typeof b.limitKobo === 'number' && b.limitKobo > 0 && (
                    <CoverageBar label="Limit used" usedKobo={b.usedKobo ?? 0} capKobo={b.limitKobo} format={formatKobo} note={b.note} />
                  )}
                  {(!b.limitKobo || b.limitKobo === 0) && !!b.note && <Text style={styles.benefitNote}>{b.note}</Text>}
                </View>
              ))
            )}
          </SectionCard>

          <Pressable style={styles.link} onPress={() => router.push('/(doctor)/hmo/pre-auth')} accessibilityRole="button" accessibilityLabel="Pre-authorisation requests">
            <FileCheck size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.linkText}>Pre-authorisation requests</Text>
          </Pressable>
          <Pressable style={styles.link} onPress={() => router.push('/(doctor)/hmo/support')} accessibilityRole="button" accessibilityLabel="HMO support">
            <MessageSquare size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.linkText}>Contact HMO support</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  hero:        { alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg },
  heroIcon:    { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  heroTitle:   { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  patientRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  patientName: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  banner:      { marginBottom: Spacing.md },
  card:        { marginBottom: Spacing.md },
  muted:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  benefit:     { paddingVertical: Spacing.sm, gap: Spacing.xs },
  rowBorder:   { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  benefitHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  benefitName: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  benefitNote: { ...Typography.caption, color: Colors.onSurfaceVariant, marginLeft: 24 },
  link:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 52, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  linkText:    { ...Typography.labelMd, color: Colors.onSurface },
});
