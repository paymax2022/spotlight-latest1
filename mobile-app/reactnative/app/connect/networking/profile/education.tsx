import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GraduationCap, Pencil, Trash2, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import {
  useEducation,
  useAddEducation,
  useUpdateEducation,
  useDeleteEducation,
} from '@/features/connect/networking/profile/hooks';
import type { Education, EducationInput } from '@/features/connect/networking/profile/types';

const EMPTY: EducationInput = {
  institution: '',
  degree: '',
  fieldOfStudy: '',
  startYear: '',
  endYear: '',
  description: '',
};

/** Education history — add/edit (PRD §6.3 PR-08). */
export default function EducationScreen() {
  const query = useEducation();
  const add = useAddEducation();
  const update = useUpdateEducation();
  const remove = useDeleteEducation();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EducationInput | null>(null);

  const busy = add.isPending || update.isPending;

  function openAdd() {
    setEditingId('new');
    setForm({ ...EMPTY });
  }

  function openEdit(e: Education) {
    setEditingId(e.id);
    setForm({
      institution: e.institution,
      degree: e.degree ?? '',
      fieldOfStudy: e.fieldOfStudy ?? '',
      startYear: e.startYear,
      endYear: e.endYear ?? '',
      description: e.description ?? '',
    });
  }

  function closeForm() {
    setEditingId(null);
    setForm(null);
  }

  function set<K extends keyof EducationInput>(key: K, value: EducationInput[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  const canSave = !!form && form.institution.trim().length > 0 && form.startYear.trim().length > 0;

  function onSave() {
    if (!form) return;
    const payload: EducationInput = {
      ...form,
      institution: form.institution.trim(),
      endYear: form.endYear || null,
    };
    if (editingId === 'new') add.mutate(payload, { onSuccess: closeForm });
    else if (editingId) update.mutate({ id: editingId, input: payload }, { onSuccess: closeForm });
  }

  const showForm = !!form;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Education"
        rightSlot={
          !showForm ? (
            <Pressable onPress={openAdd} hitSlop={10} accessibilityRole="button" accessibilityLabel="Add education">
              <Plus size={22} color={ConnectColors.brand} strokeWidth={2.4} />
            </Pressable>
          ) : null
        }
      />

      {showForm ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.formTitle}>{editingId === 'new' ? 'Add education' : 'Edit education'}</Text>
          <TextInputField label="Institution" value={form.institution} onChangeText={(v) => set('institution', v)} placeholder="e.g. University of Lagos" />
          <TextInputField label="Degree" value={form.degree ?? ''} onChangeText={(v) => set('degree', v)} placeholder="e.g. BSc" />
          <TextInputField label="Field of study" value={form.fieldOfStudy ?? ''} onChangeText={(v) => set('fieldOfStudy', v)} placeholder="e.g. Computer Science" />
          <TextInputField label="Start year" value={form.startYear} onChangeText={(v) => set('startYear', v)} placeholder="2015" keyboardType="numeric" />
          <TextInputField label="End year" value={form.endYear ?? ''} onChangeText={(v) => set('endYear', v)} placeholder="2019 (leave blank if ongoing)" keyboardType="numeric" />
          <TextInputField
            label="Description"
            value={form.description ?? ''}
            onChangeText={(v) => set('description', v)}
            placeholder="Honours, activities, achievements…"
            multiline
            numberOfLines={4}
            maxLength={600}
            style={styles.multiline}
          />

          {add.isError || update.isError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>Couldn't save this entry. Please try again.</Text>
            </View>
          ) : null}

          <View style={styles.formActions}>
            <PrimaryButton label={editingId === 'new' ? 'Add education' : 'Save changes'} onPress={onSave} loading={busy} disabled={!canSave} />
            <PrimaryButton label="Cancel" variant="ghost" onPress={closeForm} />
          </View>
          <View style={{ height: Spacing.lg }} />
        </ScrollView>
      ) : query.isLoading ? (
        <StateView kind="loading" message="Loading education…" />
      ) : query.isError ? (
        <StateView kind="error" icon="CloudOff" title="Couldn't load education" actionLabel="Retry" onAction={() => query.refetch()} />
      ) : !query.data || query.data.length === 0 ? (
        <StateView
          kind="empty"
          icon="GraduationCap"
          title="No education yet"
          message="Add your schools and qualifications."
          actionLabel="Add education"
          onAction={openAdd}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.list}>
            {query.data.map((e) => (
              <View key={e.id} style={styles.card}>
                <View style={styles.cardIcon}>
                  <GraduationCap size={18} color={ConnectColors.brand} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.school}>{e.institution}</Text>
                  <Text style={styles.degree}>
                    {[e.degree, e.fieldOfStudy].filter(Boolean).join(', ') || '—'}
                  </Text>
                  <Text style={styles.years}>
                    {e.startYear} → {e.endYear || 'Present'}
                  </Text>
                  {e.description ? <Text style={styles.desc}>{e.description}</Text> : null}
                  <View style={styles.rowActions}>
                    <Pressable style={styles.actionBtn} onPress={() => openEdit(e)} accessibilityRole="button">
                      <Pencil size={14} color={ConnectColors.brand} strokeWidth={2} />
                      <Text style={styles.actionText}>Edit</Text>
                    </Pressable>
                    <Pressable style={styles.actionBtn} onPress={() => remove.mutate(e.id)} accessibilityRole="button" disabled={remove.isPending}>
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
  school: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  degree: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 1 },
  years: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  rowActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionText: { ...Typography.labelMd, color: ConnectColors.brand, fontWeight: '700' },
});
