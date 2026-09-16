import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { BadgeCheck, X, Plus, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useOpenToWork, useSetOpenToWork } from '@/features/connect/networking/jobs/hooks';

/**
 * Open to Work signal (PRD §6.1 JB-07). Profile-level flag, visible to
 * Recruiters only. Editable desired roles + preferred locations.
 */
export default function OpenToWorkScreen() {
  const otwQuery = useOpenToWork();
  const save = useSetOpenToWork();

  const [enabled, setEnabled] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [recruitersOnly, setRecruitersOnly] = useState(true);
  const [roleDraft, setRoleDraft] = useState('');
  const [locDraft, setLocDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);

  // Hydrate local editor state once the server value loads.
  useEffect(() => {
    if (otwQuery.data && !hydrated) {
      setEnabled(otwQuery.data.enabled);
      setRoles(otwQuery.data.roles);
      setLocations(otwQuery.data.locations);
      setRecruitersOnly(otwQuery.data.visibleToRecruitersOnly);
      setHydrated(true);
    }
  }, [otwQuery.data, hydrated]);

  function addRole() {
    const v = roleDraft.trim();
    if (v && !roles.includes(v)) setRoles((r) => [...r, v]);
    setRoleDraft('');
  }
  function addLocation() {
    const v = locDraft.trim();
    if (v && !locations.includes(v)) setLocations((l) => [...l, v]);
    setLocDraft('');
  }

  function onSave() {
    save.mutate(
      { enabled, roles, locations, visibleToRecruitersOnly: recruitersOnly },
      { onSuccess: () => goBack('/connect/networking/jobs') },
    );
  }

  if (otwQuery.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Open to Work" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Open to Work" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Master toggle */}
        <View style={styles.toggleCard}>
          <View style={[styles.toggleIcon, enabled && styles.toggleIconOn]}>
            <BadgeCheck size={22} color={enabled ? ConnectColors.ok : Colors.onSurfaceVariant} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleTitle}>Open to Work</Text>
            <Text style={styles.toggleSub}>Signal that you’re open to new roles.</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ false: Colors.surfaceContainerHigh, true: ConnectColors.brand }}
            thumbColor={Colors.white}
          />
        </View>

        {/* Visibility note (JB-07 — recruiters only) */}
        <View style={styles.visRow}>
          <Lock size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.visText}>Your signal is visible to Recruiters only — it won’t show a public badge.</Text>
        </View>

        <View style={[styles.section, !enabled && styles.sectionDim]} pointerEvents={enabled ? 'auto' : 'none'}>
          {/* Desired roles */}
          <Text style={styles.sectionTitle}>Desired roles</Text>
          <ChipEditor items={roles} onRemove={(v) => setRoles((r) => r.filter((x) => x !== v))} />
          <View style={styles.addRow}>
            <View style={{ flex: 1 }}>
              <TextInputField
                value={roleDraft}
                onChangeText={setRoleDraft}
                placeholder="e.g. Product Manager"
                onSubmitEditing={addRole}
                returnKeyType="done"
              />
            </View>
            <Pressable style={styles.addBtn} onPress={addRole} accessibilityRole="button" accessibilityLabel="Add role">
              <Plus size={20} color={Colors.onPrimary} strokeWidth={2.4} />
            </Pressable>
          </View>

          {/* Preferred locations */}
          <Text style={styles.sectionTitle}>Preferred locations</Text>
          <ChipEditor items={locations} onRemove={(v) => setLocations((l) => l.filter((x) => x !== v))} />
          <View style={styles.addRow}>
            <View style={{ flex: 1 }}>
              <TextInputField
                value={locDraft}
                onChangeText={setLocDraft}
                placeholder="e.g. Lagos or Remote"
                onSubmitEditing={addLocation}
                returnKeyType="done"
              />
            </View>
            <Pressable style={styles.addBtn} onPress={addLocation} accessibilityRole="button" accessibilityLabel="Add location">
              <Plus size={20} color={Colors.onPrimary} strokeWidth={2.4} />
            </Pressable>
          </View>
        </View>

        <View style={{ height: Spacing.xl }} />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Save" onPress={onSave} loading={save.isPending} />
        {save.isError ? <Text style={styles.errorText}>Couldn’t save. Please try again.</Text> : null}
      </View>
    </SafeAreaView>
  );
}

function ChipEditor({ items, onRemove }: { items: string[]; onRemove: (value: string) => void }) {
  if (items.length === 0) {
    return <Text style={styles.emptyChips}>Nothing added yet.</Text>;
  }
  return (
    <View style={styles.chips}>
      {items.map((item) => (
        <View key={item} style={styles.chip}>
          <Text style={styles.chipText}>{item}</Text>
          <Pressable onPress={() => onRemove(item)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${item}`}>
            <X size={13} color={ConnectColors.brand} strokeWidth={2.4} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
  },
  toggleIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerHigh,
  },
  toggleIconOn: { backgroundColor: Colors.iconBgTeal },
  toggleTitle: { ...Typography.titleMd, color: Colors.onSurface },
  toggleSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  visRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: Spacing.md },
  visText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  section: { marginTop: Spacing.lg },
  sectionDim: { opacity: 0.45 },
  sectionTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700', marginTop: Spacing.lg, marginBottom: Spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.iconBgPurple,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
  },
  chipText: { ...Typography.labelMd, color: ConnectColors.brand, fontWeight: '600' },
  emptyChips: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  addRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  addBtn: {
    width: 56,
    height: 56,
    borderRadius: Radius.lg,
    backgroundColor: ConnectColors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
    gap: Spacing.xs,
  },
  errorText: { ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
});
