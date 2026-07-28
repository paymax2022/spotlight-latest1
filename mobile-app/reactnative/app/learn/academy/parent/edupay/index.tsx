import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { School, PiggyBank, ChevronRight, Plus, CheckCircle2, Calendar, Search as SearchIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import Chip from '@/features/academy/components/Chip';
import { useSchools, useFeeSchedules, useEduPayProfile, useLinkSchool, usePots } from '@/features/academy/hooks';
import { formatNaira, formatDate, daysUntil } from '@/features/academy/constants';
import type { School as SchoolT, FeeSchedule } from '@/features/academy/types';

/** P8 — EduPay fees hub: linked schools, fee schedules, link new schools, jump to pay/pots. */
export default function EduPayHub() {
  const [q, setQ] = useState('');
  const schools = useSchools(q);
  const fees = useFeeSchedules();
  const profile = useEduPayProfile();
  const pots = usePots();
  const link = useLinkSchool();

  if (schools.isLoading || fees.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading EduPay…" /></SafeAreaView>;

  const linkedFees = fees.data?.filter((f) => f.linked) ?? [];
  const totalSaved = pots.data?.reduce((s, p) => s + p.savedKobo, 0) ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="EduPay" subtitle="School fees & savings" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Savings teaser */}
        <Pressable onPress={() => router.push('/learn/academy/parent/edupay/pots')}>
          <LinearGradient colors={Colors.gradientCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.savingsCard, shadow3]}>
            <PiggyBank size={22} color={Colors.gold} />
            <View style={{ flex: 1 }}>
              <Text style={styles.savingsKicker}>SAVE FOR SCHOOL</Text>
              <Text style={styles.savingsAmount}>{formatNaira(totalSaved)} saved</Text>
              <Text style={styles.savingsSub}>{pots.data?.length ?? 0} pot{(pots.data?.length ?? 0) === 1 ? '' : 's'} · tap to manage</Text>
            </View>
            <ChevronRight size={18} color={Colors.onPrimary} />
          </LinearGradient>
        </Pressable>

        {/* Linked fee schedules */}
        <Text style={styles.section}>Fees due</Text>
        {linkedFees.length ? linkedFees.map((f) => <FeeCard key={f.id} f={f} />) : (
          <Text style={styles.muted}>No linked fee schedules yet. Link a school below.</Text>
        )}

        {/* Schools */}
        <Text style={styles.section}>Schools</Text>
        <TextInputField placeholder="Search schools…" value={q} onChangeText={setQ} leftIcon={<SearchIcon size={18} color={Colors.outline} />} />
        {schools.data?.map((s) => (
          <SchoolRow key={s.id} s={s} busy={link.isPending} onLink={() => link.mutate({ schoolId: s.id })} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function FeeCard({ f }: { f: FeeSchedule }) {
  const days = daysUntil(f.dueDate);
  const due = days <= 14;
  return (
    <Pressable style={[styles.feeCard, shadow1]} onPress={() => router.push(`/learn/academy/parent/edupay/pay/${f.id}`)}>
      <View style={styles.feeTop}>
        <Text style={styles.feeSchool}>{f.schoolName}</Text>
        <Chip label={due ? `Due in ${days}d` : `${days}d left`} color={due ? Colors.error : Colors.onSurfaceVariant} bg={due ? Colors.errorContainer : Colors.surfaceContainerHigh} small />
      </View>
      <Text style={styles.feeMeta}>{f.term} · {f.classCode}</Text>
      <View style={styles.feeBottom}>
        <View style={styles.feeDate}><Calendar size={13} color={Colors.onSurfaceVariant} /><Text style={styles.feeDateText}>{formatDate(f.dueDate)}</Text></View>
        <Text style={styles.feeAmount}>{formatNaira(f.totalKobo)}</Text>
      </View>
    </Pressable>
  );
}

function SchoolRow({ s, busy, onLink }: { s: SchoolT; busy: boolean; onLink: () => void }) {
  return (
    <View style={[styles.schoolRow, shadow1]}>
      <View style={[styles.schoolIcon, { backgroundColor: (Colors as unknown as Record<string, string>)[s.logoColorKey] ?? Colors.iconBgPurple }]}>
        <School size={18} color={Colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.schoolName}>{s.name}</Text>
        <Text style={styles.schoolMeta}>{s.lga}, {s.state}{s.verified ? ' · verified' : ''}</Text>
      </View>
      {s.linked ? (
        <View style={styles.linkedPill}><CheckCircle2 size={14} color={Colors.teal} /><Text style={styles.linkedText}>Linked</Text></View>
      ) : (
        <Pressable style={styles.linkBtn} onPress={onLink} disabled={busy}>
          <Plus size={14} color={Colors.onPrimary} /><Text style={styles.linkBtnText}>Link</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  savingsCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.lg, padding: Spacing.md },
  savingsKicker: { ...Typography.labelSm, color: Colors.gold, letterSpacing: 1, fontWeight: '700' },
  savingsAmount: { ...Typography.titleLg, color: Colors.onPrimary },
  savingsSub: { ...Typography.labelSm, color: Colors.inversePrimary },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.md },
  muted: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  feeCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 4 },
  feeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feeSchool: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  feeMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  feeBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  feeDate: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  feeDateText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  feeAmount: { ...Typography.titleLg, color: Colors.primary },
  schoolRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  schoolIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  schoolName: { ...Typography.labelLg, color: Colors.onSurface },
  schoolMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  linkedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal },
  linkedText: { ...Typography.labelSm, color: Colors.teal, fontWeight: '700' },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.primary },
  linkBtnText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '700' },
});
