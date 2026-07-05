import React from 'react';
import { View, Text, StyleSheet, Image, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Users, BedDouble, Maximize, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useRoomTypes } from '@/features/stays/hooks';
import { formatMoney, formatNairaCompact, usdCentsToNgnKobo } from '@/features/stays/constants/stays.constants';

export default function RoomsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rooms = useRoomTypes(String(id));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Choose a room" subtitle="Compare room types & rate plans" />
      {rooms.isLoading ? (
        <StateView kind="loading" message="Loading rooms…" />
      ) : rooms.isError ? (
        <StateView kind="error" title="Couldn't load rooms" actionLabel="Retry" onAction={() => rooms.refetch()} />
      ) : (rooms.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="BedDouble" title="No rooms available" message="Try different dates." />
      ) : (
        <FlatList
          data={rooms.data}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => {
            const ngnNote = item.currency === 'USD' ? `≈ ${formatNairaCompact(usdCentsToNgnKobo(item.fromPriceMinor))}` : null;
            return (
              <Pressable
                style={styles.card}
                onPress={() => router.push({ pathname: `/stays/property/${id}/rates`, params: { roomTypeId: item.id } })}
              >
                <Image source={{ uri: item.photos[0] }} style={styles.image} />
                <View style={styles.body}>
                  <Text style={styles.name}>{item.name}</Text>
                  <View style={styles.metaRow}>
                    <Meta icon={<Users size={14} color={Colors.onSurfaceVariant} />} label={`Sleeps ${item.maxOccupancy}`} />
                    <Meta icon={<BedDouble size={14} color={Colors.onSurfaceVariant} />} label={item.bedding} />
                    <Meta icon={<Maximize size={14} color={Colors.onSurfaceVariant} />} label={`${item.sizeSqm} m²`} />
                  </View>
                  <View style={styles.priceRow}>
                    <View>
                      <Text style={styles.from}>From</Text>
                      <Text style={styles.price}>{formatMoney(item.fromPriceMinor, item.currency)}</Text>
                      <Text style={styles.perNight}>per night{ngnNote ? `  ·  ${ngnNote}` : ''}</Text>
                    </View>
                    <View style={styles.cta}>
                      <Text style={styles.ctaText}>{item.ratePlans.length} rate plans</Text>
                      <ChevronRight size={18} color={Colors.primary} />
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function Meta({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View style={styles.meta}>
      {icon}
      <Text style={styles.metaText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, paddingTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, overflow: 'hidden', ...shadow1 },
  image: { width: '100%', height: 160, backgroundColor: Colors.surfaceContainerHigh },
  body: { padding: Spacing.md, gap: Spacing.sm },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 4 },
  from: { ...Typography.caption, color: Colors.onSurfaceVariant },
  price: { ...Typography.titleLg, color: Colors.onSurface },
  perNight: { ...Typography.caption, color: Colors.onSurfaceVariant },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ctaText: { ...Typography.labelMd, color: Colors.primary },
});
