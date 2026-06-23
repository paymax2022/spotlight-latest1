import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Car, LogIn, LogOut } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { VisitorColors } from '@/features/visitor/constants/visitor.constants';
import { useVehicleEntries } from '@/features/visitor/hooks/useVisitor';
import { formatDateTime } from '@/features/visitor/utils/visitorFormatters';
import type { VisitEvent } from '@/features/visitor/types/visitor.types';

export default function VehicleLogScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useVehicleEntries();

  const renderItem = ({ item }: { item: VisitEvent }) => {
    const isIn = item.action === 'check_in';
    return (
      <View style={styles.card}>
        <View style={styles.plateBox}>
          <Car size={16} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
          <Text style={styles.plate}>{item.capturedPlate}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{item.visitorName}</Text>
          <Text style={styles.meta} numberOfLines={1}>{item.unitLabel} · {formatDateTime(item.timestamp)}</Text>
        </View>
        <View style={[styles.dirPill, { backgroundColor: isIn ? VisitorColors.successBg : Colors.iconBgBlue }]}>
          {isIn ? <LogIn size={14} color={VisitorColors.success} /> : <LogOut size={14} color={Colors.secondary} />}
          <Text style={[styles.dirText, { color: isIn ? VisitorColors.success : Colors.secondary }]}>{isIn ? 'In' : 'Out'}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Vehicle log" subtitle="Plates at the gate" />
      {isLoading ? (
        <StateView kind="loading" message="Loading vehicle log…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(e) => e.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={isRefetching}
          onRefresh={refetch}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          ListEmptyComponent={<StateView kind="empty" icon="Car" title="No vehicle entries" message="Captured plates will appear here." />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  plateBox: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.surfaceContainer, borderRadius: Radius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  plate: { ...Typography.labelMd, color: Colors.onSurface, letterSpacing: 0.5 },
  name: { ...Typography.labelMd, color: Colors.onSurface },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  dirPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full },
  dirText: { ...Typography.labelSm, fontWeight: '700' },
});
