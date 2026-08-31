import React from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { MessageCircle, CalendarDays, ListTodo, FileText, Check, Clock, Crown, Pencil, X, UserMinus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useCommittee, useRequestJoinCommittee } from '@/features/association/hooks/useCommunity';
import { useAdminAccess } from '@/features/association/hooks/useAdminMembers';
import { useQueryClient } from '@tanstack/react-query';
import { decideCommitteeRequest, removeCommitteeMember } from '@/features/association/api/authoring.api';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import { initials, formatCount } from '@/features/association/utils/associationFormatters';

export default function CommitteeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const committee = useCommittee(id);
  const join = useRequestJoinCommittee();
  const access = useAdminAccess();
  const isAdmin = Boolean(access.data?.isAdmin);
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ['association', 'committee', id] });

  const decide = async (membershipId: string, name: string, approve: boolean) => {
    if (busy) return;
    const ok = await confirmAsync({
      title: approve ? `Approve ${name}?` : `Decline ${name}?`,
      message: approve
        ? 'They will join the committee.'
        : 'They can ask to join again later.',
      confirmLabel: approve ? 'Approve' : 'Decline',
      destructive: !approve,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await decideCommitteeRequest(id as string, membershipId, approve);
      refresh();
    } catch {
      await alertAsync({ title: "Couldn't save that", message: 'Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (membershipId: string, name: string) => {
    if (busy) return;
    const ok = await confirmAsync({
      title: `Remove ${name}?`,
      message: 'They will be taken off this committee.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await removeCommitteeMember(id as string, membershipId);
      refresh();
    } catch {
      await alertAsync({ title: "Couldn't remove them", message: 'Please try again.' });
    } finally {
      setBusy(false);
    }
  };

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
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{displayName}</Text>
                  {/* PENDING means they asked and nobody has answered. Before
                      this screen could answer, that row was a dead end. */}
                  {m.status === 'PENDING' ? <Text style={styles.pendingTag}>Awaiting approval</Text> : null}
                </View>
                <Text style={styles.memberRole}>{m.role ?? 'Member'}</Text>
                {isAdmin && m.membershipId ? (
                  m.status === 'PENDING' ? (
                    <View style={styles.adminActions}>
                      <Pressable onPress={() => decide(m.membershipId as string, displayName, true)} disabled={busy} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Approve ${displayName}`}>
                        <Check size={16} color={Colors.tertiaryContainer} strokeWidth={2.4} />
                      </Pressable>
                      <Pressable onPress={() => decide(m.membershipId as string, displayName, false)} disabled={busy} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Decline ${displayName}`}>
                        <X size={16} color={Colors.error} strokeWidth={2.4} />
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable onPress={() => remove(m.membershipId as string, displayName)} disabled={busy} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Remove ${displayName}`}>
                      <UserMinus size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    </Pressable>
                  )
                ) : null}
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
  pendingTag: { ...Typography.labelSm, color: Colors.gold },
  adminActions: { flexDirection: 'row', gap: 4 },
  iconBtn: {
    width: 30, height: 30, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
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
