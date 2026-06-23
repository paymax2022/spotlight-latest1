import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { FileText, FlaskConical, ClipboardList } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useReferral } from '@/features/doctor/hooks';
import { REFERRAL_STATUS_LABELS, REFERRAL_ATTACHMENT_KIND_LABELS } from '@/features/doctor/constants';
import type { ReferralStatus, ReferralAttachmentKind } from '@/types/doctor.phase2';

const STATUS_TONE: Record<ReferralStatus, StatusTone> = {
  draft:     'neutral',
  sent:      'info',
  accepted:  'brand',
  scheduled: 'warning',
  completed: 'success',
  declined:  'danger',
};

const ATTACHMENT_ICON: Record<ReferralAttachmentKind, LucideIcon> = {
  note:         FileText,
  lab:          FlaskConical,
  prescription: ClipboardList,
};

export default function ReferralDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: referral, isLoading, isError, refetch } = useReferral(String(id));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Referral" />

      {isLoading && !referral ? (
        <StateView variant="loading" label="Loading referral" />
      ) : isError || !referral ? (
        <StateView variant="error" message="We could not load this referral." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={[styles.icon, { backgroundColor: referral.specialist.avatarColor }]}>
              <Text style={styles.iconText}>{referral.specialist.initials}</Text>
            </View>
            <View style={styles.headerBody}>
              <Text style={styles.title} numberOfLines={1}>{referral.specialist.name}</Text>
              <Text style={styles.sub}>{referral.specialist.specialty}</Text>
            </View>
            <StatusBadge label={REFERRAL_STATUS_LABELS[referral.status]} tone={STATUS_TONE[referral.status]} />
          </View>

          <SectionCard title="Patient" style={styles.card}>
            <View style={styles.patientRow}>
              <DoctorAvatar initials={referral.patient.initials} color={referral.patient.avatarColor} size={40} />
              <View style={styles.patientBody}>
                <Text style={styles.patientName} numberOfLines={1}>{referral.patient.name}</Text>
                <Text style={styles.patientMeta}>{referral.patient.age} yrs · {referral.patient.gender}</Text>
              </View>
            </View>
          </SectionCard>

          <SectionCard title="Referral details" style={styles.card}>
            <InfoRow label="Reference" value={referral.ref} />
            <InfoRow label="Specialist" value={`${referral.specialist.name} · ${referral.specialist.hospital}`} />
            <InfoRow label="Urgency" value={referral.urgency === 'urgent' ? 'Urgent' : 'Routine'} valueColor={referral.urgency === 'urgent' ? Colors.error : Colors.onSurface} />
            <InfoRow label="Created" value={new Date(referral.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />
            {!!referral.scheduledAt && (
              <InfoRow label="Scheduled" value={new Date(referral.scheduledAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} valueColor={Colors.secondary} />
            )}
          </SectionCard>

          <SectionCard title="Reason" style={styles.card}>
            <Text style={styles.reason}>{referral.reason}</Text>
          </SectionCard>

          <SectionCard title="Attachments" style={styles.card}>
            {referral.attachments.length === 0 ? (
              <Text style={styles.muted}>No attachments included.</Text>
            ) : (
              referral.attachments.map((a, i) => {
                const Icon = ATTACHMENT_ICON[a.kind];
                return (
                  <View key={a.id} style={[styles.attachRow, i > 0 && styles.rowBorder]}>
                    <Icon size={16} color={Colors.primary} strokeWidth={2} />
                    <View style={styles.attachBody}>
                      <Text style={styles.attachLabel}>{a.label}</Text>
                      <Text style={styles.attachKind}>{REFERRAL_ATTACHMENT_KIND_LABELS[a.kind]}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </SectionCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  header:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  icon:        { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  iconText:    { ...Typography.titleMd, color: Colors.white, fontWeight: '800' },
  headerBody:  { flex: 1, gap: 2 },
  title:       { ...Typography.titleLg, color: Colors.onSurface },
  sub:         { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card:        { marginBottom: Spacing.md },
  patientRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  patientBody: { flex: 1, gap: 2 },
  patientName: { ...Typography.labelLg, color: Colors.onSurface },
  patientMeta: { ...Typography.caption, color: Colors.onSurfaceVariant, textTransform: 'capitalize' },
  reason:      { ...Typography.bodyMd, color: Colors.onSurface },
  muted:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  attachRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  rowBorder:   { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  attachBody:  { flex: 1, gap: 2 },
  attachLabel: { ...Typography.labelMd, color: Colors.onSurface },
  attachKind:  { ...Typography.caption, color: Colors.onSurfaceVariant },
});
