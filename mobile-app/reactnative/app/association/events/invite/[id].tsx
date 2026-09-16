import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useAdminAccess } from '@/features/association/hooks/useAdminMembers';
import { listOrgMembers, inviteToEvent } from '@/features/association/api/authoring.api';
import { alertAsync } from '@/lib/confirm';

export default function InviteToEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const access = useAdminAccess();
  const orgId = access.data?.isAdmin ? access.data.organisationId ?? undefined : undefined;

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [sending, setSending] = useState(false);

  const members = useQuery({
    queryKey: ['association', 'orgMembers', orgId, search],
    queryFn: () => listOrgMembers(orgId as string, search || undefined),
    enabled: Boolean(orgId),
    staleTime: 30_000,
  });

  const list = useMemo(() => members.data ?? [], [members.data]);
  const chosen = Object.keys(selected);

  const toggle = (membershipId: string) =>
    setSelected((prev) => {
      const next = { ...prev };
      if (next[membershipId]) delete next[membershipId];
      else next[membershipId] = true;
      return next;
    });

  const send = async () => {
    if (!id || chosen.length === 0 || sending) return;
    setSending(true);
    try {
      const res = await inviteToEvent(id, chosen);
      // The server drops memberships outside this event's organisation, so the
      // number invited can be lower than the number sent. Report what actually
      // happened rather than the count we asked for.
      await alertAsync(
        res.invited === res.requested
          ? { title: 'Invitations sent', message: `${res.invited} member${res.invited === 1 ? '' : 's'} invited.` }
          : { title: 'Some invitations were not sent', message: `${res.invited} of ${res.requested} were invited. The rest are no longer active members of this organisation.` },
      );
      router.back();
    } catch {
      await alertAsync({ title: "Couldn't send invitations", message: 'Please try again.' });
    } finally {
      setSending(false);
    }
  };

  if (!orgId && !access.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Invite members" />
        <StateView kind="empty" icon="ShieldAlert" title="Admins only" message="Only an organisation admin can invite members to an event." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Invite members" />
      <View style={styles.searchWrap}>
        <TextInputField placeholder="Search members" value={search} onChangeText={setSearch} autoCapitalize="none" />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {members.isLoading ? (
          <Text style={styles.help}>Loading members…</Text>
        ) : list.length === 0 ? (
          <Text style={styles.help}>No members match that search.</Text>
        ) : (
          list.map((m) => {
            const active = Boolean(selected[m.id]);
            return (
              <Pressable
                key={m.id}
                onPress={() => toggle(m.id)}
                style={[styles.member, active && styles.memberActive]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.memberName, active && styles.memberNameActive]} numberOfLines={1}>{m.fullName}</Text>
                  <Text style={styles.memberMeta} numberOfLines={1}>{m.memberId}{m.chapterName ? ` · ${m.chapterName}` : ''}</Text>
                </View>
                {active ? <Check size={16} color={Colors.primary} strokeWidth={2.4} /> : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton
          label={sending ? 'Sending…' : chosen.length === 0 ? 'Select members to invite' : `Invite ${chosen.length}`}
          onPress={send}
          disabled={sending || chosen.length === 0}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  searchWrap: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.sm, paddingTop: Spacing.sm },
  help: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  member: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  memberActive: { borderColor: Colors.primary },
  memberName: { ...Typography.labelMd, color: Colors.onSurface },
  memberNameActive: { color: Colors.primary },
  memberMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
