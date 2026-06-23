// @ts-nocheck
// Multiple estate / property switcher — lets a user pick which estate context to use
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listEstates } from '@/api/estate.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { getActiveEstateContext, setActiveEstate } from '@/features/estate/estateContext';
import { colors } from '@/theme';

// In production this would filter to "my estates" via a separate endpoint.
// For now we list all and the user selects which one to use as active context.

export default function EstateSwitcherScreen() {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeContext = useQuery({
    queryKey: ['active-estate-context'],
    queryFn: getActiveEstateContext,
  });

  const estates = useQuery({
    queryKey: ['my-estates'],
    queryFn: () => listEstates(),
    retry: false,
  });

  if (estates.isLoading || activeContext.isLoading) return <AppLoader />;

  const data = estates.data ?? [];
  const selectedId = activeId ?? activeContext.data?.estateId ?? null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Switch Estate</Text>
        <View style={{ width: 38 }} />
      </View>

      <FlatList
        data={data}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="home-outline" size={52} color={colors.neutral.placeholder} />
            <Text style={styles.emptyTitle}>No estates joined yet</Text>
            <Pressable
              style={styles.joinBtn}
              onPress={() => router.push('/estate/join' as never)}
            >
              <Text style={styles.joinBtnText}>Find & Join an Estate</Text>
            </Pressable>
          </View>
        }
        ListFooterComponent={
          data.length > 0 ? (
            <Pressable
              style={styles.addEstateRow}
              onPress={() => router.push('/estate/join' as never)}
            >
              <Ionicons name="add-circle-outline" size={22} color={colors.secondary.DEFAULT} />
              <Text style={styles.addEstateText}>Join Another Estate</Text>
            </Pressable>
          ) : null
        }
        renderItem={({ item }) => {
          const isActive = selectedId === item.id;
          return (
            <Pressable
              style={[styles.estateRow, isActive && styles.estateRowActive]}
              onPress={async () => {
                setActiveId(item.id);
                await setActiveEstate(item.id, item.name);
                setTimeout(() => router.replace('/estate' as never), 300);
              }}
            >
              <View style={[styles.estateIcon, isActive && { backgroundColor: colors.primary.DEFAULT }]}>
                <Ionicons name="home" size={20} color={isActive ? '#fff' : colors.primary.DEFAULT} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.estateName, isActive && { color: colors.primary.DEFAULT }]}>
                  {item.name}
                </Text>
                {item.address ? (
                  <Text style={styles.estateAddress} numberOfLines={1}>{item.address}</Text>
                ) : null}
              </View>
              {isActive && (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary.DEFAULT} />
              )}
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
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  estateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: colors.neutral.border,
  },
  estateRowActive: { borderColor: colors.primary.DEFAULT, backgroundColor: colors.primary.DEFAULT + '08' },
  estateIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: colors.primary.DEFAULT + '15', alignItems: 'center', justifyContent: 'center',
  },
  estateName: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  estateAddress: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  addEstateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 16, borderRadius: 14, marginTop: 4,
  },
  addEstateText: { fontSize: 15, fontWeight: '600', color: colors.secondary.DEFAULT },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 14 },
  emptyTitle: { fontSize: 16, color: colors.neutral.textMuted, fontWeight: '500' },
  joinBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10 },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
