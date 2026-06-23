import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, AlertTriangle, Info, ShieldAlert, FileCheck2, Activity } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import ProfileMenuItem from '@/components/ProfileMenuItem';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useComplianceDashboard, useAcknowledgePolicy } from '@/features/doctor/hooks';
import { LICENCE_STATUS_LABELS, ALERT_SEVERITY_LABELS } from '@/features/doctor/constants';
import type { LicenceStatus, ComplianceAlert, ConsentRecord, PolicyAcknowledgement } from '@/types/doctor.phase2';

const LICENCE_TONE: Record<LicenceStatus, StatusTone> = {
  valid:         'success',
  expiring_soon: 'warning',
  expired:       'danger',
  suspended:     'danger',
};

const SEVERITY: Record<ComplianceAlert['severity'], { tone: StatusTone; icon: LucideIcon; color: string; bg: string }> = {
  info:     { tone: 'info',    icon: Info,        color: Colors.secondary, bg: Colors.iconBgBlue },
  warning:  { tone: 'warning', icon: AlertTriangle, color: Colors.secondary, bg: Colors.iconBgBlue },
  critical: { tone: 'danger',  icon: ShieldAlert, color: Colors.error,     bg: Colors.errorContainer },
};

export default function ComplianceScreen() {
  const { data: dashboard, isLoading, isError, refetch } = useComplianceDashboard();
  const acknowledge = useAcknowledgePolicy();

  const handleAcknowledge = (policy: PolicyAcknowledgement) => {
    Alert.alert('Acknowledge policy', `${policy.title} (${policy.version})`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Acknowledge',
        onPress: async () => {
          try {
            await acknowledge.mutateAsync({ policyKey: policy.policyKey, version: policy.version });
          } catch {
            Alert.alert('Failed', 'Please try again.');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Compliance" />

      {isLoading && !dashboard ? (
        <StateView variant="loading" label="Loading compliance" />
      ) : isError || !dashboard ? (
        <StateView variant="error" message="We could not load your compliance dashboard." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <SectionCard style={styles.card}>
            <View style={styles.licenceHeader}>
              <View style={styles.licenceIcon}>
                <ShieldCheck size={22} color={Colors.primary} strokeWidth={2} />
              </View>
              <View style={styles.licenceBody}>
                <Text style={styles.licenceTitle}>Medical licence</Text>
                <Text style={styles.licenceNum}>{dashboard.licence.mdcnNumber}</Text>
              </View>
              <StatusBadge label={LICENCE_STATUS_LABELS[dashboard.licence.status]} tone={LICENCE_TONE[dashboard.licence.status]} />
            </View>
            <InfoRow label="Issued" value={new Date(`${dashboard.licence.issuedAt}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />
            <InfoRow label="Expires" value={new Date(`${dashboard.licence.expiresAt}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />
            <InfoRow label="Days to expiry" value={String(dashboard.licence.daysToExpiry)} valueColor={dashboard.licence.daysToExpiry < 60 ? Colors.error : Colors.onSurface} />
          </SectionCard>

          <SectionCard title="Alerts" style={styles.card}>
            {dashboard.alerts.length === 0 ? (
              <Text style={styles.muted}>No active alerts.</Text>
            ) : (
              dashboard.alerts.map((a, i) => {
                const cfg = SEVERITY[a.severity];
                const Icon = cfg.icon;
                return (
                  <View key={a.id} style={[styles.alertRow, i > 0 && styles.rowBorder]}>
                    <View style={[styles.alertIcon, { backgroundColor: cfg.bg }]}>
                      <Icon size={18} color={cfg.color} strokeWidth={2} />
                    </View>
                    <View style={styles.alertBody}>
                      <View style={styles.alertTop}>
                        <Text style={styles.alertTitle} numberOfLines={1}>{a.title}</Text>
                        <StatusBadge label={a.resolved ? 'Resolved' : ALERT_SEVERITY_LABELS[a.severity]} tone={a.resolved ? 'success' : cfg.tone} />
                      </View>
                      <Text style={styles.alertText}>{a.body}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </SectionCard>

          <SectionCard title="Policy acknowledgements" style={styles.card}>
            {dashboard.acknowledgements.length === 0 ? (
              <Text style={styles.muted}>No policies to acknowledge.</Text>
            ) : (
              dashboard.acknowledgements.map((p, i) => (
                <View key={p.id} style={[styles.policyRow, i > 0 && styles.rowBorder]}>
                  <FileCheck2 size={18} color={p.acknowledged ? Colors.teal : Colors.secondary} strokeWidth={2} />
                  <View style={styles.policyBody}>
                    <Text style={styles.policyTitle} numberOfLines={2}>{p.title} · {p.version}</Text>
                    {p.acknowledged ? (
                      <Text style={styles.policyDone}>Acknowledged{p.acknowledgedAt ? ` ${new Date(p.acknowledgedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</Text>
                    ) : (
                      <Text style={styles.policyMeta}>{p.required ? 'Required' : 'Optional'} · awaiting acknowledgement</Text>
                    )}
                  </View>
                  {!p.acknowledged && (
                    <PrimaryButton label="Acknowledge" onPress={() => handleAcknowledge(p)} loading={acknowledge.isPending} variant="secondary" fullWidth={false} style={styles.ackBtn} />
                  )}
                </View>
              ))
            )}
          </SectionCard>

          <SectionCard title="Patient consents" style={styles.card}>
            {dashboard.consents.length === 0 ? (
              <Text style={styles.muted}>No consent records.</Text>
            ) : (
              dashboard.consents.map((c, i) => <ConsentRow key={c.id} consent={c} border={i > 0} />)
            )}
          </SectionCard>

          <SectionCard title="Audit trail" style={styles.card}>
            {dashboard.auditEntries.length === 0 ? (
              <Text style={styles.muted}>No audit activity.</Text>
            ) : (
              dashboard.auditEntries.map((e, i) => (
                <View key={e.id} style={[styles.auditRow, i > 0 && styles.rowBorder]}>
                  <Activity size={16} color={Colors.teal} strokeWidth={2} />
                  <View style={styles.auditBody}>
                    <Text style={styles.auditText}>{e.detail}</Text>
                    <Text style={styles.auditMeta}>{e.actor} · {new Date(e.at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
                  </View>
                </View>
              ))
            )}
          </SectionCard>

          <Text style={styles.groupTitle}>Privacy, audit &amp; safety</Text>
          <View style={styles.menu}>
            <ProfileMenuItem icon="ShieldCheck" iconColor={Colors.primary} bgColor={Colors.iconBgPurple} label="Data privacy settings" onPress={() => router.push('/(doctor)/compliance/privacy')} />
            <View style={styles.menuDivider} />
            <ProfileMenuItem icon="FileText" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Prescription audit" onPress={() => router.push({ pathname: '/(doctor)/compliance/audit/[scope]', params: { scope: 'prescription' } })} />
            <View style={styles.menuDivider} />
            <ProfileMenuItem icon="Stethoscope" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Consultation audit trail" onPress={() => router.push({ pathname: '/(doctor)/compliance/audit/[scope]', params: { scope: 'consultation' } })} />
            <View style={styles.menuDivider} />
            <ProfileMenuItem icon="FlaskConical" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Lab order audit trail" onPress={() => router.push({ pathname: '/(doctor)/compliance/audit/[scope]', params: { scope: 'lab' } })} />
            <View style={styles.menuDivider} />
            <ProfileMenuItem icon="ShieldCheck" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="HMO claim audit trail" onPress={() => router.push({ pathname: '/(doctor)/compliance/audit/[scope]', params: { scope: 'hmo' } })} />
            <View style={styles.menuDivider} />
            <ProfileMenuItem icon="GraduationCap" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Mandatory training" onPress={() => router.push('/(doctor)/compliance/training')} />
            <View style={styles.menuDivider} />
            <ProfileMenuItem icon="AlertTriangle" iconColor={Colors.error} bgColor={Colors.errorContainer} label="Report a safety issue" onPress={() => router.push('/(doctor)/compliance/safety-issue')} />
            <View style={styles.menuDivider} />
            <ProfileMenuItem icon="Eye" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Account review notice" onPress={() => router.push('/(doctor)/compliance/account-review')} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ConsentRow({ consent, border }: { consent: ConsentRecord; border: boolean }) {
  return (
    <View style={[styles.consentRow, border && styles.rowBorder]}>
      <View style={styles.consentBody}>
        <Text style={styles.consentScope} numberOfLines={1}>{consent.scope}</Text>
        <Text style={styles.consentMeta} numberOfLines={1}>{consent.patient.name} · granted {new Date(consent.grantedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
      </View>
      <StatusBadge label={consent.active ? 'Active' : 'Revoked'} tone={consent.active ? 'success' : 'neutral'} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  content:       { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  card:          { marginBottom: Spacing.md },
  muted:         { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  licenceHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  licenceIcon:   { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  licenceBody:   { flex: 1, gap: 2 },
  licenceTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  licenceNum:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  rowBorder:     { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  alertRow:      { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  alertIcon:     { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  alertBody:     { flex: 1, gap: 4 },
  alertTop:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  alertTitle:    { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  alertText:     { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  policyRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  policyBody:    { flex: 1, gap: 2 },
  policyTitle:   { ...Typography.labelMd, color: Colors.onSurface },
  policyDone:    { ...Typography.caption, color: Colors.teal },
  policyMeta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  ackBtn:        { height: 40, paddingHorizontal: Spacing.md },
  consentRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingVertical: Spacing.sm },
  consentBody:   { flex: 1, gap: 2 },
  consentScope:  { ...Typography.labelMd, color: Colors.onSurface },
  consentMeta:   { ...Typography.caption, color: Colors.onSurfaceVariant },
  auditRow:      { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  auditBody:     { flex: 1, gap: 2 },
  auditText:     { ...Typography.bodySm, color: Colors.onSurface },
  auditMeta:     { ...Typography.caption, color: Colors.onSurfaceVariant },
  groupTitle:    { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  menu:          { borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  menuDivider:   { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginHorizontal: Spacing.containerMargin },
});
