import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { FileText, Upload, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PharmacyStatusPill from '@/features/health/components/PharmacyStatusPill';
import { usePrescriptions } from '@/features/health/pharmacy/hooks';
import { formatDate } from '@/features/health/constants/health.constants';

export default function RxWalletScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = usePrescriptions();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Rx wallet"
        subtitle="Your prescriptions"
        rightSlot={
          <Pressable onPress={() => router.push('/health/pharmacy/upload-rx')} hitSlop={8} accessibilityLabel="Upload prescription">
            <Upload size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
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
          renderItem={({ item }) => (
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
                </View>
              </View>
              <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
            </Pressable>
          )}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="FileText"
              title="No prescriptions yet"
              message="Upload a prescription to get started."
              actionLabel="Upload prescription"
              onAction={() => router.push('/health/pharmacy/upload-rx')}
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
  pillRow: { flexDirection: 'row', marginTop: 2 },
});
