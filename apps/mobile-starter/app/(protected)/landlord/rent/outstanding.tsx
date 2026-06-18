// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const OUTSTANDING = [
  { id: '1', name: 'Amaka Eze', unit: 'B3', amount: 80000, days: 15 },
];

export default function OutstandingPayments() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: '#7a5c1e' }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Outstanding Payments</Text>
        <View style={{ width: 38 }} />
      </View>
      <FlatList
        data={OUTSTANDING}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{item.name.split(' ').map(n => n[0]).join('')}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{item.name}</Text>
                <Text style={styles.listSub}>Unit {item.unit} · {item.days} days overdue</Text>
              </View>
              <Text style={styles.amount}>₦{item.amount.toLocaleString()}</Text>
            </View>
            <View style={styles.cardFooter}>
              <Pressable style={styles.noticeBtn}>
                <Ionicons name="mail-outline" size={14} color={colors.secondary.DEFAULT} />
                <Text style={styles.noticeBtnText}>Send Notice</Text>
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-done-circle-outline" size={48} color={colors.secondary.emerald} />
            <Text style={styles.emptyText}>All tenants are up to date!</Text>
          </View>
        }
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, elevation: 1 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.secondary.red + '20', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '700', color: colors.secondary.red },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '800', color: colors.secondary.red },
  cardFooter: { borderTopWidth: 1, borderTopColor: colors.neutral.border, padding: 10, paddingHorizontal: 14 },
  noticeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end' },
  noticeBtnText: { fontSize: 13, fontWeight: '600', color: colors.secondary.DEFAULT },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 40, alignItems: 'center', gap: 10, marginTop: 20 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
});
