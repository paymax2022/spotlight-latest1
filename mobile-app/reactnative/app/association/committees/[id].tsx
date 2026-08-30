import React from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { MessageCircle, CalendarDays, ListTodo, FileText, Check, Clock, Crown, Pencil } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useCommittee, useRequestJoinCommittee } from '@/features/association/hooks/useCommunity';
import { initials, formatCount } from '@/features/association/utils/associationFormatters';

export default function CommitteeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const committee = useCommittee(id);
  const join = useRequestJoinCommittee();

  if (committee.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Committee" />
        <StateView kind="loading" message="Loading committee…" />
      </SafeAreaView>
    );
  }
  if (committee.isError || !committee.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Committee" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => committee.refetch()} />
      </SafeAreaView>
    );
  }

  const c = committee.data;
  const status = join.isSuccess ? 'PENDING' : c.joinStatus;
  const isMember = status === 'MEMBER';
  const members = c.members ?? [];

  const stats = [
    { icon: CalendarDays, label: 'Meetings', value: c.meetingsCount ?? 0, to: '/association/meetings' },
    { icon: ListTodo, label: 'Tasks', value: c.tasksCount ?? 0, to: '/association/tasks' },
    { icon: FileText, label: 'Documents', value: c.docsCount ?? 0, to: '/association/documents' },
  ] as const;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Committee" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.name}>{c.name}</Text>
        <Text style={styles.purpose}>{c.purpose} · {formatCount(c.memberCount, 'members')}</Text>
        <Text style={styles.body}>{c.description}</Text>

        {/* Leadership — either office may be vacant / absent from the DTO. */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.leadRow}>
            <Crown size={16} color={Colors.gold} strokeWidth={2} />
            <Text style={styles.leadLabel}>Chairperson</Text>
            <Text style={styles.leadName}>{c.chair || 'Not appointed'}</Text>
          </View>
          <View style={[styles.leadRow, styles.leadDivider]}>
            <Pencil size={16} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.leadLabel}>Secretary</Text>
            <Text style={styles.leadName}>{c.secretary || 'Not appointed'}</Text>
          </View>
        </View>

        {/* Stats / quick links (members only) */}
        {isMember ? (
          <View style={styles.statsRow}>
            {stats.map((s) => {
              const Icon = s.icon;
              return (
                <Pressable key={s.label} style={[styles.statCard, shadow1]} onPress={() => router.push(s.to as never)} accessibilityRole="button" accessibilityLabel={`${s.value} ${s.label}`}>
                  <Icon size={18} color={Colors.primary} strokeWidth={2} />
                  <Text style={styles.statValue}>{s.value}</Text>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {isMember && c.chatThreadId ? (
          <Pressable style={[styles.chatRow, shadow1]} onPress={() => router.push(`/association/chat/${c.chatThreadId}`)} accessibilityRole="button" accessibilityLabel="Open committee chat">
            <MessageCircle size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.chatText}>Open committee chat</Text>
          </Pressable>
        ) : null}

        {/* Members */}
        <Text style={styles.sectionTitle}>Members</Text>
        <View style={[styles.card, shadow1]}>
          {members.length === 0 ? (
            <Text style={styles.emptyText}>No members listed for this committee yet.</Text>
          ) : members.map((m, i) => {
            // The mock fixture sends `name`; the Go DTO sends `fullName`
            // (+ `membershipId`). Accept either rather than rendering blank.
            const displayName = m.fullName ?? m.name ?? m.membershipId ?? 'Member';
            return (
              <View key={m.id} style={[styles.memberRow, i > 0 && styles.memberDivider]}>
                <View style={styles.avatar}>
                  {m.photoUrl ? <Image source={{ uri: m.photoUrl }} style={styles.avatarImg} /> : <Text style={styles.avatarText}>{initials(displayName)}</Text>}
                </View>
                <Text style={styles.memberName}>{displayName}</Text>
                <Text style={styles.memberRole}>{m.role ?? 'Member'}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Join CTA */}
      {!isMember ? (
        <View style={styles.footer}>
          {status === 'PENDING' ? (
            <View style={styles.pendingRow}>
              <Clock size={18} color={Colors.gold} strokeWidth={2} />
              <Text style={styles.pendingText}>Join request pending approval</Text>
            </View>
          ) : (
            <PrimaryButton label="Request to join" onPress={() => join.mutate(c.id)} loading={join.isPending} />
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120, gap: Spacing.md },
  name: { ...Typography.headlineMd, color: Colors.onSurface },
  purpose: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  leadRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  leadDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  leadLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, width: 96 },
  leadName: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  statCard: { flex: 1, alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingVertical: Spacing.md },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  emptyText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.md },
  chatText: { ...Typography.labelMd, color: Colors.primary, flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  memberDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  avatar: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const },
  memberName: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  memberRole: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  pendingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  pendingText: { ...Typography.labelMd, color: Colors.gold },
});
