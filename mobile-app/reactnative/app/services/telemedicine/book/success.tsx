import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { CheckCircle2, CalendarPlus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import { useApptIntake } from '@/features/health/hooks';

export default function BookingSuccessScreen() {
  const params = useLocalSearchParams<{
    ref: string; appointmentId: string; doctorName: string; slotDate: string; slotTime: string; consultType: string; reason: string;
  }>();

  // Intake is normally completed BEFORE booking (pre-visit triage) and submitted
  // to this appointment at payment, so we lead with "Join". If it isn't submitted
  // yet (e.g. a flow that skipped the triage), we prompt to add it instead.
  const intakeQ = useApptIntake(String(params.appointmentId));
  const intakeReady = intakeQ.data?.intake.status === 'SUBMITTED';

  const dateLabel = params.slotDate
    ? new Date(`${params.slotDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : '—';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <LinearGradient
          colors={[Colors.primary, Colors.primaryContainer]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.checkCircle}>
            <CheckCircle2 size={48} color={Colors.white} strokeWidth={2} />
          </View>
          <Text style={styles.heroTitle}>Appointment booked!</Text>
          <Text style={styles.heroSub}>Your consultation with {params.doctorName} is confirmed.</Text>
          <View style={styles.refPill}>
            <Text style={styles.refText}>Ref: {params.ref}</Text>
          </View>
        </LinearGradient>

        <View style={[styles.card, shadow1]}>
          <Detail label="Doctor" value={String(params.doctorName)} />
          <Detail label="Date" value={dateLabel} />
          <Detail label="Time" value={String(params.slotTime)} />
          <Detail label="Type" value={titleCase(String(params.consultType))} last />
        </View>

        <View style={styles.tipCard}>
          <CalendarPlus size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.tipText}>
            {intakeReady
              ? `Your pre-visit health check is saved and ready for ${params.doctorName || 'your doctor'}. We'll remind you before the appointment.`
              : `Next: add your health details so ${params.doctorName || 'your doctor'} can prepare. Your consultation can't start until your intake is submitted.`}
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {intakeReady ? (
          <PrimaryButton
            label="Join consultation"
            onPress={() => router.replace(`/services/telemedicine/consult/${params.appointmentId}`)}
          />
        ) : (
          <PrimaryButton
            label="Add your health details"
            onPress={() =>
              router.replace({
                pathname: '/services/telemedicine/appointment/[id]/intake',
                params: { id: String(params.appointmentId), reason: String(params.reason ?? '') },
              })
            }
          />
        )}
        <PrimaryButton
          label="View appointment"
          variant="ghost"
          onPress={() => router.replace(`/services/telemedicine/appointment/${params.appointmentId}`)}
        />
      </View>
    </SafeAreaView>
  );
}

function Detail({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.detailRow, !last && styles.detailBorder]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { padding: Spacing.containerMargin, paddingBottom: 40 },
  hero:        { borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg },
  checkCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  heroTitle:   { ...Typography.headlineMd, color: Colors.onPrimary, textAlign: 'center' },
  heroSub:     { ...Typography.bodyMd, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  refPill:     { marginTop: Spacing.sm, paddingHorizontal: Spacing.md, height: 34, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  refText:     { ...Typography.labelMd, color: Colors.white },
  card:        { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, paddingHorizontal: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  detailRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.md, gap: Spacing.md },
  detailBorder:{ borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  detailLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  detailValue: { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  tipCard:     { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderLeftWidth: 3, borderLeftColor: Colors.secondary },
  tipText:     { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 20 },
  footer:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 16 : Spacing.md, gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
