// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const ROLES = [
  { id: 'admin', name: 'Admin', desc: 'Full system access', icon: 'shield', color: colors.primary.DEFAULT },
  { id: 'exco', name: 'Exco', desc: 'Executive committee access', icon: 'star', color: '#C5A059' },
  { id: 'manager', name: 'Manager', desc: 'Estate management access', icon: 'briefcase', color: colors.secondary.DEFAULT },
  { id: 'guard', name: 'Guard', desc: 'Security gate access', icon: 'eye', color: colors.secondary.emerald },
  { id: 'resident', name: 'Resident', desc: 'Standard resident access', icon: 'home', color: colors.neutral.textMuted },
  { id: 'vendor', name: 'Vendor', desc: 'Service provider access', icon: 'construct', color: colors.secondary.amber },
];

export default function RolesList() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Roles & Permissions</Text>
        <View style={{ width: 38 }} />
      </View>
      <FlatList
        data={ROLES}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/admin/roles/${item.id}` as never)}>
            <View style={[styles.roleIcon, { backgroundColor: item.color + '20' }]}>
              <Ionicons name={item.icon as any} size={22} color={item.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>{item.name}</Text>
              <Text style={styles.listSub}>{item.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.neutral.placeholder} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  listContent: { padding: 16 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  roleIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
});
