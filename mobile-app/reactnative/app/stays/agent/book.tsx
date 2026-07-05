import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Percent, ChevronRight, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useAgentBookings } from '@/features/stays/agent';
import { formatNaira, formatStayRange, StaysColors } from '@/features/stays/constants/stays.constants';

/** Agent: booking book / history (PRD §20.7). */
export default function AgentBookingsScreen() {
  const bookings = useAgentBookings();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Agent bookings"
        subtitle="Your assisted bookings"
        rightSlot={
          <Pressable onPress={() => router.push('/stays/agent/customer-lookup')} hitSlop={8} accessibilityLabel="New booking">
            <Plus size={22} color={Colors.onSurface} />
          </Pressable>
        }
      />
      {bookings.isLoading ? (
        <StateView kind="loading" message="Loading bookings…" />
      ) : bookings.isError ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => bookings.refetch()} />
      ) : (bookings.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="BookOpen" title="No bookings yet" message="Start an assisted booking for a customer." actionLabel="New booking" onAction={() => router.push('/stays/agent/customer-lookup')} />
      ) : (
        <FlatList
          data={bookings.data}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          renderItem={({ item }) => {
            const cancelled = item.status === 'CANCELLED';
            return (
              <Pressable style={styles.card} onPress={() => router.push({ pathname: '/stays/agent/cancel-refund', params: { id: item.id } })}>
                <View style={{ flex: 1 }}>
                  <View style={styles.topRow}>
                    <View style={[styles.badge, cancelled ? styles.badgeCancel : styles.badgeOk]}>
                      <Text style={[styles.badgeText, { color: cancelled ? Colors.error : StaysColors.ok }]}>{cancelled ? 'Cancelled' : 'Confirmed'}</Text>
                    </View>
                    <Text style={styles.ref}>{item.reference}</Text>
                  </View>
                  <Text style={styles.name} numberOfLines={1}>{item.propertyName}</Text>
                  <Text style={styles.line} numberOfLines={1}>{item.customerName} · {item.city}</Text>
                  <Text style={styles.line}>{formatStayRange(item.checkIn, item.checkOut)}</Text>
                  <View style={styles.footRow}>
                    <Text style={styles.total}>{formatNaira(item.totalKobo)}</Text>
                    <View style={styles.commChip}>
                      <Percent size={11} color={Colors.primary} />
                      <Text style={styles.commText}>{formatNaira(item.commissionKobo)}</Text>
                    </View>
                  </View>
                </View>
                <ChevronRight size={18} color={Colors.onSurfaceVariant} />
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, paddingTop: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeOk: { backgroundColor: Colors.iconBgTeal },
  badgeCancel: { backgroundColor: Colors.errorContainer },
  badgeText: { ...Typography.caption, fontWeight: '700' as const },
  ref: { ...Typography.caption, color: Colors.onSurfaceVariant },
  name: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 2 },
  line: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  total: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  commChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  commText: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const },
});
