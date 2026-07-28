import React, { useState } from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Briefcase, MapPin, CalendarDays, UserCog, ArrowRightLeft, Ban, RotateCcw, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import MembershipStatusBadge, { PaymentStandingBadge } from '@/features/association/components/MembershipStatusBadge';
import { useMember } from '@/features/association/hooks/useAssociation';
import {
  useAdminAccess, useSuspendMember, useRestoreMember, useTransferMember, useAssignRole,
} from '@/features/association/hooks/useAdminMembers';
import { initials, formatDate } from '@/features/association/utils/associationFormatters';
import { ASSIGNABLE_ROLES } from '@/features/association/types/adminRole.types';
import type { AdminRole } from '@/features/association/types/adminRole.types';

const CHAPTERS = ['Lagos State Chapter', 'FCT Abuja Chapter', 'Rivers State Chapter', 'Kano State Chapter'];

export default function AdminMemberDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const member = useMember(id);
  const access = useAdminAccess();
  const suspend = useSuspendMember();
  const restore = useRestoreMember();
  const transfer = useTransferMember();
  const role = useAssignRole();

  const [chapter, setChapter] = useState('');
  const [newRole, setNewRole] = useState('');

  if (member.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Member" />
        <StateView kind="loading" message="Loading member…" />
      </SafeAreaView>
    );
  }
  if (member.isError || !member.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Member" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => member.refetch()} />
      </SafeAreaView>
    );
  }

  // RBAC: block the actions surface if the admin lacks member-management capability.
  if (access.data && !access.data.can.manageMembers) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Member" />
        <StateView kind="empty" icon="Lock" title="Not permitted" message="Your admin role can’t manage members. Contact a national admin." />
      </SafeAreaView>
    );
  }

  const m = member.data;
  const suspended = m.status === 'SUSPENDED' || m.status === 'RESTRICTED';

  const confirm = (title: string, msg: string, onYes: () => void, destructive = false) =>
    Alert.alert(title, msg, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', style: destructive ? 'destructive' : 'default', onPress: onYes }]);

  const onSuspend = () => confirm('Suspend member', `Suspend ${m.fullName}? They lose access until restored.`, () =>
    suspend.mutate({ id: m.id, reason: 'Administrative action' }, { onSuccess: () => Alert.alert('Done', 'Member suspended.') }), true);
  const onRestore = () => confirm('Restore member', `Restore ${m.fullName}'s access?`, () =>
    restore.mutate(m.id, { onSuccess: () => Alert.alert('Done', 'Member restored.') }));
  const onTransfer = () => {
    if (!chapter) return;
    confirm('Transfer member', `Move ${m.fullName} to ${chapter}? This is logged.`, () =>
      transfer.mutate({ id: m.id, chapter }, { onSuccess: () => { Alert.alert('Done', 'Member transferred.'); setChapter(''); } }));
  };
  const onAssignRole = () => {
    const picked = ASSIGNABLE_ROLES.find((r) => r.label === newRole);
    if (!picked) return;
    confirm('Assign role', `Assign “${picked.label}” to ${m.fullName}?`, () =>
      role.mutate({ id: m.id, role: picked.value as AdminRole }, { onSuccess: () => { Alert.alert('Done', 'Role assigned.'); setNewRole(''); } }));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Member (admin)" subtitle={access.data?.roleLabel} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Identity */}
        <View style={styles.identity}>
          <View style={styles.avatar}>
            {m.photoUrl ? <Image source={{ uri: m.photoUrl }} style={styles.avatarImg} /> : <Text style={styles.avatarText}>{initials(m.fullName)}</Text>}
          </View>
          <Text style={styles.name}>{m.fullName}</Text>
          <Text style={styles.memberId}>{m.memberId}</Text>
          <View style={styles.badgeRow}>
            <MembershipStatusBadge status={m.status} />
            <PaymentStandingBadge standing={m.paymentStanding} />
          </View>
        </View>

        {/* Detail */}
        <View style={[styles.card, shadow1]}>
          <Detail icon={<Briefcase size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Profession" value={m.profession ?? '—'} />
          <Detail icon={<MapPin size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Chapter" value={m.chapterName ?? '—'} />
          <Detail icon={<CalendarDays size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Joined" value={formatDate(m.joinedAt)} />
        </View>

        {/* Status action */}
        <Text style={styles.sectionTitle}>Membership status</Text>
        {suspended ? (
          <Pressable style={[styles.actionBtn, styles.restoreBtn]} onPress={onRestore} disabled={restore.isPending} accessibilityRole="button" accessibilityLabel="Restore member">
            <RotateCcw size={18} color={Colors.onPrimary} strokeWidth={2.2} />
            <Text style={styles.actionText}>Restore access</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.actionBtn, styles.suspendBtn]} onPress={onSuspend} disabled={suspend.isPending} accessibilityRole="button" accessibilityLabel="Suspend member">
            <Ban size={18} color={Colors.error} strokeWidth={2.2} />
            <Text style={[styles.actionText, { color: Colors.error }]}>Suspend member</Text>
          </Pressable>
        )}

        {/* Transfer */}
        <Text style={styles.sectionTitle}>Transfer chapter</Text>
        <View style={styles.actionCard}>
          <SelectField placeholder="Select destination chapter" value={chapter} options={CHAPTERS} onChange={setChapter} />
          <PrimaryButton label="Transfer" variant="secondary" onPress={onTransfer} loading={transfer.isPending} disabled={!chapter} />
        </View>

        {/* Assign role */}
        <Text style={styles.sectionTitle}>Assign role</Text>
        <View style={styles.actionCard}>
          <View style={styles.roleHint}><UserCog size={14} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.roleHintText}>Grant an admin role to this member.</Text></View>
          <SelectField placeholder="Select a role" value={newRole} options={ASSIGNABLE_ROLES.map((r) => r.label)} onChange={setNewRole} searchable={false} />
          <PrimaryButton label="Assign role" variant="secondary" onPress={onAssignRole} loading={role.isPending} disabled={!newRole} />
        </View>

        <View style={styles.auditNote}>
          <ArrowRightLeft size={13} color={Colors.outline} strokeWidth={2} />
          <Text style={styles.auditText}>All member actions are recorded in the admin audit log.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      {icon}
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md },
  identity: { alignItems: 'center', gap: 4, paddingTop: Spacing.sm },
  avatar: { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { ...Typography.headlineMd, color: Colors.primary },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  memberId: { ...Typography.labelMd, color: Colors.onSurfaceVariant, letterSpacing: 0.5 },
  badgeRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  detailLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, width: 96 },
  detailValue: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.md },
  suspendBtn: { backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.error },
  restoreBtn: { backgroundColor: Colors.primary },
  actionText: { ...Typography.labelLg, color: Colors.onPrimary, fontWeight: '700' as const },
  actionCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  roleHint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roleHintText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  auditNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  auditText: { ...Typography.caption, color: Colors.outline },
});
