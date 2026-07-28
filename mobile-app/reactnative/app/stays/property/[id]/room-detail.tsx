import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, FlatList, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Users, BedDouble, Maximize } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useRoomTypes } from '@/features/stays/hooks';
import { formatMoney, BOARD_LABEL } from '@/features/stays/constants/stays.constants';

export default function RoomDetailScreen() {
  const { id, roomTypeId } = useLocalSearchParams<{ id: string; roomTypeId: string }>();
  const rooms = useRoomTypes(String(id));
  const { width } = useWindowDimensions();
  const room = useMemo(() => rooms.data?.find((r) => r.id === roomTypeId) ?? rooms.data?.[0], [rooms.data, roomTypeId]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={room?.name ?? 'Room details'} />
      {rooms.isLoading ? (
        <StateView kind="loading" message="Loading room…" />
      ) : !room ? (
        <StateView kind="error" title="Room not found" actionLabel="Back" onAction={() => router.back()} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <FlatList
              horizontal
              data={room.photos}
              keyExtractor={(u, i) => `${u}-${i}`}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photoRow}
              renderItem={({ item }) => <Image source={{ uri: item }} style={[styles.photo, { width: width - Spacing.containerMargin * 2 }]} />}
              ItemSeparatorComponent={() => <View style={{ width: Spacing.sm }} />}
            />

            <View style={styles.facts}>
              <Fact icon={<Users size={18} color={Colors.primary} />} label="Max occupancy" value={`${room.maxOccupancy} guests`} />
              <Fact icon={<BedDouble size={18} color={Colors.primary} />} label="Bedding" value={room.bedding} />
              <Fact icon={<Maximize size={18} color={Colors.primary} />} label="Room size" value={`${room.sizeSqm} m²`} />
            </View>

            <Text style={styles.sectionTitle}>Rate plans</Text>
            {room.ratePlans.map((rp) => (
              <View key={rp.id} style={styles.planRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planName}>{rp.name}</Text>
                  <Text style={styles.planMeta}>{BOARD_LABEL[rp.board]} · {rp.refundable ? 'Free cancellation' : 'Non-refundable'}</Text>
                </View>
                <Text style={styles.planPrice}>{formatMoney(rp.pricePerNightMinor, rp.currency)}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label="Choose a rate plan"
              onPress={() => router.replace({ pathname: `/stays/property/${id}/rates`, params: { roomTypeId: room.id } })}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <View style={styles.factIcon}>{icon}</View>
      <View>
        <Text style={styles.factLabel}>{label}</Text>
        <Text style={styles.factValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.lg },
  photoRow: { paddingHorizontal: Spacing.containerMargin },
  photo: { height: 220, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerHigh },
  facts: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.md, gap: Spacing.sm },
  fact: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  factIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  factLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  factValue: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  planRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  planName: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
  planMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  planPrice: { ...Typography.titleMd, color: Colors.onSurface },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
