// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getOrderTracking } from '@/api/restaurant.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { colors } from '@/theme';
import { formatCurrency } from '@/utils/format';

const STATUS_STEPS = [
  { key: 'placed', label: 'Order Placed', icon: 'receipt-outline' },
  { key: 'confirmed', label: 'Confirmed', icon: 'checkmark-circle-outline' },
  { key: 'preparing', label: 'Preparing', icon: 'restaurant-outline' },
  { key: 'picked_up', label: 'Picked Up', icon: 'bicycle-outline' },
  { key: 'delivered', label: 'Delivered', icon: 'home-outline' },
];

const STATUS_ORDER = ['placed', 'confirmed', 'preparing', 'picked_up', 'delivered'];

export default function OrderTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const query = useQuery({
    queryKey: ['order-tracking', id],
    queryFn: () => getOrderTracking(id),
    refetchInterval: 30_000,
  });

  if (query.isLoading) return <AppLoader />;

  const order = query.data;
  const currentStepIdx = order ? STATUS_ORDER.indexOf(order.status) : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.neutral.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Track Order</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} />}
      >
        {!order ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Order not found</Text>
          </View>
        ) : (
          <>
            {/* Status Card */}
            <View style={styles.statusCard}>
              <View style={styles.statusCardTop}>
                <Text style={styles.statusLabel}>Current Status</Text>
                <View style={[styles.statusBadge, { backgroundColor: order.status === 'delivered' ? '#00B89420' : '#0051d520' }]}>
                  <Text style={[styles.statusBadgeText, { color: order.status === 'delivered' ? '#00B894' : '#0051d5' }]}>
                    {order.status.replace('_', ' ').toUpperCase()}
                  </Text>
                </View>
              </View>
              <Text style={styles.restaurantName}>{order.restaurant_name}</Text>
              <Text style={styles.orderMeta}>{order.items_count} items · {formatCurrency(order.total_kobo, 'NGN')}</Text>
              {order.status !== 'delivered' && (
                <View style={styles.etaRow}>
                  <Ionicons name="time-outline" size={16} color={colors.primary.DEFAULT} />
                  <Text style={styles.etaText}>Est. {order.estimated_delivery_min} min remaining</Text>
                </View>
              )}
            </View>

            {/* Progress Steps */}
            <View style={styles.stepsCard}>
              {STATUS_STEPS.map((step, idx) => {
                const isCompleted = idx <= currentStepIdx;
                const isCurrent = idx === currentStepIdx;
                return (
                  <View key={step.key} style={styles.stepRow}>
                    <View style={styles.stepLeft}>
                      <View style={[styles.stepDot, isCompleted && styles.stepDotActive, isCurrent && styles.stepDotCurrent]}>
                        <Ionicons
                          name={isCompleted ? 'checkmark' : step.icon as never}
                          size={14}
                          color={isCompleted ? '#fff' : colors.neutral.placeholder}
                        />
                      </View>
                      {idx < STATUS_STEPS.length - 1 && (
                        <View style={[styles.stepLine, isCompleted && styles.stepLineActive]} />
                      )}
                    </View>
                    <View style={styles.stepContent}>
                      <Text style={[styles.stepLabel, isCompleted && styles.stepLabelActive]}>
                        {step.label}
                      </Text>
                      {isCurrent && <Text style={styles.stepCurrent}>In progress…</Text>}
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Rider Info */}
            {order.rider_name && (
              <View style={styles.riderCard}>
                <View style={styles.riderAvatar}>
                  <Ionicons name="person" size={24} color={colors.primary.DEFAULT} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.riderName}>{order.rider_name}</Text>
                  <Text style={styles.riderLabel}>Your Delivery Rider</Text>
                </View>
                {order.rider_phone && (
                  <Pressable style={styles.callBtn}>
                    <Ionicons name="call-outline" size={20} color={colors.primary.DEFAULT} />
                  </Pressable>
                )}
              </View>
            )}

            {/* Order ID */}
            <View style={styles.orderIdRow}>
              <Text style={styles.orderIdLabel}>Order ID</Text>
              <Text style={styles.orderIdValue}>{id.slice(0, 8).toUpperCase()}</Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.primary.DEFAULT,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 15, color: colors.neutral.textMuted },
  statusCard: {
    backgroundColor: colors.neutral.surface,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  statusCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  statusLabel: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  restaurantName: { fontSize: 18, fontWeight: '800', color: colors.neutral.text, marginBottom: 4 },
  orderMeta: { fontSize: 14, color: colors.neutral.textMuted, marginBottom: 10 },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  etaText: { fontSize: 14, color: colors.primary.DEFAULT, fontWeight: '600' },
  stepsCard: {
    backgroundColor: colors.neutral.surface,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  stepRow: { flexDirection: 'row', gap: 14 },
  stepLeft: { alignItems: 'center', width: 28 },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.neutral.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.neutral.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  stepDotCurrent: { borderColor: colors.secondary.DEFAULT },
  stepLine: { width: 2, flex: 1, minHeight: 24, backgroundColor: colors.neutral.border, marginVertical: 2 },
  stepLineActive: { backgroundColor: colors.primary.DEFAULT },
  stepContent: { flex: 1, paddingBottom: 20 },
  stepLabel: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '500', paddingTop: 4 },
  stepLabelActive: { color: colors.neutral.text, fontWeight: '700' },
  stepCurrent: { fontSize: 12, color: colors.secondary.DEFAULT, marginTop: 2 },
  riderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.neutral.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  riderAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.neutral.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  riderName: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  riderLabel: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.neutral.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderIdRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  orderIdLabel: { fontSize: 13, color: colors.neutral.textMuted },
  orderIdValue: { fontSize: 13, fontWeight: '700', color: colors.neutral.text, fontFamily: 'monospace' },
});
