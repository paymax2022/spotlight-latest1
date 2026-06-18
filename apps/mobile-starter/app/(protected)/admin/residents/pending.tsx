// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const PENDING = [
  { id: '1', name: 'Chukwuemeka Obi', type: 'Homeowner', estate: 'Green Estate', date: 'Dec 15, 2024' },
  { id: '2', name: 'Amaka Eze', type: 'Tenant', estate: 'Green Estate', date: 'Dec 14, 2024' },
  { id: '3', name: 'Babatunde Adewale', type: 'Resident', estate: 'Green Estate', date: 'Dec 12, 2024' },
];

export default function PendingResidents() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Pending Approvals</Text>
        <View style={{ width: 38 }} />
      </View>
      <FlatList
        data={PENDING}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.name.split(' ').map(n => n[0]).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{item.name}</Text>
                <Text style={styles.listSub}>{item.type} · {item.estate}</Text>
                <Text style={[styles.listSub, { color: colors.neutral.placeholder }]}>Submitted {item.date}</Text>
              </View>
              <Pressable style={styles.docsBtn}>
                <Ionicons name="document-text-outline" size={16} color={colors.secondary.DEFAULT} />
                <Text style={styles.docsBtnText}>Docs</Text>
              </Pressable>
            </View>
            <View style={styles.cardActions}>
              <Pressable style={[styles.actionBtn, { backgroundColor: colors.secondary.emerald + '15', borderColor: colors.secondary.emerald }]}>
                <Ionicons name="checkmark-circle" size={16} color={colors.secondary.emerald} />
                <Text style={[styles.actionBtnText, { color: colors.secondary.emerald }]}>Approve</Text>
              </Pressable>
              <Pressable style={[styles.actionBtn, { backgroundColor: colors.secondary.red + '10', borderColor: colors.secondary.red }]}>
                <Ionicons name="close-circle" size={16} color={colors.secondary.red} />
                <Text style={[styles.actionBtnText, { color: colors.secondary.red }]}>Reject</Text>
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-done-circle-outline" size={48} color={colors.neutral.placeholder} />
            <Text style={styles.emptyText}>No pending approvals</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 16, gap: 0 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.secondary.amber + '20', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '700', color: colors.secondary.amber },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  docsBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.secondary.DEFAULT + '10' },
  docsBtnText: { fontSize: 12, fontWeight: '600', color: colors.secondary.DEFAULT },
  cardActions: { flexDirection: 'row', gap: 10, padding: 14, paddingTop: 0 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  actionBtnText: { fontSize: 13, fontWeight: '700' },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 40, alignItems: 'center', gap: 10, marginTop: 20 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
});
