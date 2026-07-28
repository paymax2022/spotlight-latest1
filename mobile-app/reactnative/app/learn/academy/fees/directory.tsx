import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Building2, Search as SearchIcon, ShieldCheck, Users, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import Chip from '@/features/academy/components/Chip';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { trustBand } from '@/features/academy/fees/constants';
import { useDirectory } from '@/features/academy/fees/hooks';
import type { DirectorySchool } from '@/features/academy/fees/types';

/** PA-16 — School directory with trust score. */
export default function SchoolDirectory() {
  const [q, setQ] = useState('');
  const directory = useDirectory(q);

  const list = directory.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="School directory" subtitle="PA-16 · Trust scores" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInputField placeholder="Search by name, LGA or state…" value={q} onChangeText={setQ} leftIcon={<SearchIcon size={18} color={Colors.outline} />} />

        <View style={[styles.note, shadow1]}>
          <ShieldCheck size={16} color={Colors.teal} />
          <Text style={styles.noteText}>Trust score reflects a school's verification tier and on-time settlement history on Paymax.</Text>
        </View>

        {directory.isLoading ? (
          <StateView kind="loading" message="Loading schools…" compact />
        ) : list.length ? (
          list.map((s) => <SchoolRow key={s.id} s={s} />)
        ) : (
          <StateView kind="empty" icon="Building2" title="No schools found" message="Try a different search term." compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SchoolRow({ s }: { s: DirectorySchool }) {
  const band = trustBand(s.trustScore);
  return (
    <Pressable style={[styles.card, shadow1]} onPress={() => router.push('/learn/academy/fees/onboarding')}>
      <View style={styles.top}>
        <View style={[styles.logo, { backgroundColor: (Colors as unknown as Record<string, string>)[s.logoColorKey] ?? Colors.iconBgPurple }]}>
          <Building2 size={18} color={Colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
            {s.verified ? <CheckCircle2 size={14} color={Colors.teal} /> : null}
          </View>
          <Text style={styles.meta}>{s.lga}, {s.state}</Text>
        </View>
        {s.linked ? <Chip label="Linked" color={Colors.teal} bg={Colors.iconBgTeal} small /> : null}
      </View>

      <View style={styles.trustRow}>
        <Text style={styles.trustLabel}>Trust score</Text>
        <View style={styles.trustRight}>
          <Text style={styles.trustScore}>{s.trustScore}</Text>
          <Chip label={band.label} color={band.color} bg={band.bg} small />
        </View>
      </View>
      <ProgressBar pct={s.trustScore} color={band.color} height={6} style={{ marginTop: 4 }} />

      <View style={styles.footer}>
        <View style={styles.students}><Users size={12} color={Colors.onSurfaceVariant} /><Text style={styles.studentsText}>{s.studentCount.toLocaleString('en-NG')} students</Text></View>
        <Text style={styles.link}>Link a child →</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md },
  noteText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  logo: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  trustRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  trustLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  trustRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  trustScore: { ...Typography.titleMd, color: Colors.onSurface },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs },
  students: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  studentsText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  link: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' },
});
