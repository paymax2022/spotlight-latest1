// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const DOC_CATEGORIES = [
  { key: 'estate_constitution', label: 'Estate Constitution', icon: 'document-text', color: '#7c3aed' },
  { key: 'community_rules', label: 'Community Rules', icon: 'list', color: '#2563eb' },
  { key: 'service_charge', label: 'Service Charge', icon: 'cash-outline', color: '#16a34a' },
  { key: 'meeting_minutes', label: 'Meeting Minutes', icon: 'mic-outline', color: '#d97706' },
  { key: 'election_docs', label: 'Election Docs', icon: 'checkmark-circle-outline', color: '#6d28d9' },
  { key: 'property_docs', label: 'Property Docs', icon: 'home-outline', color: '#0d9488' },
  { key: 'lease_docs', label: 'Lease Docs', icon: 'contract-outline', color: '#f97316' },
  { key: 'payment_receipts', label: 'Payment Receipts', icon: 'receipt-outline', color: '#dc2626' },
];

export default function DocumentHubScreen() {
  const router = useRouter();
  const { data: ctx } = useQuery({ queryKey: ['active-estate-ctx'], queryFn: getActiveEstateContext });
  const estateId = ctx?.estateId ?? '';

  const { data: counts } = useQuery({
    queryKey: ['doc-counts', estateId],
    queryFn: async () => {
      if (!estateId) return {};
      const res = await fetch(`/api/estates/${estateId}/documents/counts`);
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!estateId,
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Documents</Text>
        <Pressable style={s.hBtn} onPress={() => router.push('/documents/upload' as never)}>
          <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.grid}>
          {DOC_CATEGORIES.map((cat) => (
            <Pressable
              key={cat.key}
              style={s.tile}
              onPress={() => router.push(`/documents/category/${cat.key}` as never)}
            >
              <View style={[s.tileIcon, { backgroundColor: cat.color + '22' }]}>
                <Ionicons name={cat.icon} size={28} color={cat.color} />
              </View>
              <Text style={s.tileName} numberOfLines={2}>{cat.label}</Text>
              <Text style={s.tileCount}>{counts?.[cat.key] ?? 0} docs</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 16, paddingBottom: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47%', backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  tileIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tileName: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  tileCount: { fontSize: 11, color: colors.neutral.textMuted },
});
