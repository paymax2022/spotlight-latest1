// @ts-nocheck
// Property / unit selection and switcher
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listProperties } from '@/api/estate.api';
import { AppLoader } from '@/components/ui/AppLoader';
import {
  getActiveEstateContext,
  setActiveProperty,
} from '@/features/estate/estateContext';
import { colors } from '@/theme';

const OCCUPANCY_COLOR: Record<string, string> = {
  vacant: '#94a3b8',
  occupied: '#00B894',
  reserved: '#F39C12',
};

const TYPE_ICON: Record<string, string> = {
  apartment: 'business-outline',
  house: 'home-outline',
  commercial: 'storefront-outline',
  land: 'map-outline',
  other: 'cube-outline',
};

export default function PropertiesScreen() {
  const router = useRouter();

  const activeContext = useQuery({
    queryKey: ['active-estate-context'],
    queryFn: getActiveEstateContext,
  });

  const estateId = activeContext.data?.estateId;

  const properties = useQuery({
    queryKey: ['estate-properties', estateId],
    queryFn: () => listProperties(estateId!),
    enabled: Boolean(estateId),
    retry: false,
  });

  if (activeContext.isLoading || properties.isLoading) return <AppLoader />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Properties & Units</Text>
        <Pressable
          style={styles.addBtn}
          onPress={() =>
            router.push({
              pathname: '/estate/properties/add',
              params: estateId ? { estateId } : undefined,
            } as never)
          }
        >
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      <FlatList
        data={properties.data ?? []}
        keyExtractor={(p) => p.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={properties.isRefetching}
            onRefresh={properties.refetch}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="home-outline" size={52} color={colors.neutral.placeholder} />
            <Text style={styles.emptyTitle}>
              {estateId ? 'No properties yet' : 'Choose an estate first'}
            </Text>
            <Pressable
              style={styles.emptyBtn}
              onPress={() =>
                estateId
                  ? router.push({
                      pathname: '/estate/properties/add',
                      params: { estateId },
                    } as never)
                  : router.push('/estate/switcher' as never)
              }
            >
              <Text style={styles.emptyBtnText}>
                {estateId ? 'Add a Property' : 'Switch Estate'}
              </Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => {
          const oColor = OCCUPANCY_COLOR[item.occupancy_status] ?? '#94a3b8';
          return (
            <Pressable
              style={({ pressed }) => [styles.propCard, pressed && { opacity: 0.85 }]}
              onPress={async () => {
                await setActiveProperty(item.id, item.unit_label);
                router.replace('/estate' as never);
              }}
            >
              <View style={[styles.propIcon, { backgroundColor: colors.primary.DEFAULT + '15' }]}>
                <Ionicons name={(TYPE_ICON[item.property_type] ?? 'home-outline') as never} size={22} color={colors.primary.DEFAULT} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.propUnit}>{item.unit_label}</Text>
                <Text style={styles.propMeta}>
                  {item.property_type}
                  {item.block ? ` · Block ${item.block}` : ''}
                  {item.floor ? ` · Floor ${item.floor}` : ''}
                </Text>
              </View>
              <View style={[styles.occupancyBadge, { backgroundColor: oColor + '20' }]}>
                <Text style={[styles.occupancyText, { color: oColor }]}>{item.occupancy_status}</Text>
              </View>
              <View style={styles.actionColumn}>
                <Pressable
                  style={styles.iconAction}
                  onPress={() =>
                    router.push({
                      pathname: '/estate/properties/claim',
                      params: { estateId, propertyId: item.id, unitLabel: item.unit_label },
                    } as never)
                  }
                >
                  <Ionicons name="ribbon-outline" size={16} color={colors.primary.DEFAULT} />
                </Pressable>
                <Pressable
                  style={styles.iconAction}
                  onPress={() =>
                    router.push({
                      pathname: '/estate/properties/tenancy',
                      params: { estateId, propertyId: item.id, unitLabel: item.unit_label },
                    } as never)
                  }
                >
                  <Ionicons name="person-add-outline" size={16} color={colors.secondary.DEFAULT} />
                </Pressable>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  addBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  propCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  propIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  propUnit: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  propMeta: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2, textTransform: 'capitalize' },
  occupancyBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  occupancyText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  actionColumn: { gap: 6 },
  iconAction: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.neutral.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 16, color: colors.neutral.textMuted, fontWeight: '500' },
  emptyBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10 },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
