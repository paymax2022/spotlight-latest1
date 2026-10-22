import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RefreshCw, MessageCircle, ChevronRight, Calendar } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useRefills } from '@/features/health/pharmacy/hooks';
import { formatDate } from '@/features/health/constants/health.constants';

/**
 * Refills (DP-004). A refill is authority written on the e-Rx by the prescriber and
 * spent by the pharmacist at the counter — there is no patient-side "schedule a
 * refill" or auto-delivery on this platform, so this screen reports what is left on
 * each prescription and how to ask for it.
 */
export default function RefillsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useRefills();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Refills" subtitle="Repeat permission on your e-Rx" />

      {isLoading ? (
        <StateView kind="loading" message="Loading refills…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(r) => r.rxId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListHeaderComponent={
            <View style={styles.explainer}>
              <RefreshCw size={14} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.explainerText}>
                A refill is released by a pharmacist when you present the prescription — at the counter or through a
                chat. Nothing is scheduled automatically.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const left = Math.max(0, item.refillsAuthorized - item.refillsUsed);
            return (
              <View style={[styles.card, shadow1]}>
                <Pressable
                  style={styles.head}
                  onPress={() => router.push({ pathname: '/health/pharmacy/rx-status', params: { id: item.rxId } })}
                  accessibilityRole="button"
                  accessibilityLabel="Open prescription"
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.drugs.join(' · ') || 'Prescription'}</Text>
                    <Text style={styles.counter}>
                      {left} of {item.refillsAuthorized} refill{item.refillsAuthorized > 1 ? 's' : ''} remaining
                    </Text>
                    {item.lastDispensedAt ? (
                      <View style={styles.lastRow}>
                        <Calendar size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                        <Text style={styles.last}>Last dispensed {formatDate(item.lastDispensedAt)}</Text>
                      </View>
                    ) : null}
                  </View>
                  <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                </Pressable>

                <Pressable style={styles.askBtn} onPress={() => router.push('/health/pharmacy/pharmacist-consult')}>
                  <MessageCircle size={16} color={Colors.secondary} strokeWidth={2} />
                  <Text style={styles.askText}>Ask a pharmacist about this refill</Text>
                </Pressable>
              </View>
            );
          }}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="RefreshCw"
              title="No refills available"
              message="A refill appears when a doctor writes repeat permission on one of your prescriptions. Your current ones have none left, or none authorized."
              actionLabel="View my prescriptions"
              onAction={() => router.replace('/health/pharmacy/rx-wallet')}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 100, flexGrow: 1 },
  explainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  explainerText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  counter: { ...Typography.labelMd, color: Colors.teal, marginTop: 2 },
  lastRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  last: { ...Typography.caption, color: Colors.onSurfaceVariant },
  askBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1.5,
    borderColor: Colors.secondary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.sm + 2,
  },
  askText: { ...Typography.labelMd, color: Colors.secondary },
});
