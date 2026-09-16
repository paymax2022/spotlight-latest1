import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Check, KeyRound, PartyPopper } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useMoveIn, useToggleMoveInItem, useActivateOccupancy } from '@/features/realtor/hooks/useRealtorLease';

export default function MoveInScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const moveIn = useMoveIn(String(id));
  const toggle = useToggleMoveInItem(String(id));
  const activate = useActivateOccupancy(String(id));

  if (moveIn.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Move-in" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }
  if (!moveIn.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Move-in" />
        <StateView kind="error" title="Move-in not available" message="Complete payment first." actionLabel="Back" onAction={() => goBack('/realtor')} />
      </SafeAreaView>
    );
  }

  const mi = moveIn.data;
  const allDone = mi.checklist.every((c) => c.done);

  if (mi.occupancyActivated) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.doneBody}>
          <View style={styles.iconBox}>
            <PartyPopper size={44} color={Colors.tertiaryContainer} strokeWidth={1.8} />
          </View>
          <Text style={styles.doneTitle}>Welcome home!</Text>
          <Text style={styles.doneSub}>Your occupancy is active. Rent reminders, maintenance and documents are now in your tenant dashboard.</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Done" onPress={() => router.replace('/realtor')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Move-in checklist" subtitle="Complete to activate occupancy" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {mi.checklist.map((item) => (
          <Pressable
            key={item.id}
            style={styles.item}
            onPress={() => toggle.mutate(item.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.done }}
          >
            <View style={[styles.checkbox, item.done && styles.checkboxOn]}>
              {item.done ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
            </View>
            <Text style={[styles.itemLabel, item.done && styles.itemLabelDone]}>{item.label}</Text>
          </Pressable>
        ))}

        <View style={styles.keyCard}>
          <KeyRound size={18} color={mi.keysHandedOver ? Colors.tertiaryContainer : Colors.outline} strokeWidth={2} />
          <Text style={styles.keyText}>
            {mi.keysHandedOver ? 'Keys collected' : 'Collect keys to finish the checklist'}
          </Text>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton
          label="Activate occupancy"
          onPress={() => activate.mutate()}
          loading={activate.isPending}
          disabled={!allDone}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
  },
  checkbox: {
    width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.tertiaryContainer, borderColor: Colors.tertiaryContainer },
  itemLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  itemLabelDone: { color: Colors.onSurfaceVariant, textDecorationLine: 'line-through' },
  keyCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm,
  },
  keyText: { ...Typography.bodyMd, color: Colors.onSurface },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest,
  },
  doneBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 88, height: 88, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  doneSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
