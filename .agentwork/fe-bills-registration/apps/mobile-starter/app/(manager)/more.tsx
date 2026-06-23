// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const ACTIONS = [
  { label: 'Documents',     icon: 'document-text-outline', route: '/documents',     color: colors.secondary.DEFAULT },
  { label: 'Analytics',    icon: 'bar-chart-outline',     route: '/analytics',     color: colors.primary.DEFAULT },
  { label: 'Announcements',icon: 'megaphone-outline',     route: '/announcements', color: '#7c3aed' },
  { label: 'Emergency',    icon: 'warning-outline',       route: '/emergency',     color: colors.secondary.red },
  { label: 'Settings',     icon: 'settings-outline',      route: '/settings',      color: '#64748b' },
  { label: 'Admin',        icon: 'shield-checkmark-outline', route: '/admin',      color: '#0891b2' },
  { label: 'Support',      icon: 'headset-outline',       route: '/support',       color: colors.secondary.emerald },
  { label: 'Logout',       icon: 'log-out-outline',       route: null,             color: colors.secondary.red },
];

export default function ManagerMore() {
  const router = useRouter();

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>More</Text>
      </View>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.grid}>
          {ACTIONS.map(action => (
            <Pressable
              key={action.label}
              style={s.gridItem}
              onPress={() => {
                if (!action.route) { router.replace('/' as never); return; }
                router.push(action.route as never);
              }}
            >
              <View style={[s.iconBox, { backgroundColor: `${action.color}18` }]}>
                <Ionicons name={action.icon as any} size={26} color={action.color} />
              </View>
              <Text style={s.actionLabel}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.background },
  header: { paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  headerTitle: { fontSize: 22, fontWeight: '700', color: colors.neutral.text },
  body: { padding: 16, paddingBottom: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { width: '47%', backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 18, alignItems: 'center', borderWidth: 1, borderColor: colors.neutral.border },
  iconBox: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  actionLabel: { fontSize: 13, fontWeight: '600', color: colors.neutral.text, textAlign: 'center' },
});
