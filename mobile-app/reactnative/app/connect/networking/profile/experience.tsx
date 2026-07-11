import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Briefcase, Pencil, Trash2, Plus, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import ToggleRow from '@/features/connect/components/ToggleRow';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import {
  useExperience,
  useAddExperience,
  useUpdateExperience,
  useDeleteExperience,
} from '@/features/connect/networking/profile/hooks';
import type { Experience, ExperienceInput } from '@/features/connect/networking/profile/types';

const EMPTY: ExperienceInput = {
  title: '',
  company: '',
  employmentType: '',
  location: '',
  startDate: '',
  endDate: '',
  current: false,
  description: '',
};

function dateRange(e: Experience): string {
  const end = e.current ? 'Present' : e.endDate || '—';
  return `${e.startDate || '—'} → ${end}`;
}

/** Experience timeline — add/edit roles (PRD §6.3 PR-07). */
export default function ExperienceScreen() {
  const query = useExperience();
  const add = useAddExperience();
  const update = useUpdateExperience();
  const remove = useDeleteExperience();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExperienceInput | null>(null);

  const busy = add.isPending || update.isPending;

  function openAdd() {
    setEditingId('new');
    setForm({ ...EMPTY });
  }

  function openEdit(e: Experience) {
    setEditingId(e.id);
    setForm({
      title: e.title,
      company: e.company,
      employmentType: e.employmentType ?? '',
      location: e.location ?? '',
      startDate: e.startDate,
      endDate: e.endDate ?? '',
      current: e.current,
      description: e.description ?? '',
    });
  }

  function closeForm() {
    setEditingId(null);
    setForm(null);
  }

  function set<K extends keyof ExperienceInput>(key: K, value: ExperienceInput[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  const canSave = !!form && form.title.trim().length > 0 && form.company.trim().length > 0 && form.startDate.trim().length > 0;

  function onSave() {
    if (!form) return;
    const payload: ExperienceInput = {
      ...form,
      title: form.title.trim(),
      company: form.company.trim(),
      endDate: form.current ? null : (form.endDate || null),
    };
    if (editingId === 'new') {
      add.mutate(payload, { onSuccess: closeForm });
    } else if (editingId) {
      update.mutate({ id: editingId, input: payload }, { onSuccess: closeForm });
    }
  }

  const showForm = !!form;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Experience"
        rightSlot={
          !showForm ? (
            <Pressable onPress={openAdd} hitSlop={10} accessibilityRole="button" accessibilityLabel="Add role">
              <Plus size={22} color={ConnectColors.brand} strokeWidth={2.4} />
            </Pressable>
          ) : null
        }
      />

      {showForm ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.formTitle}>{editingId === 'new' ? 'Add a role' : 'Edit role'}</Text>
          <TextInputField label="Title" value={form.title} onChangeText={(v) => set('title', v)} placeholder="e.g. Product Engineer" />
          <TextInputField label="Company" value={form.company} onChangeText={(v) => set('company', v)} placeholder="e.g. Paymax" />
          <TextInputField label="Employment type" value={form.employmentType ?? ''} onChangeText={(v) => set('employmentType', v)} placeholder="Full-time / Contract / Internship" />
          <TextInputField label="Location" value={form.location ?? ''} onChangeText={(v) => set('location', v)} placeholder="e.g. Lagos, Nigeria" />
          <TextInputField label="Start (YYYY-MM)" value={form.startDate} onChangeText={(v) => set('startDate', v)} placeholder="2023-02" />
          <View style={styles.toggleWrap}>
            <ToggleRow label="I currently work here" value={form.current} onValueChange={(v) => set('current', v)} />
          </View>
          <TextInputField
            label="End (YYYY-MM)"
            value={form.current ? '' : (form.endDate ?? '')}
            onChangeText={(v) => set('endDate', v)}
            placeholder={form.current ? 'Present' : '2024-01'}
            editable={!form.current}
          />
          <TextInputField
            label="Description"
            value={form.description ?? ''}
            onChangeText={(v) => set('description', v)}
            placeholder="What did you do in this role?"
            multiline
            numberOfLines={4}
            maxLength={600}
            style={styles.multiline}
          />

          {add.isError || update.isError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>Couldn't save this role. Please try again.</Text>
            </View>
          ) : null}

          <View style={styles.formActions}>
            <PrimaryButton label={editingId === 'new' ? 'Add role' : 'Save changes'} onPress={onSave} loading={busy} disabled={!canSave} />
            <PrimaryButton label="Cancel" variant="ghost" onPress={closeForm} />
          </View>
          <View style={{ height: Spacing.lg }} />
        </ScrollView>
      ) : query.isLoading ? (
        <StateView kind="loading" message="Loading experience…" />
      ) : query.isError ? (
        <StateView kind="error" icon="CloudOff" title="Couldn't load experience" actionLabel="Retry" onAction={() => query.refetch()} />
      ) : !query.data || query.data.length === 0 ? (
        <StateView
          kind="empty"
          icon="Briefcase"
          title="No experience yet"
          message="Add your roles so connections and recruiters know your background."
          actionLabel="Add a role"
          onAction={openAdd}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.list}>
            {query.data.map((e) => (
              <View key={e.id} style={styles.card}>
                <View style={styles.cardIcon}>
                  <Briefcase size={18} color={ConnectColors.brand} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roleTitle}>{e.title}</Text>
                  <Text style={styles.roleCompany}>
                    {e.company}{e.employmentType ? ` · ${e.employmentType}` : ''}
                  </Text>
                  <Text style={styles.roleDates}>{dateRange(e)}</Text>
                  {e.location ? (
                    <View style={styles.locRow}>
                      <MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                      <Text style={styles.roleLoc}>{e.location}</Text>
                    </View>
                  ) : null}
                  {e.description ? <Text style={styles.roleDesc}>{e.description}</Text> : null}
                  <View style={styles.rowActions}>
                    <Pressable style={styles.actionBtn} onPress={() => openEdit(e)} accessibilityRole="button">
                      <Pencil size={14} color={ConnectColors.brand} strokeWidth={2} />
                      <Text style={styles.actionText}>Edit</Text>
                    </Pressable>
                    <Pressable
                      style={styles.actionBtn}
                      onPress={() => remove.mutate(e.id)}
                      accessibilityRole="button"
                      disabled={remove.isPending}
                    >
                      <Trash2 size={14} color={Colors.error} strokeWidth={2} />
                      <Text style={[styles.actionText, { color: Colors.error }]}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </View>
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  formTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.md },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  toggleWrap: { marginBottom: Spacing.sm },
  formActions: { gap: Spacing.xs, marginTop: Spacing.sm },
  errorBox: { backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  errorText: { ...Typography.labelMd, color: Colors.error },
  list: { gap: Spacing.md },
  card: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  roleTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  roleCompany: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 1 },
  roleDates: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  roleLoc: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  roleDesc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  rowActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionText: { ...Typography.labelMd, color: ConnectColors.brand, fontWeight: '700' },
});
