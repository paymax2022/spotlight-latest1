import React from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Building2, ChevronRight, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useMyProperties } from '@/features/stayshotelier/hooks';
import type { HotelierProperty, PropertyStatus } from '@/features/stayshotelier/types';

const STATUS_COLOR: Record<PropertyStatus, string> = {
  DRAFT: Colors.onSurfaceVariant,
  PENDING_REVIEW: Colors.secondary,
  ACTIVE: '#16A34A',
  SUSPENDED: Colors.error,
};

const STATUS_LABEL: Record<PropertyStatus, string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending review',
  ACTIVE: 'Live',
  SUSPENDED: 'Suspended',
};

export default function HostPropertiesScreen() {
  const properties = useMyProperties();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Your properties"
        subtitle="Hotels & shortlets you list on Paymax"
        rightSlot={
          <Pressable onPress={() => router.push('/stays/host/create')} hitSlop={8} accessibilityLabel="List a new property">
            <Plus size={22} color={Colors.primary} strokeWidth={2.2} />
          </Pressable>
        }
      />

      {properties.isLoading ? (
        <StateView kind="loading" message="Loading your properties…" />
      ) : properties.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => properties.refetch()} />
      ) : !properties.data || properties.data.length === 0 ? (
        <StateView
          kind="empty"
          icon="Building2"
          title="No properties yet"
          message="List your first hotel or shortlet apartment to start taking bookings."
          actionLabel="List a property"
          onAction={() => router.push('/stays/host/create')}
        />
      ) : (
        <FlatList
          data={properties.data}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <PropertyRow property={item} />}
          ListFooterComponent={
            <View style={{ marginTop: Spacing.md }}>
              <PrimaryButton label="List another property" onPress={() => router.push('/stays/host/create')} />
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function PropertyRow({ property }: { property: HotelierProperty }) {
  return (
    <Pressable style={styles.row} onPress={() => router.push(`/stays/host/${property.id}/manage`)} accessibilityRole="button">
      <View style={styles.rowIcon}>
        <Building2 size={20} color={Colors.primary} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{property.name}</Text>
        <Text style={styles.rowSub}>{property.city || 'No city set'} · {property.role}</Text>
      </View>
      <View style={[styles.statusPill, { borderColor: STATUS_COLOR[property.status] }]}>
        <Text style={[styles.statusText, { color: STATUS_COLOR[property.status] }]}>{STATUS_LABEL[property.status]}</Text>
      </View>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
  },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
  rowSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  statusPill: { borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  statusText: { ...Typography.labelSm, fontWeight: '600' as const },
});
