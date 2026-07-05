import React from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Users, Target, MessagesSquare, Plus, X, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import ProgressBar from '@/features/academy/components/ProgressBar';
import Chip from '@/features/academy/components/Chip';
import { useGroups, useJoinGroup, useCreateGroup } from '@/features/academy/hooks';
import type { StudyGroup } from '@/features/academy/types';

/** C4 — Study groups / cohorts: join + group goals. Group-only (no 1:1 DMs). */
export default function CommunityScreen() {
  const groups = useGroups();
  const joinGroup = useJoinGroup();
  const createGroup = useCreateGroup();
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [goal, setGoal] = React.useState('');

  if (groups.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading groups…" /></SafeAreaView>;

  const onCreate = () => {
    if (!name.trim()) return;
    createGroup.mutate({ name: name.trim(), subjectOrTrade: subject.trim() || 'General', goal: goal.trim() || 'Study together' }, {
      onSuccess: () => { setCreating(false); setName(''); setSubject(''); setGoal(''); },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Study groups"
        subtitle="Cohorts & shared goals"
        rightSlot={<Pressable hitSlop={8} onPress={() => setCreating((c) => !c)}>{creating ? <X size={20} color={Colors.onSurface} /> : <Plus size={20} color={Colors.onSurface} />}</Pressable>}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.safetyNote}>
          <ShieldCheck size={16} color={Colors.primary} />
          <Text style={styles.safetyText}>Groups are cohort-based and moderated — there are no private 1:1 chats, keeping younger learners safe.</Text>
        </View>

        {creating ? (
          <View style={[styles.createCard, shadow1]}>
            <Text style={styles.createTitle}>New study group</Text>
            <TextInput style={styles.input} placeholder="Group name" placeholderTextColor={Colors.onSurfaceVariant} value={name} onChangeText={setName} />
            <TextInput style={styles.input} placeholder="Subject or trade" placeholderTextColor={Colors.onSurfaceVariant} value={subject} onChangeText={setSubject} />
            <TextInput style={styles.input} placeholder="Shared goal" placeholderTextColor={Colors.onSurfaceVariant} value={goal} onChangeText={setGoal} />
            <PrimaryButton label="Create group" onPress={onCreate} loading={createGroup.isPending} disabled={!name.trim()} />
          </View>
        ) : null}

        <Pressable style={[styles.discRow, shadow1]} onPress={() => router.push('/learn/academy/community/discussions')}>
          <View style={styles.discIcon}><MessagesSquare size={18} color={Colors.secondary} /></View>
          <Text style={styles.discText}>Discussion & Q&A</Text>
        </Pressable>

        {groups.data?.map((g) => <GroupCard key={g.id} g={g} busy={joinGroup.isPending} onToggle={() => joinGroup.mutate(g.id)} />)}
      </ScrollView>
    </SafeAreaView>
  );
}

function GroupCard({ g, busy, onToggle }: { g: StudyGroup; busy: boolean; onToggle: () => void }) {
  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.top}>
        <View style={styles.icon}><Users size={20} color={Colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{g.name}</Text>
          <Text style={styles.sub}>{g.subjectOrTrade} · {g.members} members</Text>
        </View>
        {g.cohort ? <Chip label="Cohort" color={Colors.teal} bg={Colors.iconBgTeal} small /> : null}
      </View>
      <View style={styles.goalRow}>
        <Target size={13} color={Colors.onSurfaceVariant} />
        <Text style={styles.goalText} numberOfLines={2}>{g.goal}</Text>
      </View>
      <ProgressBar pct={g.goalProgressPct} style={{ marginTop: 4 }} />
      <PrimaryButton label={g.joined ? 'Leave group' : 'Join group'} onPress={onToggle} loading={busy} variant={g.joined ? 'ghost' : 'secondary'} style={{ marginTop: Spacing.sm }} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  safetyNote: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  safetyText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  createCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm },
  createTitle: { ...Typography.titleMd, color: Colors.onSurface },
  input: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingHorizontal: Spacing.md, height: 44, color: Colors.onSurface, ...Typography.bodyMd },
  discRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  discIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  discText: { ...Typography.titleMd, color: Colors.onSurface },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  goalText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
});
