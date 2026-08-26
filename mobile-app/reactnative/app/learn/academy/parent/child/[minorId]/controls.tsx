import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Clock, ShieldCheck, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useControls, useUpdateControls } from '@/features/academy/hooks';
import type { UsageControls } from '@/features/academy/types';

const CAPS = [0, 30, 45, 60, 90, 120];
const HOURS_FROM = ['06:00', '07:00', '08:00', '09:00'];
const HOURS_TO = ['18:00', '19:00', '20:00', '21:00', '22:00'];
const FILTERS: { value: UsageControls['contentFilter']; label: string }[] = [
  { value: 'all_ages', label: 'All ages' },
  { value: 'teen', label: 'Teen' },
  { value: 'unrestricted', label: 'Unrestricted' },
];

/** P5 — Usage controls: screen-time cap, allowed hours, content filter → PUT controls. */
export default function UsageControlsScreen() {
  const { minorId } = useLocalSearchParams<{ minorId: string }>();
  const controls = useControls(minorId);
  const update = useUpdateControls();

  const [draft, setDraft] = useState<UsageControls | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (controls.data && !draft) setDraft(controls.data); }, [controls.data, draft]);

  if (controls.isLoading || !draft) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading controls…" /></SafeAreaView>;
  if (controls.isError) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Controls" /><StateView kind="error" title="No active link" message={controls.error instanceof Error ? controls.error.message : ''} /></SafeAreaView>;

  const set = (patch: Partial<UsageControls>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = () => {
    if (!draft) return;
    update.mutate({ minorId, input: draft }, { onSuccess: () => { setSaved(true); setTimeout(() => goBack('/learn/academy/parent'), 900); } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Usage controls" subtitle="Screen-time, hours & content" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Daily cap */}
        <Text style={styles.section}>Daily screen-time cap</Text>
        <View style={[styles.card, shadow1]}>
          <View style={styles.chipRow}>
            {CAPS.map((c) => (
              <Pressable key={c} onPress={() => set({ dailyCapMinutes: c })} style={[styles.opt, draft.dailyCapMinutes === c && styles.optActive]}>
                <Text style={[styles.optText, draft.dailyCapMinutes === c && styles.optTextActive]}>{c === 0 ? 'Unlimited' : `${c}m`}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Allowed hours */}
        <Text style={styles.section}>Allowed hours</Text>
        <View style={[styles.card, shadow1]}>
          <View style={styles.hoursRow}>
            <Clock size={16} color={Colors.onSurfaceVariant} />
            <Text style={styles.hoursLabel}>From</Text>
            <View style={styles.chipRowInline}>
              {HOURS_FROM.map((h) => (
                <Pressable key={h} onPress={() => set({ allowedFrom: h })} style={[styles.optSm, draft.allowedFrom === h && styles.optActive]}>
                  <Text style={[styles.optText, draft.allowedFrom === h && styles.optTextActive]}>{h}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={[styles.hoursRow, { marginTop: Spacing.sm }]}>
            <Clock size={16} color={Colors.onSurfaceVariant} />
            <Text style={styles.hoursLabel}>To</Text>
            <View style={styles.chipRowInline}>
              {HOURS_TO.map((h) => (
                <Pressable key={h} onPress={() => set({ allowedTo: h })} style={[styles.optSm, draft.allowedTo === h && styles.optActive]}>
                  <Text style={[styles.optText, draft.allowedTo === h && styles.optTextActive]}>{h}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {/* Content filter */}
        <Text style={styles.section}>Content filter (age)</Text>
        <View style={[styles.card, shadow1]}>
          <View style={styles.chipRow}>
            {FILTERS.map((f) => (
              <Pressable key={f.value} onPress={() => set({ contentFilter: f.value })} style={[styles.opt, draft.contentFilter === f.value && styles.optActive]}>
                <Text style={[styles.optText, draft.contentFilter === f.value && styles.optTextActive]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Toggles */}
        <View style={[styles.toggleCard, shadow1]}>
          <View style={styles.toggleRow}>
            <ShieldCheck size={18} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleTitle}>Require purchase approval</Text>
              <Text style={styles.toggleSub}>Child purchases & redemptions need your OK</Text>
            </View>
            <Switch value={draft.requirePurchaseApproval} onValueChange={(v) => set({ requirePurchaseApproval: v })} trackColor={{ true: Colors.primary }} />
          </View>
          <View style={[styles.toggleRow, { marginTop: Spacing.md }]}>
            <Clock size={18} color={Colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleTitle}>Pause all access</Text>
              <Text style={styles.toggleSub}>Temporarily block learning (e.g. after exams)</Text>
            </View>
            <Switch value={draft.paused} onValueChange={(v) => set({ paused: v })} trackColor={{ true: Colors.error }} />
          </View>
        </View>

        {saved ? <View style={styles.savedRow}><Check size={14} color={Colors.teal} strokeWidth={3} /><Text style={styles.savedText}>Controls updated</Text></View> : null}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Save controls" onPress={save} loading={update.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.xs },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.md, marginBottom: Spacing.xs },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chipRowInline: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
  opt: { paddingHorizontal: Spacing.md, paddingVertical: 10, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  optSm: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: Radius.sm, backgroundColor: Colors.surfaceContainerHigh },
  optActive: { backgroundColor: Colors.primary },
  optText: { ...Typography.labelMd, color: Colors.onSurface },
  optTextActive: { color: Colors.onPrimary, fontWeight: '700' },
  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  hoursLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, width: 40 },
  toggleCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, marginTop: Spacing.md },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  toggleTitle: { ...Typography.labelLg, color: Colors.onSurface },
  toggleSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: Spacing.md },
  savedText: { ...Typography.labelMd, color: Colors.teal, fontWeight: '700' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
