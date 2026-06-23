import React from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Mail, Phone, Briefcase, UserPlus, FileCheck2, FileX2, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useApplication, useDecideApplication } from '@/features/association/hooks/useAdmin';
import { formatNaira, formatDateTime } from '@/features/association/utils/associationFormatters';
import type { ApprovalDecision } from '@/features/association/types/admin.types';

export default function ApplicationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApplication(id);
  const decide = useDecideApplication();

  if (app.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Application" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (app.isError || !app.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Application" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => app.refetch()} />
      </SafeAreaView>
    );
  }

  const a = app.data;
  const slaBreached = a.slaHoursLeft < 0;

  const onDecide = (decision: ApprovalDecision) => {
    const verb = decision === 'APPROVE' ? 'Approve' : decision === 'REJECT' ? 'Reject' : 'Request info from';
    Alert.alert(`${verb} application`, `${verb} ${a.applicantName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: decision === 'REJECT' ? 'destructive' : 'default',
        onPress: () => decide.mutate({ id: a.id, decision }, {
          onSuccess: () => router.replace('/association/admin/approvals'),
          onError: () => Alert.alert('Failed', 'Could not record the decision. Please try again.'),
        }),
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Application" subtitle={a.jurisdiction === 'NATIONAL' ? 'National review' : 'Chapter review'} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.name}>{a.applicantName}</Text>
        <Text style={styles.meta}>{a.category} · {a.chapter}</Text>

        {/* SLA */}
        <View style={[styles.slaCard, slaBreached ? styles.slaBad : styles.slaOk]}>
          {slaBreached ? <AlertTriangle size={16} color={Colors.error} strokeWidth={2} /> : <Clock size={16} color={Colors.gold} strokeWidth={2} />}
          <Text style={[styles.slaText, { color: slaBreached ? Colors.error : Colors.gold }]}>
            {slaBreached ? `SLA breached by ${Math.abs(a.slaHoursLeft)}h` : `${a.slaHoursLeft}h left to review`}
          </Text>
          <Text style={styles.slaSub}>Submitted {formatDateTime(a.submittedAt)}</Text>
        </View>

        {/* Applicant detail */}
        <View style={[styles.card, shadow1]}>
          <Row icon={<Mail size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />} value={a.email} />
          <Row icon={<Phone size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />} value={a.phone} />
          <Row icon={<Briefcase size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />} value={a.profession} />
          <Row icon={<UserPlus size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />} value={a.sponsor ? `Sponsor: ${a.sponsor}` : 'No sponsor'} />
        </View>

        {/* Payment */}
        <View style={[styles.payRow, a.paid ? styles.payOk : styles.payBad]}>
          {a.paid ? <CheckCircle2 size={16} color={Colors.teal} strokeWidth={2} /> : <AlertTriangle size={16} color={Colors.error} strokeWidth={2} />}
          <Text style={[styles.payText, { color: a.paid ? Colors.teal : Colors.error }]}>
            Registration fee {formatNaira(a.registrationFeeKobo)} · {a.paid ? 'Paid' : 'Not paid'}
          </Text>
        </View>

        {/* Documents */}
        <Text style={styles.sectionTitle}>Documents</Text>
        <View style={[styles.card, shadow1]}>
          {a.documents.map((d, i) => (
            <View key={d.id} style={[styles.docRow, i > 0 && styles.docDivider]}>
              {d.verified ? <FileCheck2 size={16} color={Colors.teal} strokeWidth={2} /> : <FileX2 size={16} color={Colors.gold} strokeWidth={2} />}
              <Text style={styles.docName}>{d.name}</Text>
              <Text style={[styles.docStatus, { color: d.verified ? Colors.teal : Colors.gold }]}>{d.verified ? 'Verified' : 'Unverified'}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Decision footer */}
      <View style={styles.footer}>
        <View style={styles.footerBtns}>
          <PrimaryButton label="Reject" variant="secondary" fullWidth={false} style={styles.footerBtn} onPress={() => onDecide('REJECT')} />
          <PrimaryButton label="Approve" fullWidth={false} style={styles.footerBtn} loading={decide.isPending} onPress={() => onDecide('APPROVE')} />
        </View>
        <PrimaryButton label="Request more info" variant="ghost" onPress={() => onDecide('REQUEST_INFO')} />
      </View>
    </SafeAreaView>
  );
}

function Row({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <View style={styles.row}>
      {icon}
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120, gap: Spacing.md },
  name: { ...Typography.headlineMd, color: Colors.onSurface },
  meta: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  slaCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.lg, padding: Spacing.md, flexWrap: 'wrap' },
  slaOk: { backgroundColor: Colors.iconBgGold },
  slaBad: { backgroundColor: Colors.errorContainer },
  slaText: { ...Typography.labelMd, fontWeight: '700' as const },
  slaSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, width: '100%' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowValue: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.lg, padding: Spacing.md },
  payOk: { backgroundColor: Colors.iconBgTeal },
  payBad: { backgroundColor: Colors.errorContainer },
  payText: { ...Typography.labelMd, fontWeight: '600' as const, flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  docDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  docName: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  docStatus: { ...Typography.labelSm, fontWeight: '600' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, gap: Spacing.xs },
  footerBtns: { flexDirection: 'row', gap: Spacing.sm },
  footerBtn: { flex: 1 },
});
