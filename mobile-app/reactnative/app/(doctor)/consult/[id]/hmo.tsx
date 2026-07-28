import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, ShieldX, ShieldQuestion, Check, Pill, FlaskConical, Stethoscope, FileCheck, MessageSquare, ChevronRight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { formatKobo } from '@/api/doctor.api';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useHmoEligibility, useCoveredServices } from '@/features/doctor/hooks';
import { COVERED_STATUS_LABELS, COVERED_SERVICE_KIND_LABELS } from '@/features/doctor/constants';
import type { EligibilityStatus } from '@/types/doctor';
import type { CoveredServiceKind } from '@/types/doctor.batch4';

const STATUS_CONFIG: Record<EligibilityStatus, { icon: LucideIcon; color: string; bg: string; title: string }> = {
  eligible:   { icon: ShieldCheck,    color: Colors.teal,      bg: Colors.iconBgTeal, title: 'Eligible' },
  ineligible: { icon: ShieldX,        color: Colors.error,     bg: Colors.errorContainer, title: 'Not eligible' },
  pending:    { icon: ShieldQuestion, color: Colors.secondary, bg: Colors.iconBgBlue, title: 'Pending verification' },
};

// Section O — covered service kind icons (O4 consultation / O11 rx / O12 lab).
const COVERED_ICON: Record<CoveredServiceKind, LucideIcon> = {
  consultation: Stethoscope,
  prescription: Pill,
  lab:          FlaskConical,
};

const toTone = (tone: string): StatusTone => (tone === 'muted' ? 'neutral' : (tone as StatusTone));

export default function HmoEligibilityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: eligibility, isLoading, isError, refetch } = useHmoEligibility(String(id));
  // O1 / O4 / O11 / O12 — covered consult / rx / lab status for this encounter.
  const { data: coveredServices = [] } = useCoveredServices(String(id));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="HMO Eligibility" />

      {isLoading && !eligibility ? (
        <StateView variant="loading" label="Checking eligibility" />
      ) : isError || !eligibility ? (
        <StateView variant="error" message="We could not check HMO eligibility." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {(() => {
            const cfg = STATUS_CONFIG[eligibility.status];
            const Icon = cfg.icon;
            return (
              <View style={styles.hero}>
                <View style={[styles.heroIcon, { backgroundColor: cfg.bg }]}>
                  <Icon size={36} color={cfg.color} strokeWidth={2} />
                </View>
                <Text style={styles.heroTitle}>{cfg.title}</Text>
                <View style={styles.patientRow}>
                  <DoctorAvatar initials={eligibility.patient.initials} color={eligibility.patient.avatarColor} size={28} />
                  <Text style={styles.patientName}>{eligibility.patient.name}</Text>
                </View>
              </View>
            );
          })()}

          <SectionCard title="Cost breakdown" style={styles.card}>
            <InfoRow label="Patient co-pay" value={formatKobo(eligibility.copayKobo)} />
            {!!eligibility.authCode && <InfoRow label="Authorisation code" value={eligibility.authCode} valueColor={Colors.secondary} />}
            <InfoRow label="Checked" value={new Date(eligibility.checkedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} />
          </SectionCard>

          {eligibility.coverage && (
            <SectionCard title="Coverage" style={styles.card}>
              <InfoRow label="Provider" value={eligibility.coverage.provider} />
              <InfoRow label="Plan" value={eligibility.coverage.planName} />
              <InfoRow label="Member ID" value={eligibility.coverage.memberId} />
              <InfoRow label="Valid until" value={new Date(`${eligibility.coverage.validUntil}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />
              <Text style={styles.servicesTitle}>Covered services</Text>
              {eligibility.coverage.coveredServices.map((s) => (
                <View key={s} style={styles.serviceRow}>
                  <Check size={16} color={Colors.teal} strokeWidth={2.5} />
                  <Text style={styles.serviceText}>{s}</Text>
                </View>
              ))}
            </SectionCard>
          )}

          {/* O4 / O11 / O12 — covered service status (consultation / rx / lab) */}
          {coveredServices.length > 0 && (
            <SectionCard title="Covered services" style={styles.card}>
              {coveredServices.map((cs, i) => {
                const Icon = COVERED_ICON[cs.kind];
                const s = COVERED_STATUS_LABELS[cs.status];
                return (
                  <View key={cs.id} style={[styles.coveredRow, i > 0 && styles.coveredBorder]}>
                    <Icon size={16} color={Colors.secondary} strokeWidth={2} />
                    <View style={styles.coveredBody}>
                      <View style={styles.coveredHead}>
                        <Text style={styles.coveredDesc} numberOfLines={1}>{cs.description}</Text>
                        <StatusBadge label={s.label} tone={toTone(s.tone)} />
                      </View>
                      <Text style={styles.coveredMeta} numberOfLines={1}>{COVERED_SERVICE_KIND_LABELS[cs.kind]} · {cs.refLabel}</Text>
                      <Text style={styles.coveredMeta} numberOfLines={1}>HMO {formatKobo(cs.coveredKobo)} · Patient {formatKobo(cs.patientKobo)}</Text>
                      {!!cs.note && <Text style={styles.coveredNote}>{cs.note}</Text>}
                    </View>
                  </View>
                );
              })}
            </SectionCard>
          )}

          {/* Links to the new Section O screens */}
          <Pressable style={styles.link} onPress={() => router.push(`/(doctor)/hmo/plan-coverage?patientId=${eligibility.patient.id}`)} accessibilityRole="button" accessibilityLabel="Plan coverage summary">
            <ShieldCheck size={18} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.linkText}>Plan coverage summary</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>
          <Pressable style={styles.link} onPress={() => router.push('/(doctor)/hmo/pre-auth')} accessibilityRole="button" accessibilityLabel="Pre-authorisation">
            <FileCheck size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.linkText}>Pre-authorisation requests</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>
          <Pressable style={styles.link} onPress={() => router.push('/(doctor)/hmo/support')} accessibilityRole="button" accessibilityLabel="HMO support">
            <MessageSquare size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.linkText}>Contact HMO support</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  content:       { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  hero:          { alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg },
  heroIcon:      { width: 80, height: 80, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  heroTitle:     { ...Typography.headlineMd, color: Colors.onSurface },
  patientRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  patientName:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card:          { marginBottom: Spacing.md },
  servicesTitle: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm, marginBottom: Spacing.xs },
  serviceRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  serviceText:   { ...Typography.bodyMd, color: Colors.onSurface },
  coveredRow:    { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  coveredBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  coveredBody:   { flex: 1, gap: 2 },
  coveredHead:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  coveredDesc:   { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  coveredMeta:   { ...Typography.caption, color: Colors.onSurfaceVariant },
  coveredNote:   { ...Typography.caption, color: Colors.secondary },
  link:          { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 52, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  linkText:      { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
});
