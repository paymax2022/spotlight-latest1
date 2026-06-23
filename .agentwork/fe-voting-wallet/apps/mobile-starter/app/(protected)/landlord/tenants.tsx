// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const TENANTS = [
  { id: '1', name: 'James Okafor', unit: 'A1', status: 'Paid', nextPayment: 'Jan 1, 2025', phone: '+234 802 111 2222' },
  { id: '2', name: 'Amaka Eze', unit: 'B3', status: 'Overdue', nextPayment: 'Overdue', phone: '+234 803 333 4444' },
];

export default function TenantsList() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: '#7a5c1e' }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>My Tenants</Text>
        <View style={{ width: 38 }} />
      </View>
      <FlatList
        data={TENANTS}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/landlord/tenant/${item.id}` as never)}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{item.name.split(' ').map(n => n[0]).join('')}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>{item.name}</Text>
              <Text style={styles.listSub}>Unit {item.unit} · {item.phone}</Text>
              <Text style={[styles.listSub, { color: item.status === 'Overdue' ? colors.secondary.red : colors.secondary.emerald }]}>
                Next: {item.nextPayment}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: item.status === 'Paid' ? colors.secondary.emerald + '20' : colors.secondary.red + '20' }]}>
              <Text style={[styles.badgeText, { color: item.status === 'Paid' ? colors.secondary.emerald : colors.secondary.red }]}>{item.status}</Text>
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
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#C5A059' + '30', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '700', color: '#C5A059' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
});
