import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Phone, Clock, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { formatDate, relativeTime } from '@/features/health/constants/health.constants';
import LabStatusPill from '@/features/health/lab/components/LabStatusPill';
import CredentialBadge from '@/features/health/components/CredentialBadge';
import { useOrder, usePhlebotomist } from '@/features/health/lab/hooks';

const VISIT_STATUS_LABEL = {
  assigned: 'Assigned',
  en_route: 'On the way',
  arrived: 'Arrived',
  collected: 'Collected',
  dropped_off: 'At the lab',
} as const;

export default function PhlebotomistTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderQ = useOrder(id);
  const phlebQ = usePhlebotomist(id);

  const loading = orderQ.isLoading || phlebQ.isLoading;
  const error = orderQ.isError || phlebQ.isError;
  const order = orderQ.data;
  const phleb = phlebQ.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Live tracking" subtitle="Phlebotomist on the way" />
      {loading ? (
        <StateView kind="loading" title="Locating phlebotomist…" />
      ) : error || !order ? (
        <StateView
          kind="error"
          title="Couldn't load tracking"
          message="We couldn't reach the live tracking service. Please try again."
          actionLabel="Retry"
          onAction={() => {
            orderQ.refetch();
            phlebQ.refetch();
          }}
        />
      ) : !phleb ? (
        <StateView
          kind="empty"
          icon="Clock"
          title="Phlebotomist not assigned yet"
          message="You'll see who is collecting your sample here as soon as the lab assigns someone."
          actionLabel="View collection details"
          onAction={() => router.push({ pathname: '/health/lab/test-status', params: { id: order.id } })}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.etaRow}>
            <View style={styles.etaCard}>
              <Clock size={18} color={Colors.teal} strokeWidth={2.2} />
              <Text style={styles.etaValue}>{VISIT_STATUS_LABEL[phleb.status]}</Text>
              <Text style={styles.etaLabel}>
                {phleb.locationAt ? `Last seen ${relativeTime(phleb.locationAt)}` : 'Location not shared'}
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.phlebRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {phleb.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.phlebName}>{phleb.name}</Text>
              </View>
            </View>
            {phleb.credential ? (
              <View style={styles.badgeWrap}>
                <CredentialBadge credential={phleb.credential} showLicense />
              </View>
            ) : null}

            {phleb.phone ? (
            <Pressable
              style={styles.callRow}
              accessibilityRole="button"
              accessibilityLabel={`Call ${phleb.name}`}
              onPress={() => Linking.openURL(`tel:${phleb.phone}`)}
            >
              <View style={styles.callIcon}>
                <Phone size={18} color={Colors.teal} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.callLabel}>Call phlebotomist</Text>
                <Text style={styles.callValue}>{phleb.phone}</Text>
              </View>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} />
            </Pressable>
            ) : null}
          </View>

          <View style={styles.card}>
            <View style={styles.statusHead}>
              <Text style={styles.cardTitle}>Order status</Text>
              <LabStatusPill status={order.status} />
            </View>
            <Text style={styles.metaLabel}>Scheduled window</Text>
            <Text style={styles.metaValue}>
              {order.scheduledFor ? formatDate(order.scheduledFor) : 'To be confirmed'}
            </Text>
            <Text style={[styles.metaLabel, { marginTop: Spacing.md }]}>Collection at</Text>
            <Text style={styles.metaValue}>{order.location}</Text>
          </View>

          <PrimaryButton
            label="View collection details"
            onPress={() =>
              router.push({ pathname: '/health/lab/test-status', params: { id: order.id } })
            }
            variant="secondary"
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xl },
  etaRow: { flexDirection: 'row', gap: Spacing.md },
  etaCard: {
    flex: 1,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
    ...shadow1,
  },
  etaValue: { ...Typography.titleMd, color: Colors.onSurface },
  etaLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    gap: Spacing.sm,
  },
  phlebRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...Typography.titleMd, color: Colors.teal },
  phlebName: { ...Typography.titleMd, color: Colors.onSurface },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 2 },
  ratingText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  badgeWrap: { flexDirection: 'row' },
  callRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.xs,
  },
  callIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callLabel: { ...Typography.labelMd, color: Colors.onSurface },
  callValue: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  statusHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  metaLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  metaValue: { ...Typography.bodyMd, color: Colors.onSurface },
});
