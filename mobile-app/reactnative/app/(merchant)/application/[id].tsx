import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Clock, CheckCircle2, XCircle, FileClock, AlertTriangle, FileText,
  CircleDashed, CircleCheck, CircleX,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { SectionCard, InfoRow } from '@/features/doctor/components';
import { useApplication } from '@/features/merchant/hooks/useMerchant';
import { __demoApprove } from '@/features/merchant/api/merchant.api';
import type { ApplicationStatus } from '@/types/merchant';

const HERO: Record<ApplicationStatus, { icon: LucideIcon; color: string; bg: string; title: string; sub: string }> = {
  DRAFT:           { icon: FileText,     color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerLow, title: 'Draft saved',     sub: 'Pick up where you left off to submit your application.' },
  SUBMITTED:       { icon: FileClock,    color: Colors.secondary,        bg: Colors.iconBgBlue,          title: 'Submitted',       sub: 'We have your application. Verification checks are queued.' },
  UNDER_REVIEW:    { icon: Clock,        color: Colors.secondary,        bg: Colors.iconBgBlue,          title: 'Under review',    sub: 'A reviewer is verifying your details. This usually takes 24–48 hours.' },
  NEEDS_MORE_INFO: { icon: AlertTriangle,color: Colors.secondary,        bg: Colors.iconBgBlue,          title: 'More info needed',sub: 'The reviewer needs a few more details before deciding.' },
  APPROVED:        { icon: CheckCircle2, color: Colors.teal,             bg: Colors.iconBgTeal,          title: 'Approved',        sub: 'Your provider capability is active. You can switch to it any time.' },
  REJECTED:        { icon: XCircle,      color: Colors.error,            bg: Colors.errorContainer,      title: 'Not approved',    sub: 'See the reason below. You can reapply with the latest requirements.' },
};

const CHECK_ICON = {
  pending: CircleDashed,
  passed:  CircleCheck,
  failed:  CircleX,
} as const;
const CHECK_COLOR = {
  pending: Colors.onSurfaceVariant,
  passed:  Colors.teal,
  failed:  Colors.error,
} as const;

// Screen: Application status (PRD §7.2). Renders every lifecycle state with the
// right hero, checks, reason/checklist and next action.
export default function ApplicationStatusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: app, isLoading, isError, refetch } = useApplication(id);

  const fmtDate = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Application status" onBack={() => router.replace('/(merchant)')} />

      {isLoading && !app ? (
        <StateView kind="loading" message="Loading your application" />
      ) : isError || !app ? (
        <StateView kind="error" title="Couldn't load application" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {(() => {
            const cfg = HERO[app.status];
            const Icon = cfg.icon;
            return (
              <View style={styles.hero}>
                <View style={[styles.heroIcon, { backgroundColor: cfg.bg }]}>
                  <Icon size={36} color={cfg.color} strokeWidth={2} />
                </View>
                <Text style={styles.heroTitle}>{cfg.title}</Text>
                <Text style={styles.heroSub}>{cfg.sub}</Text>
              </View>
            );
          })()}

          {!!app.decisionReason && (
            <SectionCard title="Reviewer note" style={styles.card}>
              <Text style={styles.reason}>{app.decisionReason}</Text>
            </SectionCard>
          )}

          {!!app.infoChecklist?.length && (
            <SectionCard title="What's needed" style={styles.card}>
              {app.infoChecklist.map((item) => (
                <View key={item} style={styles.checklistRow}>
                  <AlertTriangle size={16} color={Colors.secondary} strokeWidth={2} />
                  <Text style={styles.checklistText}>{item}</Text>
                </View>
              ))}
            </SectionCard>
          )}

          {app.checks.length > 0 && (
            <SectionCard title="Verification checks" style={styles.card}>
              {app.checks.map((c, i) => {
                const Icon = CHECK_ICON[c.status];
                return (
                  <View key={c.key} style={[styles.checkRow, i > 0 && styles.divider]}>
                    <Icon size={18} color={CHECK_COLOR[c.status]} strokeWidth={2} />
                    <View style={styles.checkBody}>
                      <Text style={styles.checkLabel}>{c.label}</Text>
                      {!!c.detail && <Text style={styles.checkDetail}>{c.detail}</Text>}
                    </View>
                    <Text style={[styles.checkStatus, { color: CHECK_COLOR[c.status] }]}>{c.status}</Text>
                  </View>
                );
              })}
            </SectionCard>
          )}

          <SectionCard title="Details" style={styles.card}>
            <InfoRow label="Provider type" value={app.merchantTypeName} />
            <InfoRow label="Module" value={app.moduleName} />
            <InfoRow label="Form version" value={`v${app.formSchemaVersion}`} />
            <InfoRow label="Submitted" value={fmtDate(app.submittedAt)} />
            {!!app.decidedAt && <InfoRow label="Decided" value={fmtDate(app.decidedAt)} />}
          </SectionCard>

          {/* Primary action by status */}
          {app.status === 'DRAFT' && (
            <PrimaryButton label="Resume application" onPress={() => router.replace(`/(merchant)/apply/${app.merchantTypeId}`)} style={styles.btn} />
          )}
          {app.status === 'NEEDS_MORE_INFO' && (
            <PrimaryButton label="Provide more info" onPress={() => router.replace(`/(merchant)/apply/${app.merchantTypeId}`)} style={styles.btn} />
          )}
          {app.status === 'REJECTED' && (
            <PrimaryButton label="Reapply" onPress={() => router.replace(`/(merchant)/apply/${app.merchantTypeId}`)} style={styles.btn} />
          )}
          {app.status === 'APPROVED' && (
            <PrimaryButton label="Go to my capabilities" onPress={() => router.replace('/(merchant)')} style={styles.btn} />
          )}
          {(app.status === 'SUBMITTED' || app.status === 'UNDER_REVIEW') && (
            <>
              <PrimaryButton label="Refresh status" variant="secondary" onPress={() => refetch()} style={styles.btn} />
              {__DEV__ && (
                <PrimaryButton
                  label="Simulate admin approval (demo)"
                  variant="ghost"
                  onPress={async () => { await __demoApprove(app.id); refetch(); }}
                />
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  content:       { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },
  hero:          { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  heroIcon:      { width: 80, height: 80, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle:     { ...Typography.headlineMd, color: Colors.onSurface },
  heroSub:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:          { marginBottom: Spacing.md },
  reason:        { ...Typography.bodyMd, color: Colors.onSurface },
  checklistRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  checklistText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  checkRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  divider:       { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  checkBody:     { flex: 1, gap: 2 },
  checkLabel:    { ...Typography.labelMd, color: Colors.onSurface },
  checkDetail:   { ...Typography.caption, color: Colors.onSurfaceVariant },
  checkStatus:   { ...Typography.labelSm, fontWeight: '700', textTransform: 'capitalize' },
  btn:           { marginTop: Spacing.sm },
});
