import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Camera, X, TriangleAlert, Sparkles } from 'lucide-react-native';
import { useMutation } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useCreateMaintenance } from '@/features/realtor/hooks/useRealtorMaintenance';
import { triageMaintenance } from '@/features/realtor/api/realtorAI.api';
import { CATEGORY_OPTIONS, CATEGORY_LABEL, CATEGORY_ICON, URGENCY_OPTIONS, URGENCY_META } from '@/features/realtor/constants/realtor.maintenance.constants';
import type { MaintenanceCategory, Urgency } from '@/features/realtor/types/realtor.maintenance.types';

export default function ReportIssueScreen() {
  const create = useCreateMaintenance();
  const [category, setCategory] = useState<MaintenanceCategory>();
  const [urgency, setUrgency] = useState<Urgency>('normal');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [media, setMedia] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  const triage = useMutation({
    mutationFn: () => triageMaintenance(description, category ?? 'other'),
    onSuccess: (r) => { setCategory(r.suggestedCategory); setUrgency(r.suggestedUrgency); },
  });

  // Real uploads use the existing R2 presigned flow; here we attach a placeholder
  // to keep the flow runnable without native permission prompts in the sandbox.
  const addPhoto = () => setMedia((m) => [...m, `https://picsum.photos/seed/maint${m.length}${Date.now() % 1000}/600/450`]);

  const submit = async () => {
    if (!category) return setError('Pick a category.');
    if (title.trim().length < 3) return setError('Add a short title.');
    if (description.trim().length < 5) return setError('Describe the issue.');
    setError(undefined);
    try {
      const r = await create.mutateAsync({ category, urgency, title: title.trim(), description: description.trim(), mediaUris: media });
      router.replace(`/realtor/maintenance/${r.id}`);
    } catch {
      setError('Could not submit. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Report an issue" subtitle="Flat 3B · Lekki Phase 1" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Category</Text>
        <View style={styles.catGrid}>
          {CATEGORY_OPTIONS.map((c) => {
            const IconCmp = (Icons as any)[CATEGORY_ICON[c]] ?? Icons.Wrench;
            const active = category === c;
            return (
              <Pressable key={c} style={[styles.cat, active && styles.catActive]} onPress={() => setCategory(c)} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <IconCmp size={20} color={active ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
                <Text style={[styles.catText, active && styles.catTextActive]} numberOfLines={1}>{CATEGORY_LABEL[c]}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Urgency</Text>
        <View style={styles.urgRow}>
          {URGENCY_OPTIONS.map((u) => {
            const active = urgency === u;
            const meta = URGENCY_META[u];
            return (
              <Pressable key={u} style={[styles.urg, active && styles.urgActive]} onPress={() => setUrgency(u)}>
                <Text style={[styles.urgText, active && styles.urgTextActive]}>{meta.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {urgency === 'emergency' ? (
          <View style={styles.emergencyNote}>
            <TriangleAlert size={14} color={Colors.error} strokeWidth={2.2} />
            <Text style={styles.emergencyText}>Emergencies bypass the approval gate and are dispatched to a vendor immediately.</Text>
          </View>
        ) : null}

        <TextInputField label="Title" placeholder="e.g. Leaking kitchen sink" value={title} onChangeText={setTitle} />
        <TextInputField label="Describe the issue" placeholder="What's happening, since when…" value={description} onChangeText={setDescription} multiline />

        {description.trim().length >= 8 ? (
          <Pressable style={styles.aiBtn} onPress={() => triage.mutate()} disabled={triage.isPending} accessibilityRole="button" accessibilityLabel="AI triage">
            <Sparkles size={15} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.aiText}>{triage.isPending ? 'Analysing…' : 'AI triage — suggest category & urgency'}</Text>
          </Pressable>
        ) : null}
        {triage.data ? <Text style={styles.aiHint}>{triage.data.summary}</Text> : null}

        <Text style={styles.label}>Photos</Text>
        <View style={styles.mediaRow}>
          {media.map((uri) => (
            <View key={uri} style={styles.thumbWrap}>
              <Image source={{ uri }} style={styles.thumb} />
              <Pressable style={styles.removeBtn} hitSlop={6} onPress={() => setMedia((m) => m.filter((x) => x !== uri))} accessibilityLabel="Remove photo">
                <X size={12} color={Colors.white} strokeWidth={2.5} />
              </Pressable>
            </View>
          ))}
          {media.length < 4 ? (
            <Pressable style={styles.addPhoto} onPress={addPhoto} accessibilityRole="button" accessibilityLabel="Add photo">
              <Camera size={20} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.addPhotoText}>Add</Text>
            </Pressable>
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Submit request" onPress={submit} loading={create.isPending} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.md, marginBottom: Spacing.sm },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  cat: { width: '31%', flexGrow: 1, alignItems: 'center', gap: 6, paddingVertical: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  catActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  catText: { ...Typography.labelSm, color: Colors.onSurface },
  catTextActive: { color: Colors.onPrimary },
  urgRow: { flexDirection: 'row', gap: Spacing.sm },
  urg: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  urgActive: { backgroundColor: Colors.primaryFixed, borderColor: Colors.primary },
  urgText: { ...Typography.labelSm, color: Colors.onSurface },
  urgTextActive: { color: Colors.primary, fontWeight: '700' as const },
  aiBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primaryFixed, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.xs },
  aiText: { ...Typography.labelMd, color: Colors.onPrimaryFixed },
  aiHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  emergencyNote: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  emergencyText: { ...Typography.bodySm, color: Colors.error, flex: 1, lineHeight: 18 },
  mediaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  thumbWrap: { position: 'relative' },
  thumb: { width: 72, height: 72, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  removeBtn: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
  addPhoto: { width: 72, height: 72, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 2 },
  addPhotoText: { ...Typography.labelSm, color: Colors.secondary },
  error: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
});
