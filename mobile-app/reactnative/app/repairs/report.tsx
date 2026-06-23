import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { CATEGORY_META, URGENCY_META } from '@/features/repairs/api';
import { useCreateRepair } from '@/features/repairs/hooks';
import type { RepairCategory, RepairUrgency } from '@/features/repairs/api';

const CATS = Object.keys(CATEGORY_META) as RepairCategory[];
const URGS: RepairUrgency[] = ['low', 'medium', 'high'];

export default function ReportRepairScreen() {
  const create = useCreateRepair();
  const [category, setCategory] = useState<RepairCategory>('plumbing');
  const [urgency, setUrgency] = useState<RepairUrgency>('medium');
  const [description, setDescription] = useState('');

  const submit = () => {
    const desc = description.trim();
    if (!desc) return;
    create.mutate({ category, urgency, description: desc }, { onSuccess: () => router.replace('/repairs') });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Report maintenance" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Category</Text>
          <View style={styles.grid}>
            {CATS.map((c) => {
              const selected = c === category; const meta = CATEGORY_META[c];
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Wrench;
              return (
                <Pressable key={c} onPress={() => setCategory(c)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.tile, selected && styles.tileSel]}>
                  <Icon size={20} color={selected ? Colors.onPrimary : Colors.secondary} strokeWidth={1.8} />
                  <Text style={[styles.tileText, selected && { color: Colors.onPrimary }]}>{meta.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.label}>Urgency</Text>
          <View style={styles.urgRow}>
            {URGS.map((u) => {
              const selected = u === urgency; const meta = URGENCY_META[u];
              return (
                <Pressable key={u} onPress={() => setUrgency(u)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.urg, { borderColor: selected ? meta.color : Colors.surfaceContainerLow, backgroundColor: selected ? meta.bg : Colors.surfaceContainerLowest }]}>
                  <Text style={[styles.urgText, { color: selected ? meta.color : Colors.onSurfaceVariant }]}>{meta.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInputField label="Describe the issue" placeholder="What needs fixing, and where?" value={description} onChangeText={setDescription} multiline numberOfLines={4} style={styles.multiline} />
        </ScrollView>
        <View style={styles.footer}><PrimaryButton label="Submit request" onPress={submit} loading={create.isPending} disabled={!description.trim()} /></View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { width: '30%', flexGrow: 1, alignItems: 'center', gap: 4, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
  tileSel: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tileText: { ...Typography.labelSm, color: Colors.onSurface },
  urgRow: { flexDirection: 'row', gap: Spacing.sm },
  urg: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5 },
  urgText: { ...Typography.labelMd, fontWeight: '700' },
  multiline: { minHeight: 100, textAlignVertical: 'top', paddingTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
});
