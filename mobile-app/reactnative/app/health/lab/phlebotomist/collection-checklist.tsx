import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Circle, ShieldCheck } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';

import { useChecklist } from '@/features/health/lab/hooks';
import type { CollectionChecklistItem } from '@/features/health/lab/types';

export default function CollectionChecklistScreen() {
  const { orderId, patient } = useLocalSearchParams<{ orderId: string; patient: string }>();
  const checklist = useChecklist(orderId);

  const [items, setItems] = useState<CollectionChecklistItem[]>([]);

  useEffect(() => {
    if (checklist.data) {
      setItems(checklist.data.map((it) => ({ ...it })));
    }
  }, [checklist.data]);

  const toggle = (id: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));
  };

  if (checklist.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Pre-draw checklist" subtitle={patient} />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  if (checklist.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Pre-draw checklist" subtitle={patient} />
        <StateView
          kind="error"
          title="Could not load checklist"
          message="Please try again."
          actionLabel="Retry"
          onAction={() => checklist.refetch()}
        />
      </SafeAreaView>
    );
  }

  const doneCount = items.filter((it) => it.done).length;
  const allRequiredDone = items.filter((it) => it.required).every((it) => it.done);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Pre-draw checklist" subtitle={patient} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.note}>
          <ShieldCheck size={18} color={Colors.teal} />
          <Text style={styles.noteText}>
            Patient ID verification is mandatory before any draw (HL-6). Confirm identity against the order.
          </Text>
        </View>

        <Text style={styles.progress}>
          {doneCount} of {items.length} done
        </Text>

        <View style={styles.list}>
          {items.map((it) => (
            <Pressable key={it.id} style={styles.row} onPress={() => toggle(it.id)}>
              {it.done ? (
                <Check size={22} color={Colors.teal} />
              ) : (
                <Circle size={22} color={Colors.outline} />
              )}
              <Text style={[styles.label, it.done && styles.labelDone]}>{it.label}</Text>
              {it.required && (
                <View
                  style={[
                    styles.tag,
                    { backgroundColor: it.done ? Colors.errorContainer : Colors.errorContainer },
                  ]}
                >
                  <Text style={[styles.tagText, { color: it.done ? Colors.gold : Colors.error }]}>
                    Required
                  </Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>

        <PrimaryButton
          label="Proceed to collection"
          onPress={() =>
            router.push({
              pathname: '/health/lab/phlebotomist/chain-of-custody',
              params: { orderId, patient },
            })
          }
          disabled={!allRequiredDone}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  note: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.tertiaryContainer,
  },
  noteText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  progress: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  list: { gap: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...shadow1,
  },
  label: { ...Typography.bodyLg, color: Colors.onSurface, flex: 1 },
  labelDone: { color: Colors.onSurfaceVariant },
  tag: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full },
  tagText: { ...Typography.labelSm },
});
