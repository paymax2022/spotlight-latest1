import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
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
import { createTask, listOrgMembers } from '@/features/association/api/authoring.api';
import { alertAsync } from '@/lib/confirm';
import type { TaskPriority } from '@/features/association/types/engagement.types';

const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH'];
const PRIORITY_LABEL: Record<TaskPriority, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };

/** `YYYY-MM-DD` → end-of-day ISO, or null. A deadline is a day, not an instant. */
function dueToIso(date: string): string | null {
  const v = date.trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function NewTaskScreen() {
  const access = useAdminAccess();
  const orgId = access.data?.isAdmin ? access.data.organisationId ?? undefined : undefined;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [due, setDue] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  // The assignee list is MEMBERSHIPS in this organisation — the id the task
  // assignee field expects. A foreign membership is refused 403 server-side.
  const members = useQuery({
    queryKey: ['association', 'orgMembers', orgId, search],
    queryFn: () => listOrgMembers(orgId as string, search || undefined),
    enabled: Boolean(orgId),
    staleTime: 30_000,
  });

  const titleError = title.trim().length < 3 ? 'Give the task a title' : undefined;
  const dueError = due.trim() && !dueToIso(due) ? 'Use YYYY-MM-DD' : undefined;
  const valid = !titleError && !dueError;

  const list = useMemo(() => members.data ?? [], [members.data]);

  const submit = async () => {
    setTouched(true);
    if (!valid || !orgId || saving) return;
    setSaving(true);
    try {
      await createTask(orgId, {
        title: title.trim(),
        description: description.trim() || null,
        status: 'ASSIGNED',
        priority,
        dueDate: dueToIso(due),
        assigneeId,
        checklist: [],
        // Notifies the ASSIGNEE only, not the whole organisation.
        notify: Boolean(assigneeId),
      });
      await alertAsync({
        title: 'Task created',
        message: assigneeId ? 'The assignee has been notified.' : 'It is unassigned — you can assign it later.',
      });
      router.back();
    } catch {
      await alertAsync({ title: "Couldn't create the task", message: 'Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  // Creating and assigning work is a management action; the server gates it the
  // same way, so this is a clearer refusal rather than the only one.
  if (access.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="New task" />
        <StateView kind="loading" message="Checking your access…" />
      </SafeAreaView>
    );
  }
  if (!orgId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="New task" />
        <StateView kind="empty" icon="ShieldAlert" title="Admins only" message="Only an organisation admin can create and assign tasks." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New task" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInputField label="Title" placeholder="e.g. Draft the AGM agenda" value={title} onChangeText={setTitle} error={touched ? titleError : undefined} />
        <TextInputField label="Details (optional)" placeholder="What needs doing?" value={description} onChangeText={setDescription} multiline numberOfLines={3} />

        <Text style={styles.label}>Priority</Text>
        <View style={styles.row}>
          {PRIORITIES.map((p) => {
            const active = priority === p;
            return (
              <Pressable key={p} onPress={() => setPriority(p)} style={[styles.chip, active && styles.chipActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{PRIORITY_LABEL[p]}</Text>
              </Pressable>
            );
          })}
        </View>

        <TextInputField label="Due date (optional)" placeholder="2026-09-30" value={due} onChangeText={setDue} keyboardType="numbers-and-punctuation" error={touched ? dueError : undefined} />

        <Text style={styles.label}>Assign to</Text>
        <TextInputField placeholder="Search members" value={search} onChangeText={setSearch} autoCapitalize="none" />
        <Pressable onPress={() => setAssigneeId(null)} style={[styles.member, assigneeId === null && styles.memberActive]} accessibilityRole="radio" accessibilityState={{ selected: assigneeId === null }}>
          <Text style={[styles.memberName, assigneeId === null && styles.memberNameActive]}>Leave unassigned</Text>
          {assigneeId === null ? <Check size={16} color={Colors.primary} strokeWidth={2.4} /> : null}
        </Pressable>
        {members.isLoading ? (
          <Text style={styles.help}>Loading members…</Text>
        ) : list.length === 0 ? (
          <Text style={styles.help}>No members match that search.</Text>
        ) : (
          list.slice(0, 25).map((m) => {
            const active = assigneeId === m.id;
            return (
              <Pressable key={m.id} onPress={() => setAssigneeId(m.id)} style={[styles.member, active && styles.memberActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
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
        <PrimaryButton label={saving ? 'Creating…' : 'Create task'} onPress={submit} disabled={saving || (touched && !valid)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.sm, paddingTop: Spacing.sm },
  label: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  help: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  row: { flexDirection: 'row', gap: Spacing.sm },
  chip: {
    flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest,
  },
  chipActive: { borderColor: Colors.primary },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.primary },
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
