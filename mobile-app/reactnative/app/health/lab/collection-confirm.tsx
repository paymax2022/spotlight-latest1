import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CircleCheck, MapPin, Calendar, QrCode, Droplet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { formatDate } from '@/features/health/constants/health.constants';
import { useOrder } from '@/features/health/lab/hooks';

export default function CollectionConfirmScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderQ = useOrder(id);
  const order = orderQ.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Booking confirmed" />
      {orderQ.isLoading ? (
        <StateView kind="loading" title="Confirming your booking…" />
      ) : orderQ.isError || !order ? (
        <StateView
          kind="error"
          title="Couldn't load booking"
          message="We couldn't confirm your booking just now. Please try again."
          actionLabel="Retry"
          onAction={() => orderQ.refetch()}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <CircleCheck size={48} color={Colors.teal} strokeWidth={2} />
            </View>
            <Text style={styles.heroTitle}>You're booked</Text>
            <Text style={styles.heroSub}>
              Your walk-in collection at {order.labName} is confirmed. Arrive within your scheduled
              window with a valid ID.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <MapPin size={18} color={Colors.primary} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoLabel}>Collection site</Text>
                <Text style={styles.infoValue}>{order.labName}</Text>
                <Text style={styles.infoValueSub}>{order.location}</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Calendar size={18} color={Colors.teal} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoLabel}>Scheduled for</Text>
                <Text style={styles.infoValue}>
                  {order.scheduledFor ? formatDate(order.scheduledFor) : 'Anytime during opening hours'}
                </Text>
              </View>
            </View>
            {order.sampleBarcode ? (
              <>
                <View style={styles.divider} />
                <View style={styles.infoRow}>
                  <View style={styles.infoIcon}>
                    <QrCode size={18} color={Colors.onSurface} strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoLabel}>Sample barcode</Text>
                    <Text style={styles.barcode}>{order.sampleBarcode}</Text>
                  </View>
                </View>
              </>
            ) : null}
          </View>

          <View style={styles.prepCard}>
            <Droplet size={18} color={Colors.onWarning} strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.prepTitle}>Preparation reminder</Text>
              <Text style={styles.prepText}>
                If any of your tests require fasting, avoid food and sugary drinks for 8–12 hours
                beforehand. Water is fine.
              </Text>
            </View>
          </View>

          <View style={styles.actions}>
            <PrimaryButton
              label="Track status"
              onPress={() =>
                router.replace({ pathname: '/health/lab/test-status', params: { id: order.id } })
              }
            />
            <PrimaryButton
              label="Back to Lab home"
              variant="ghost"
              onPress={() => router.replace('/health/lab')}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xl },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  heroIcon: {
    width: 88,
    height: 88,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', paddingHorizontal: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    gap: Spacing.md,
  },
  infoRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  infoValue: { ...Typography.titleMd, color: Colors.onSurface },
  infoValueSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  barcode: { ...Typography.titleMd, color: Colors.onSurface, letterSpacing: 2 },
  divider: { height: 1, backgroundColor: Colors.outlineVariant },
  prepCard: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.gold,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    alignItems: 'flex-start',
  },
  prepTitle: { ...Typography.labelLg, color: Colors.onWarning },
  prepText: { ...Typography.bodySm, color: Colors.onWarning, marginTop: 2 },
  actions: { gap: Spacing.sm, marginTop: Spacing.xs },
});
