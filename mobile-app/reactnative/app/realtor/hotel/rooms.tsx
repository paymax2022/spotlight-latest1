import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useRoomBoard, useSetRoomStatus } from '@/features/realtor/hooks/useRealtorHotel';
import type { RoomStatus, RoomBoardItem } from '@/features/realtor/types/realtor.hotel.types';

const STATUS_COLOR: Record<RoomStatus, { bg: string; fg: string; label: string }> = {
  available: { bg: Colors.iconBgTeal, fg: Colors.tertiaryContainer, label: 'Available' },
  reserved: { bg: Colors.iconBgBlue, fg: Colors.secondary, label: 'Reserved' },
  occupied: { bg: Colors.primaryFixed, fg: Colors.primary, label: 'Occupied' },
  dirty: { bg: Colors.iconBgGold, fg: Colors.onWarning, label: 'Dirty' },
  cleaning: { bg: Colors.iconBgBlue, fg: Colors.secondary, label: 'Cleaning' },
  inspected: { bg: Colors.iconBgTeal, fg: Colors.tertiaryContainer, label: 'Inspected' },
  out_of_service: { bg: Colors.errorContainer, fg: Colors.error, label: 'Out of service' },
};

const NEXT: { value: RoomStatus; label: string }[] = [
  { value: 'available', label: 'Available' }, { value: 'occupied', label: 'Occupied' },
  { value: 'dirty', label: 'Dirty' }, { value: 'cleaning', label: 'Cleaning' },
  { value: 'inspected', label: 'Inspected' }, { value: 'out_of_service', label: 'Out of service' },
];

export default function RoomBoardScreen() {
  const board = useRoomBoard();
  const setStatus = useSetRoomStatus();
  const [active, setActive] = useState<RoomBoardItem | null>(null);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Room status board" subtitle="Tap a room to update" />
      {board.isLoading ? (
        <StateView kind="loading" message="Loading rooms…" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.grid}>
            {(board.data ?? []).map((r) => {
              const c = STATUS_COLOR[r.status];
              return (
                <Pressable key={r.id} style={[styles.room, { backgroundColor: c.bg }]} onPress={() => setActive(r)}>
                  <Text style={[styles.roomNum, { color: c.fg }]}>{r.number}</Text>
                  <Text style={[styles.roomStatus, { color: c.fg }]} numberOfLines={1}>{c.label}</Text>
                  {r.guestName ? <Text style={styles.guest} numberOfLines={1}>{r.guestName}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}

      <Modal visible={!!active} transparent animationType="slide" onRequestClose={() => setActive(null)}>
        <Pressable style={styles.backdrop} onPress={() => setActive(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Room {active?.number} · {active?.roomTypeName}</Text>
            <Pressable onPress={() => setActive(null)} hitSlop={8}><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          <View style={styles.options}>
            {NEXT.map((o) => (
              <Pressable
                key={o.value}
                style={[styles.option, active?.status === o.value && styles.optionActive]}
                onPress={() => { if (active) setStatus.mutate({ roomId: active.id, status: o.value }); setActive(null); }}
              >
                <Text style={[styles.optionText, active?.status === o.value && styles.optionTextActive]}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  room: { width: '31%', flexGrow: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: 2, minHeight: 84, justifyContent: 'center' },
  roomNum: { ...Typography.titleLg },
  roomStatus: { ...Typography.labelSm, fontWeight: '700' as const },
  guest: { ...Typography.caption, color: Colors.onSurfaceVariant },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, gap: Spacing.md },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...Typography.titleMd, color: Colors.onSurface },
  options: { gap: Spacing.sm },
  option: { paddingVertical: 14, paddingHorizontal: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  optionActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  optionText: { ...Typography.bodyMd, color: Colors.onSurface },
  optionTextActive: { color: Colors.primary, fontWeight: '700' as const },
});
