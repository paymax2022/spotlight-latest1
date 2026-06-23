import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, XCircle, Clock, AlertTriangle, ShieldAlert, MessageSquare } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { formatKobo } from '@/api/doctor.batch4.api';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge, AlertCard } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { usePreAuthRequest, useHmoFraudWarnings, useAcknowledgeFraudWarning } from '@/features/doctor/hooks';
import { PREAUTH_STATUS_LABELS, FRAUD_WARNING_SEVERITY_LABELS } from '@/features/doctor/constants';
import type { PreAuthStatus } from '@/types/doctor.batch4';

const toTone = (tone: string): StatusTone => (tone === 'muted' ? 'neutral' : (tone as StatusTone));

const STATUS_CFG: Record<PreAuthStatus, { icon: LucideIcon; color: string; bg: string }> = {
  pending:        { icon: Clock,         color: Colors.secondary, bg: Colors.iconBgBlue },
  approved:       { icon: CheckCircle2,  color: Colors.teal,      bg: Colors.iconBgTeal },
  rejected:       { icon: XCircle,       color: Colors.error,     bg: Colors.errorContainer },
  limit_exceeded: { icon: AlertTriangle, color: Colors.error,     bg: Colors.errorContainer },
};

// Section O (O7–O10, O19) — pre-auth detail: pending / approved / rejected /
// coverage-limit-exceeded are STATES of this one screen; HMO fraud warnings
// surface as acknowledgeable banners.
export default function PreAuthDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: pa, isLoading, isError, refetch } = usePreAuthRequest(String(id));
  const { data: fraudWarnings = [] } = useHmoFraudWarnings();
  const ack = useAcknowledgeFraudWarning();

  const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const related = pa ? fraudWarnings.filter((w) => !w.acknowledged && w.relatedRef === pa.ref) : [];

  const handleAck = async (warningId: string) => {
    try {
      await ack.mutateAsync({ warningId });
    } catch {
      Alert.alert('Failed', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pre-authorisation" />

      {isLoading && !pa ? (
        <StateView variant="loading" label="Loading request" />
      ) : isError || !pa ? (
        <StateView variant="error" message="We could not load this request." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {(() => {
            const cfg = STATUS_CFG[pa.status];
            const Icon = cfg.icon;
            const s = PREAUTH_STATUS_LABELS[pa.status];
            return (
              <View style={styles.hero}>
                <View style={[styles.heroIcon, { backgroundColor: cfg.bg }]}>
                  <Icon size={32} color={cfg.color} strokeWidth={2} />
                </View>
                <Text style={styles.heroTitle}>{pa.service}</Text>
                <StatusBadge label={s.label} tone={toTone(s.tone)} />
              </View>
            );
          })()}

          {/* O19 — HMO fraud warning banners */}
          {related.map((w) => {
            const sev = FRAUD_WARNING_SEVERITY_LABELS[w.severity];
            return (
              <View key={w.id} style={styles.banner}>
                <AlertCard
                  icon={ShieldAlert}
                  tone={w.severity === 'critical' ? 'critical' : w.severity === 'warning' ? 'warning' : 'info'}
                  title={`${sev.label}: ${w.title}`}
                  body={w.body}
                  ctaLabel={ack.isPending ? 'Acknowledging…' : 'Acknowledge'}
                  onPress={() => handleAck(w.id)}
                />
              </View>
            );
          })}

          {/* O10 — coverage-limit-exceeded banner */}
          {pa.status === 'limit_exceeded' && (
            <View style={styles.banner}>
              <AlertCard icon={AlertTriangle} tone="critical" title="Coverage limit exceeded" body={pa.rejectionReason ?? 'The annual coverage limit for this benefit has been exhausted.'} />
            </View>
          )}

          <SectionCard title="Patient" style={styles.card}>
            <View style={styles.patientRow}>
              <DoctorAvatar initials={pa.patient.initials} color={pa.patient.avatarColor} size={40} />
              <View style={styles.patientBody}>
                <Text style={styles.patientName} numberOfLines={1}>{pa.patient.name}</Text>
                <Text style={styles.patientMeta}>{pa.patient.age} yrs · {pa.patient.gender}</Text>
              </View>
            </View>
          </SectionCard>

          <SectionCard title="Request details" style={styles.card}>
            <InfoRow label="Reference" value={pa.ref} />
            <InfoRow label="Provider" value={pa.provider} />
            <InfoRow label="Plan" value={pa.planName} />
            <InfoRow label="Estimated cost" value={formatKobo(pa.estimatedKobo)} />
            <InfoRow label="Requested" value={fmtDate(pa.requestedAt)} />
            {!!pa.decidedAt && <InfoRow label="Decided" value={fmtDate(pa.decidedAt)} />}
            {/* O8 — approved auth code */}
            {pa.status === 'approved' && !!pa.authCode && <InfoRow label="Authorisation code" value={pa.authCode} valueColor={Colors.teal} />}
          </SectionCard>

          {!!pa.note && (
            <SectionCard title="Clinical justification" style={styles.card}>
              <Text style={styles.body}>{pa.note}</Text>
            </SectionCard>
          )}

          {/* O9 — rejection reason */}
          {pa.status === 'rejected' && !!pa.rejectionReason && (
            <SectionCard title="Rejection reason" style={styles.card}>
              <Text style={styles.rejection}>{pa.rejectionReason}</Text>
            </SectionCard>
          )}

          <Pressable style={styles.link} onPress={() => router.push('/(doctor)/hmo/support')} accessibilityRole="button" accessibilityLabel="Contact HMO support">
            <MessageSquare size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.linkText}>Query with HMO support</Text>
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
  heroIcon:    { width: 72, height: 72, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  heroTitle:   { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  banner:      { marginBottom: Spacing.md },
  card:        { marginBottom: Spacing.md },
  patientRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  patientBody: { flex: 1, gap: 2 },
  patientName: { ...Typography.labelLg, color: Colors.onSurface },
  patientMeta: { ...Typography.caption, color: Colors.onSurfaceVariant, textTransform: 'capitalize' },
  body:        { ...Typography.bodyMd, color: Colors.onSurface },
  rejection:   { ...Typography.bodyMd, color: Colors.error },
  link:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 52, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  linkText:    { ...Typography.labelMd, color: Colors.onSurface },
});
