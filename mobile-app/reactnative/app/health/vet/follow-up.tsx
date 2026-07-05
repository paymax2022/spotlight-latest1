import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useVet, useAvailability } from '@/features/health/vet/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';

export default function FollowUpScreen() {
  const { vetId, petId } = useLocalSearchParams<{ vetId: string; petId: string }>();
  const { data: vet, isLoading, isError, refetch } = useVet(vetId);
  const { data: days } = useAvailability(vetId);

  const [slotId, setSlotId] = useState<string | null>(null);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [slotLabel, setSlotLabel] = useState('');

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Follow-up" />
        <StateView kind="loading" message="Loading availability…" />
      </SafeAreaView>
    );
  }
  if (isError || !vet) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Follow-up" />
        <StateView kind="error" title="Couldn't load availability" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  const onContinue = () =>
    router.push({
      pathname: '/health/vet/checkout',
      params: {
        vetId: vet.id,
        petId,
        type: 'tele',
        scheduledFor: slotIso!,
        slotLabel,
        reason: 'Follow-up consult',
        feeKobo: String(vet.consultFeeKobo),
        homeFeeKobo: String(vet.homeVisitFeeKobo),
      },
    });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Book a follow-up" subtitle={vet.name} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.banner}>
          <CalendarCheck size={18} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.bannerText}>Continue care with {vet.name}. Pick a time below.</Text>
        </View>

        {(days ?? []).map((d) => {
          const teleSlots = d.slots.filter((s) => s.type === 'tele');
          if (teleSlots.length === 0) return null;
          return (
            <View key={d.date} style={styles.dayBlock}>
              <Text style={styles.dayLabel}>{d.label}</Text>
              <View style={styles.slotWrap}>
                {teleSlots.map((s) => {
                  const active = slotId === s.id;
                  return (
                    <Pressable
                      key={s.id}
                      disabled={!s.available}
                      onPress={() => {
                        setSlotId(s.id);
                        setSlotIso(s.start);
                        setSlotLabel(`${d.label} · ${s.label}`);
                      }}
                      style={[styles.slot, active && styles.slotActive, !s.available && styles.slotDisabled]}
                    >
                      <Text style={[styles.slotText, active && styles.slotTextActive, !s.available && styles.slotTextDisabled]}>
                        {s.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={`Continue · ${formatNaira(vet.consultFeeKobo)}`} onPress={onContinue} disabled={!slotIso} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.md, padding: Spacing.md },
  bannerText: { ...Typography.bodySm, color: Colors.primary, flex: 1 },
  dayBlock: { gap: Spacing.sm },
  dayLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  slotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  slot: { paddingHorizontal: Spacing.md, paddingVertical: 10, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow },
  slotActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  slotDisabled: { opacity: 0.4 },
  slotText: { ...Typography.labelMd, color: Colors.onSurface },
  slotTextActive: { color: Colors.secondary },
  slotTextDisabled: { color: Colors.onSurfaceVariant, textDecorationLine: 'line-through' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
