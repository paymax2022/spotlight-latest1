import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { FileText, Send, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PharmacyStatusPill from '@/features/health/components/PharmacyStatusPill';
import { usePrescriptions } from '@/features/health/pharmacy/hooks';
import { formatDate } from '@/features/health/constants/health.constants';

export default function RxWalletScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = usePrescriptions();
  const hasIssued = (data ?? []).some((r) => r.status === 'issued');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Rx wallet"
        subtitle="Your prescriptions"
        rightSlot={
          hasIssued ? (
            <Pressable onPress={() => router.push('/health/pharmacy/send-rx')} hitSlop={8} accessibilityLabel="Send an e-Rx to a pharmacy">
              <Send size={20} color={Colors.primary} strokeWidth={2} />
            </Pressable>
          ) : null
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading prescriptions…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderItem={({ item }) => {
            const refillsLeft = Math.max(0, (item.refillsAuthorized ?? 0) - (item.refillsUsed ?? 0));
            return (
              <Pressable
                style={[styles.card, shadow1]}
                onPress={() => router.push({ pathname: '/health/pharmacy/rx-status', params: { id: item.id } })}
              >
                <View style={[styles.thumb, { backgroundColor: item.docColor }]}>
                  <FileText size={20} color={Colors.secondary} strokeWidth={2} />
                </View>
                <View style={styles.body}>
                  <Text style={styles.title} numberOfLines={1}>
                    {item.items.length > 0 ? item.items[0].name : 'Prescription'}
                    {item.items.length > 1 ? ` +${item.items.length - 1}` : ''}
                  </Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {item.patientName} · {formatDate(item.uploadedAt)}
                  </Text>
                  <View style={styles.pillRow}>
                    <PharmacyStatusPill rx={item.status} />
                    {refillsLeft > 0 ? (
                      <Text style={styles.refills}>{refillsLeft} refill{refillsLeft > 1 ? 's' : ''} left</Text>
                    ) : null}
                  </View>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            // There is no patient-side prescription upload: an e-Rx is a clinician's
            // document, issued from a consult. Offering "upload" here would only
            // dead-end at a pharmacist who cannot verify an unverifiable photo.
            <StateView
              kind="empty"
              icon="FileText"
              title="No prescriptions yet"
              message="A doctor issues an e-Rx after a consult. It lands here automatically, then you send it to a pharmacy."
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
  list: { padding: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 100, flexGrow: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  thumb: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 3 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  refills: { ...Typography.caption, color: Colors.teal },
});
