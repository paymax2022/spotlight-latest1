import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import { Trash2 } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import { useEvent, useTeam, useAddTeamMember, useRemoveTeamMember } from '@/features/events/hooks';
import { lifecycleErrorMessage } from '@/features/events/api';
import { EventColors, EVENTS_TEAM_ROLES_ENABLED } from '@/features/events/constants/events.constants';
import type { TeamMember } from '@/features/events/types';

const BACK = '/events/organiser/dashboard';

export default function ManageTeam() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const eventId = typeof id === 'string' ? id : '';
  const event = useEvent(eventId);
  const team = useTeam(eventId);
  const addMember = useAddTeamMember(eventId);
  const removeMember = useRemoveTeamMember(eventId);
  const [handle, setHandle] = useState('');
  const [error, setError] = useState('');

  if (!EVENTS_TEAM_ROLES_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Team" onBack={() => goBack(BACK)} />
        <StateView kind="empty" title="Not available yet" message="Team management isn't enabled for your account." />
      </SafeAreaView>
    );
  }
  if (team.isLoading) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Team" /><StateView kind="loading" message="Loading team…" /></SafeAreaView>;
  }
  if (team.isError) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Team" onBack={() => goBack(BACK)} /><StateView kind="error" title="Couldn't load team" message="Please try again." actionLabel="Retry" onAction={() => team.refetch()} /></SafeAreaView>;
  }

  const members = team.data ?? [];

  const add = async () => {
    const h = handle.trim().replace(/^@/, '');
    if (!h) { setError('Enter a handle'); return; }
    setError('');
    try {
      await addMember.mutateAsync({ user_handle: h, role: 'MANAGER' });
      setHandle('');
    } catch (err) {
      await alertAsync({ title: 'Couldn\'t add manager', message: lifecycleErrorMessage(err) });
    }
  };

  const remove = async (m: TeamMember) => {
    const ok = await confirmAsync({
      title: 'Remove team member?',
      message: `${m.name || m.handle} will lose manager access to this event.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeMember.mutateAsync(m.user_id);
    } catch (err) {
      await alertAsync({ title: 'Couldn\'t remove member', message: lifecycleErrorMessage(err) });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Team" subtitle={event.data?.title} onBack={() => goBack(BACK)} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {members.length === 0 ? <Text style={styles.note}>No team members yet.</Text> : null}
        {members.map((m) => (
          <View key={m.user_id} style={styles.card}>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{m.name || m.handle}</Text>
              <Text style={styles.meta}>@{m.handle} · {m.role === 'MANAGER' ? 'Manager' : 'Finance'}</Text>
            </View>
            <Pressable
              onPress={() => remove(m)}
              disabled={removeMember.isPending}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${m.name || m.handle}`}
              hitSlop={8}
            >
              <Trash2 size={18} color={Colors.error} />
            </Pressable>
          </View>
        ))}

        <Text style={styles.section}>Add manager</Text>
        <TextInputField
          label="User handle"
          value={handle}
          onChangeText={setHandle}
          autoCapitalize="none"
          autoCorrect={false}
          error={error}
        />
        <Text style={styles.note}>Managers can run this event on your behalf. A Finance role is coming later.</Text>
        <PrimaryButton label={addMember.isPending ? 'Adding…' : 'Add manager'} onPress={add} disabled={addMember.isPending} />
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  cardBody: { flex: 1 },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.bodyMd, color: EventColors.muted, marginTop: 2 },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.md, marginBottom: Spacing.sm },
  note: { ...Typography.caption, color: EventColors.muted, marginBottom: Spacing.md },
});
