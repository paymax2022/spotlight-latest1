import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Minus, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useStaysStore } from '@/features/stays/store';
import type { GuestConfig } from '@/features/stays/types';

export default function GuestsScreen() {
  const { query, setQuery } = useStaysStore();
  const [g, setG] = useState<GuestConfig>(query.guests);

  const update = (patch: Partial<GuestConfig>) => setG((p) => ({ ...p, ...patch }));

  const setChildren = (n: number) => {
    const ages = [...g.childrenAges];
    while (ages.length < n) ages.push(8);
    ages.length = n;
    update({ children: n, childrenAges: ages });
  };

  const setAge = (idx: number, age: number) => {
    const ages = [...g.childrenAges];
    ages[idx] = age;
    update({ childrenAges: ages });
  };

  const apply = () => {
    setQuery({ guests: g });
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Guests & rooms" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Stepper label="Adults" sub="Ages 18+" value={g.adults} min={1} onChange={(v) => update({ adults: v })} />
        <Stepper label="Children" sub="Ages 0–17" value={g.children} min={0} max={6} onChange={setChildren} />

        {g.children > 0 ? (
          <View style={styles.agesCard}>
            <Text style={styles.agesTitle}>Children's ages</Text>
            <Text style={styles.agesHint}>Used to find the best room fit and pricing.</Text>
            <View style={styles.agesGrid}>
              {g.childrenAges.map((age, i) => (
                <View key={i} style={styles.ageRow}>
                  <Text style={styles.ageLabel}>Child {i + 1}</Text>
                  <View style={styles.ageStepper}>
                    <StepBtn icon={<Minus size={16} color={Colors.primary} />} disabled={age <= 0} onPress={() => setAge(i, Math.max(0, age - 1))} />
                    <Text style={styles.ageVal}>{age}</Text>
                    <StepBtn icon={<Plus size={16} color={Colors.primary} />} disabled={age >= 17} onPress={() => setAge(i, Math.min(17, age + 1))} />
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <Stepper label="Rooms" value={g.rooms} min={1} max={8} onChange={(v) => update({ rooms: v })} />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Apply" onPress={apply} />
      </View>
    </SafeAreaView>
  );
}

function Stepper({ label, sub, value, min = 0, max = 16, onChange }: { label: string; sub?: string; value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.stepRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepLabel}>{label}</Text>
        {sub ? <Text style={styles.stepSub}>{sub}</Text> : null}
      </View>
      <View style={styles.stepper}>
        <StepBtn icon={<Minus size={18} color={Colors.primary} />} disabled={value <= min} onPress={() => onChange(value - 1)} />
        <Text style={styles.stepVal}>{value}</Text>
        <StepBtn icon={<Plus size={18} color={Colors.primary} />} disabled={value >= max} onPress={() => onChange(value + 1)} />
      </View>
    </View>
  );
}

function StepBtn({ icon, onPress, disabled }: { icon: React.ReactNode; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.stepBtn, disabled && styles.stepBtnDisabled]} hitSlop={6}>
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg },
  stepRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  stepLabel: { ...Typography.titleMd, color: Colors.onSurface },
  stepSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepBtn: { width: 40, height: 40, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  stepBtnDisabled: { opacity: 0.35 },
  stepVal: { ...Typography.titleMd, color: Colors.onSurface, minWidth: 24, textAlign: 'center' },
  agesCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginVertical: Spacing.sm },
  agesTitle: { ...Typography.titleMd, color: Colors.onSurface },
  agesHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  agesGrid: { gap: Spacing.sm },
  ageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ageLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  ageStepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ageVal: { ...Typography.titleMd, color: Colors.onSurface, minWidth: 22, textAlign: 'center' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
