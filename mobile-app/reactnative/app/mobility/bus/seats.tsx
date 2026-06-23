import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Armchair } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useBusSeatMap } from '@/features/mobility/hooks/useModes';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { BusSeat } from '@/features/mobility/types/modes.types';

export default function BusSeatsScreen() {
  const { scheduleId } = useLocalSearchParams<{ scheduleId: string }>();
  const seatMap = useBusSeatMap(scheduleId);
  const [selected, setSelected] = useState<string | null>(null);

  const onContinue = () => {
    if (!selected || !scheduleId) return;
    router.push({ pathname: '/mobility/bus/passenger', params: { scheduleId, seat: selected } });
  };

  // group seats into rows of `columns`
  const rows: BusSeat[][] = [];
  if (seatMap.data) {
    for (let i = 0; i < seatMap.data.seats.length; i += seatMap.data.columns) {
      rows.push(seatMap.data.seats.slice(i, i + seatMap.data.columns));
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Choose your seat" />
      {seatMap.isLoading ? (
        <StateView kind="loading" message="Loading seat map…" />
      ) : seatMap.isError || !seatMap.data ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => seatMap.refetch()} />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <View style={styles.legend}>
              <Legend color={Colors.surfaceContainerLow} border={Colors.outlineVariant} label="Available" />
              <Legend color={Colors.primary} border={Colors.primary} label="Selected" />
              <Legend color={Colors.surfaceContainerHigh} border={Colors.surfaceContainerHigh} label="Taken" />
            </View>

            <View style={styles.busShell}>
              <Text style={styles.driverLabel}>Front · Driver</Text>
              {rows.map((row, ri) => (
                <View key={ri} style={styles.seatRow}>
                  {row.map((seat, ci) => {
                    const isSelected = selected === seat.number;
                    return (
                      <React.Fragment key={seat.number}>
                        <Pressable
                          style={[styles.seat, !seat.available && styles.seatTaken, isSelected && styles.seatSelected]}
                          disabled={!seat.available}
                          onPress={() => setSelected(seat.number)}
                          accessibilityLabel={`Seat ${seat.number}${seat.available ? '' : ' taken'}`}
                        >
                          <Armchair size={18} color={isSelected ? Colors.onPrimary : seat.available ? Colors.onSurfaceVariant : Colors.outline} strokeWidth={2} />
                          <Text style={[styles.seatNum, isSelected && styles.seatNumSelected]}>{seat.number}</Text>
                        </Pressable>
                        {ci === 1 && <View style={styles.aisle} />}
                      </React.Fragment>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>{selected ? `Seat ${selected}` : 'Select a seat'}</Text>
              <Text style={styles.fareValue}>{formatNairaWhole(seatMap.data.fareKobo)}</Text>
            </View>
            <PrimaryButton label="Continue" onPress={onContinue} disabled={!selected} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function Legend({ color, border, label }: { color: string; border: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color, borderColor: border }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5 },
  legendLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  busShell: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.sm },
  driverLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.sm },
  seatRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.sm },
  seat: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  seatTaken: { backgroundColor: Colors.surfaceContainerHigh, borderColor: Colors.surfaceContainerHigh },
  seatSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  seatNum: { ...Typography.caption, color: Colors.onSurfaceVariant },
  seatNumSelected: { color: Colors.onPrimary },
  aisle: { width: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fareLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  fareValue: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const },
});
