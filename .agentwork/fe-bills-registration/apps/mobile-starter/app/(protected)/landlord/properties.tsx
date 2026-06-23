// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const PROPERTIES = [
  { id: '1', unit: 'A1', type: 'Apartment', tenant: 'James Okafor', rent: 120000, status: 'Paid' },
  { id: '2', unit: 'B3', type: 'Duplex', tenant: 'Amaka Eze', rent: 80000, status: 'Overdue' },
  { id: '3', unit: 'C7', type: 'Shop', tenant: '', rent: 60000, status: 'Vacant' },
];

const statusColor = (s: string) => {
  if (s === 'Paid') return colors.secondary.emerald;
  if (s === 'Overdue') return colors.secondary.red;
  return colors.neutral.textMuted;
};

export default function MyProperties() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: '#7a5c1e' }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>All Properties</Text>
        <View style={{ width: 38 }} />
      </View>
      <FlatList
        data={PROPERTIES}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/landlord/property/${item.id}` as never)}>
            <View style={styles.unitBadge}><Text style={styles.unitText}>{item.unit}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>{item.type}</Text>
              <Text style={styles.listSub}>{item.tenant || 'No tenant'}</Text>
              <Text style={styles.rentText}>₦{item.rent.toLocaleString()}/mo</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <View style={[styles.badge, { backgroundColor: statusColor(item.status) + '20' }]}>
                <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>{item.status}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  listContent: { padding: 16 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  unitBadge: { width: 46, height: 46, borderRadius: 12, backgroundColor: '#C5A059', alignItems: 'center', justifyContent: 'center' },
  unitText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  rentText: { fontSize: 13, fontWeight: '700', color: '#C5A059', marginTop: 4 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
});
