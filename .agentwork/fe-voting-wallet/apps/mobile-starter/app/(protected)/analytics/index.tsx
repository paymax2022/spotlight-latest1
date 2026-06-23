// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const CATEGORIES = [
  { title: 'Residents', icon: 'people', route: '/analytics/residents', updated: '5m ago', color: colors.primary.DEFAULT },
  { title: 'Visitors', icon: 'walk', route: '/analytics/visitors', updated: '10m ago', color: colors.secondary.DEFAULT },
  { title: 'Gate Activity', icon: 'shield', route: '/analytics/gate', updated: '2m ago', color: colors.secondary.emerald },
  { title: 'Payments', icon: 'cash', route: '/analytics/payments', updated: '15m ago', color: '#C5A059' },
  { title: 'Repairs', icon: 'construct', route: '/analytics/repairs', updated: '1h ago', color: colors.secondary.amber },
  { title: 'Facilities', icon: 'business', route: '/analytics/facilities', updated: '30m ago', color: '#7c3aed' },
  { title: 'Security', icon: 'alert-circle', route: '/analytics/security', updated: '8m ago', color: colors.secondary.red },
  { title: 'Vendors', icon: 'briefcase', route: '/analytics/vendor', updated: '2h ago', color: '#0891b2' },
];

export default function AnalyticsHub() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Analytics</Text>
        <View style={{ width: 38 }} />
      </View>
      <FlatList
        data={CATEGORIES}
        keyExtractor={i => i.title}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(item.route as never)}>
            <View style={[styles.iconWrap, { backgroundColor: item.color + '15' }]}>
              <Ionicons name={item.icon as any} size={24} color={item.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>{item.title}</Text>
              <Text style={styles.listSub}>Updated {item.updated}</Text>
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  iconWrap: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
});
