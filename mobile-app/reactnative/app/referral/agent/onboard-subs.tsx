import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { DisclosureCard } from '@/features/referral/components';
import { relativeTime } from '@/features/referral/constants/format';
import { useTeamInvites, useTeamMembers, useOnboardSubReferrer } from '@/features/referral/agent/hooks';
import type { InviteState, MemberStatus } from '@/features/referral/agent/types';

// M-AGT-02 — Onboard sub-referrers: invite/manage team members.
const INVITE_META: Record<InviteState, { label: string; color: string; bg: string }> = {
  pending:  { label: 'Pending',  color: Colors.onWarning,         bg: Colors.iconBgGold },
  accepted: { label: 'Accepted', color: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  declined: { label: 'Declined', color: Colors.error,             bg: Colors.errorContainer },
};
const MEMBER_META: Record<MemberStatus, { label: string; color: string; bg: string }> = {
  active:     { label: 'Active',     color: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  onboarding: { label: 'Onboarding', color: Colors.secondary,         bg: Colors.iconBgBlue },
  inactive:   { label: 'Inactive',   color: Colors.onSurfaceVariant,  bg: Colors.surfaceContainer },
};

export default function OnboardSubsScreen() {
  const invites = useTeamInvites();
  const members = useTeamMembers();
  const onboard = useOnboardSubReferrer();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');

  const submit = () => {
    if (!name.trim() || !contact.trim()) return;
    onboard.mutate({ name: name.trim(), contact: contact.trim() }, {
      onSuccess: (res) => { if (res.ok) { setName(''); setContact(''); } },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Onboard team" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <DisclosureCard
          tone="compliant"
          title="Build a real team, not a downline"
          body="Invite people who will genuinely use and promote Paymax. You only earn from your team's verified activity — never for recruiting them."
        />

        {/* Invite form */}
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Invite a sub-referrer</Text>
          <TextInputField label="Name" value={name} onChangeText={setName} placeholder="Full name" />
          <TextInputField label="Phone or email" value={contact} onChangeText={setContact} placeholder="0803... or name@mail.com" autoCapitalize="none" />
          <PrimaryButton label="Send invite" onPress={submit} loading={onboard.isPending} disabled={!name.trim() || !contact.trim()} />
          {onboard.data?.ok ? <Text style={styles.success}>Invite sent.</Text> : null}
        </View>

        {/* Pending invites */}
        <Text style={styles.sectionTitle}>Invites</Text>
        {invites.isLoading ? (
          <StateView kind="loading" compact />
        ) : invites.isError ? (
          <StateView kind="error" title="Couldn't load invites" actionLabel="Retry" onAction={invites.refetch} compact />
        ) : !invites.data || invites.data.length === 0 ? (
          <StateView kind="empty" icon="Send" title="No invites yet" message="Sent invites appear here." compact />
        ) : (
          <View style={styles.list}>
            {invites.data.map((iv, i) => {
              const meta = INVITE_META[iv.state];
              return (
                <View key={iv.id} style={[styles.row, i < invites.data!.length - 1 && styles.rowBorder]}>
                  <View style={styles.rowBody}><Text style={styles.rowName}>{iv.name}</Text><Text style={styles.rowMeta}>{iv.contact} · {relativeTime(iv.sentAt)}</Text></View>
                  <View style={[styles.pill, { backgroundColor: meta.bg }]}><Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text></View>
                </View>
              );
            })}
          </View>
        )}

        {/* Members */}
        <Text style={styles.sectionTitle}>Team members</Text>
        {members.isLoading ? (
          <StateView kind="loading" compact />
        ) : members.isError ? (
          <StateView kind="error" title="Couldn't load members" actionLabel="Retry" onAction={members.refetch} compact />
        ) : !members.data || members.data.length === 0 ? (
          <StateView kind="empty" icon="Users" title="No members yet" message="Accepted members appear here." compact />
        ) : (
          <View style={styles.list}>
            {members.data.map((m, i) => {
              const meta = MEMBER_META[m.status];
              return (
                <Pressable
                  key={m.id}
                  style={[styles.row, i < members.data!.length - 1 && styles.rowBorder]}
                  onPress={() => router.push({ pathname: '/referral/agent/member-detail', params: { id: m.id } })}
                  accessibilityRole="button"
                >
                  <View style={styles.avatar}><Text style={styles.avatarText}>{m.name.charAt(0)}</Text></View>
                  <View style={styles.rowBody}><Text style={styles.rowName}>{m.name}</Text><Text style={styles.rowMeta}>{m.verifiedReferrals} verified referrals</Text></View>
                  <View style={[styles.pill, { backgroundColor: meta.bg }]}><Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text></View>
                  <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 80, gap: Spacing.md },
  formCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  formTitle: { ...Typography.titleMd, color: Colors.onSurface },
  success: { ...Typography.labelSm, color: Colors.tertiaryContainer, textAlign: 'center' },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  list: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  avatar: { width: 38, height: 38, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.labelLg, color: Colors.primary, fontWeight: '700' as const },
  rowBody: { flex: 1 },
  rowName: { ...Typography.labelMd, color: Colors.onSurface },
  rowMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  pill: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  pillText: { ...Typography.labelSm, fontWeight: '700' as const },
});
