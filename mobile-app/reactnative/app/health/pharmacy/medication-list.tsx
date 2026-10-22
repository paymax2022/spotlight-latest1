import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Pill, RefreshCw, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PharmacyStatusPill from '@/features/health/components/PharmacyStatusPill';
import { useMedications } from '@/features/health/pharmacy/hooks';

/**
 * The patient's medicine list, derived from their own e-Rxs (getMedications reads
 * prescriptions + refill counters). The backend tracks neither adherence nor days
 * of supply, so this screen reports only what a prescription actually states:
 * the drug, the prescriber's directions, its verification state and the refills
 * still authorized on it (DP-004).
 */
export default function MedicationListScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useMedications();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="My medications"
        subtitle="From your prescriptions"
        rightSlot={
          <Pressable onPress={() => router.push('/health/pharmacy/refills')} hitSlop={8} accessibilityLabel="Refills">
            <RefreshCw size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading medications…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListHeaderComponent={
            <Text style={styles.note}>
              Everything here comes from a prescription a doctor issued you. Tap a medicine for its full details.
            </Text>
          }
          renderItem={({ item }) => {
            const refillsLeft = Math.max(0, item.refillsAuthorized - item.refillsUsed);
            return (
              <Pressable
                style={[styles.card, shadow1]}
                onPress={() => router.push({ pathname: '/health/pharmacy/rx-status', params: { id: item.rxId } })}
              >
                <View style={styles.head}>
                  <View style={[styles.icon, { backgroundColor: Colors.iconBgBlue }]}>
                    <Pill size={20} color={Colors.secondary} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.name}</Text>
                    {item.schedule ? <Text style={styles.schedule}>{item.schedule}</Text> : null}
                  </View>
                  <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                </View>

                <View style={styles.footerRow}>
                  <PharmacyStatusPill rx={item.status} />
                  <Text style={styles.refills}>
                    {refillsLeft > 0
                      ? `${refillsLeft} refill${refillsLeft > 1 ? 's' : ''} authorized`
                      : item.refillsAuthorized > 0
                        ? 'No refills left'
                        : 'One-time prescription'}
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="Pill"
              title="No medications yet"
              message="Medicines appear here once a doctor issues you an e-Rx. Book a consult to get one."
              actionLabel="Book a consult"
              onAction={() => router.push('/services/telemedicine/book')}
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
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs, lineHeight: 19 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  schedule: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  refills: { ...Typography.labelSm, color: Colors.teal },
});
