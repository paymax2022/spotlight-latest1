import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Users, AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useCohorts } from '@/features/academy/hooks';

const COLOR_KEY = (k: string) => (Colors as unknown as Record<string, string>)[k] ?? Colors.iconBgPurple;

/** T3 — Class roster: manage students grouped by cohort. */
export default function TutorRoster() {
  const cohorts = useCohorts();
  if (cohorts.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading roster…" /></SafeAreaView>;

  const empty = !cohorts.data?.length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Class roster" subtitle="Students by cohort" />
      {empty ? (
        <StateView kind="empty" title="No cohorts yet" message="Create a cohort to start adding students." />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {cohorts.data?.map((c) => (
            <View key={c.id} style={styles.group}>
              <View style={styles.groupHead}>
                <View style={styles.groupIcon}><Users size={16} color={Colors.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.groupTitle}>{c.name}</Text>
                  <Text style={styles.groupSub}>{c.subjectOrTrade} · {c.studentCount} students</Text>
                </View>
              </View>
              {c.students.map((s) => (
                <View key={s.id} style={[styles.studentCard, shadow1]}>
                  <View style={[styles.avatar, { backgroundColor: COLOR_KEY(s.avatarColorKey) }]}><Text style={styles.avatarText}>{s.name[0]}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.studentName}>{s.name}</Text>
                    <Text style={styles.studentSub}>{s.classCode} · {s.progressPct}% complete</Text>
                    <ProgressBar pct={s.progressPct} style={{ marginTop: 6 }} />
                  </View>
                  {s.pendingCount > 0 ? (
                    <View style={styles.pendingTag}>
                      <AlertCircle size={12} color={Colors.onWarning} />
                      <Text style={styles.pendingText}>{s.pendingCount}</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  group: { gap: Spacing.sm },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  groupIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  groupTitle: { ...Typography.titleMd, color: Colors.onSurface },
  groupSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  studentCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  studentName: { ...Typography.labelLg, color: Colors.onSurface },
  studentSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  pendingTag: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.iconBgGold, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full },
  pendingText: { ...Typography.caption, color: Colors.onWarning, fontWeight: '700' },
});
