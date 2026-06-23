import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ClipboardList, FlaskConical, ChevronRight, Pill, RefreshCw, Share2, ShieldCheck, HeartPulse, Siren, FolderOpen, Users } from 'lucide-react-native';
import * as Icons from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import SectionHeader from '@/components/SectionHeader';
import { DoctorAvatar } from '@/features/telemedicine/components';
import { useRecordsDashboard } from '@/features/doctor/hooks';
import { StateView, StatCard, RecordCategoryRow } from '@/features/doctor/components';
import { RECORD_CATEGORY_LABELS } from '@/features/doctor/constants';
import type { RecordCategory, RecentPatientRecord } from '@/types/doctor.batch6';

// Maps the contract's RecordCategory icon hints to the lucide icons this app uses.
const CATEGORY_ICON: Record<RecordCategory, LucideIcon> = {
  consultations: Icons.Stethoscope,
  prescriptions: Icons.ClipboardList,
  lab_results:   Icons.FlaskConical,
  documents:     Icons.FileText,
  imaging:       Icons.ScanLine,
  allergies:     Icons.AlertTriangle,
  medications:   Icons.Pill,
  diagnoses:     Icons.Activity,
  care_plans:    Icons.ClipboardCheck,
  referrals:     Icons.Share2,
  hmo:           Icons.ShieldCheck,
  dependents:    Icons.Users,
  pets:          Icons.PawPrint,
};

export default function DoctorRecordsScreen() {
  const { data: dashboard, isLoading, isError, refetch } = useRecordsDashboard();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Records</Text>
      </View>

      {isLoading && !dashboard ? (
        <StateView variant="loading" label="Loading records" />
      ) : isError || !dashboard ? (
        <StateView variant="error" message="We could not load your records." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Summary tiles */}
          <View style={styles.statsRow}>
            <StatCard icon={Users} label="Patients" value={String(dashboard.totalPatients)} iconColor={Colors.primary} bgColor={Colors.iconBgPurple} />
            <StatCard icon={Share2} label="Pending shares" value={String(dashboard.pendingShares)} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} />
          </View>

          {/* Recent patients */}
          <SectionHeader title="Recent patients" style={styles.sectionGap} />
          {dashboard.recentPatients.length === 0 ? (
            <StateView variant="empty" icon={FolderOpen} title="No recent patients" message="Patients you treat will appear here." />
          ) : (
            <View style={styles.list}>
              {dashboard.recentPatients.map((p) => <RecentPatientCard key={p.patient.id} item={p} />)}
            </View>
          )}

          {/* Category counts → per-patient index (demo patient) */}
          <SectionHeader title="By category" style={styles.sectionGap} />
          {dashboard.categoryCounts.length === 0 ? (
            <StateView variant="empty" icon={FolderOpen} title="No records yet" message="Aggregate record counts will appear here." />
          ) : (
            <View style={styles.list}>
              {dashboard.categoryCounts.map((c) => (
                <RecordCategoryRow
                  key={c.category}
                  icon={CATEGORY_ICON[c.category]}
                  label={RECORD_CATEGORY_LABELS[c.category]}
                  count={c.count}
                  lastUpdated={c.lastUpdated}
                  onPress={dashboard.recentPatients[0]
                    ? () => router.push(`/(doctor)/records/${dashboard.recentPatients[0].patient.id}?category=${c.category}`)
                    : undefined}
                />
              ))}
            </View>
          )}

          {/* Care management hub (preserved from prior phase) */}
          <SectionHeader title="Care management" style={styles.sectionGap} />
          <View style={styles.list}>
            <HubLink icon={ClipboardList} label="Prescriptions" sub="View issued prescriptions" color={Colors.primary} bg={Colors.iconBgPurple} onPress={() => router.push('/(doctor)/prescriptions')} />
            <HubLink icon={FlaskConical} label="Lab results" sub="Review results inbox & critical alerts" color={Colors.teal} bg={Colors.iconBgTeal} onPress={() => router.push('/(doctor)/lab/inbox')} />
            <HubLink icon={Pill} label="Pharmacy requests" sub="Review substitutions & dispensing" color={Colors.primary} bg={Colors.iconBgPurple} onPress={() => router.push('/(doctor)/pharmacy')} />
            <HubLink icon={RefreshCw} label="Refill requests" sub="Approve or reject patient refills" color={Colors.secondary} bg={Colors.iconBgBlue} onPress={() => router.push('/(doctor)/refills')} />
            <HubLink icon={Share2} label="Specialist referrals" sub="Refer patients to specialists" color={Colors.teal} bg={Colors.iconBgTeal} onPress={() => router.push('/(doctor)/referrals')} />
            <HubLink icon={ShieldCheck} label="HMO claims" sub="Track and dispute claims" color={Colors.secondary} bg={Colors.iconBgBlue} onPress={() => router.push('/(doctor)/claims')} />
            <HubLink icon={HeartPulse} label="Care plans" sub="Long-term & chronic care monitoring" color={Colors.teal} bg={Colors.iconBgTeal} onPress={() => router.push('/(doctor)/care-plans')} />
            <HubLink icon={Icons.PawPrint} label="Pet health records" sub="Veterinary mode records" color={Colors.primary} bg={Colors.iconBgPurple} onPress={() => router.push('/(doctor)/vet')} />
            <HubLink icon={Siren} label="Emergency (demo)" sub="Red-flag alerts & escalation" color={Colors.error} bg={Colors.iconBgRed} onPress={() => router.push('/(doctor)/emergency')} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function RecentPatientCard({ item }: { item: RecentPatientRecord }) {
  const date = new Date(item.lastVisitAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  return (
    <Pressable
      style={[styles.patientCard, shadow1]}
      onPress={() => router.push(`/(doctor)/records/${item.patient.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Records for ${item.patient.name}`}
    >
      <DoctorAvatar initials={item.patient.initials} color={item.patient.avatarColor} size={44} />
      <View style={styles.patientBody}>
        <Text style={styles.patientName} numberOfLines={1}>{item.patient.name}</Text>
        <Text style={styles.patientMeta} numberOfLines={1}>
          {item.recordCount} records · last visit {date}{item.hasRestricted ? ' · restricted' : ''}
        </Text>
      </View>
      <ChevronRight size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

function HubLink({ icon: Icon, label, sub, color, bg, onPress }: { icon: LucideIcon; label: string; sub: string; color: string; bg: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.hubCard, shadow1]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.hubIcon, { backgroundColor: bg }]}>
        <Icon size={22} color={color} strokeWidth={2} />
      </View>
      <View style={styles.hubBody}>
        <Text style={styles.hubTitle}>{label}</Text>
        <Text style={styles.hubSub}>{sub}</Text>
      </View>
      <ChevronRight size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  header:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  title:       { ...Typography.headlineMd, color: Colors.onSurface },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Platform.OS === 'ios' ? 120 : 96 },
  statsRow:    { flexDirection: 'row', gap: Spacing.md },
  patientCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  patientBody: { flex: 1, gap: 2 },
  patientName: { ...Typography.titleMd, color: Colors.onSurface },
  patientMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  hubCard:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  hubIcon:     { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  hubBody:     { flex: 1, gap: 2 },
  hubTitle:    { ...Typography.titleMd, color: Colors.onSurface },
  hubSub:      { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  sectionGap:  { marginTop: Spacing.lg, paddingHorizontal: 0 },
  list:        { gap: Spacing.sm },
});
