// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppText } from '@/components/ui/AppText';

const USER_TYPES = [
  {
    key: 'resident',
    label: 'Resident',
    description: 'Living in the estate',
    icon: 'person' as const,
    iconColor: colors.primary.DEFAULT,
    route: '/(auth)/signup/resident',
  },
  {
    key: 'homeowner',
    label: 'Homeowner',
    description: 'Own property here',
    icon: 'home' as const,
    iconColor: '#0051d5',
    route: '/(auth)/signup/homeowner',
  },
  {
    key: 'tenant',
    label: 'Tenant',
    description: 'Renting a property',
    icon: 'key' as const,
    iconColor: '#14b8a6',
    route: '/(auth)/signup/tenant',
  },
  {
    key: 'admin',
    label: 'Estate Admin',
    description: 'Manage the estate',
    icon: 'settings' as const,
    iconColor: '#7c3aed',
    route: '/(auth)/signup/admin',
  },
  {
    key: 'manager',
    label: 'Property Manager',
    description: 'Manage properties',
    icon: 'business' as const,
    iconColor: '#059669',
    route: '/(auth)/signup/manager',
  },
  {
    key: 'guard',
    label: 'Security Guard',
    description: 'Estate security staff',
    icon: 'shield' as const,
    iconColor: '#dc2626',
    route: '/(auth)/signup/guard',
  },
  {
    key: 'vendor',
    label: 'Vendor/Contractor',
    description: 'Service provider',
    icon: 'construct' as const,
    iconColor: '#d97706',
    route: '/(auth)/signup/vendor',
  },
  {
    key: 'exco',
    label: 'Exco/Assoc. Officer',
    description: 'Association official',
    icon: 'ribbon' as const,
    iconColor: '#9333ea',
    route: '/(auth)/signup/exco',
  },
  {
    key: 'landlord',
    label: 'Landlord',
    description: 'Property owner',
    icon: 'storefront' as const,
    iconColor: '#C5A059',
    route: '/(auth)/signup/landlord',
  },
];

export default function UserTypeScreen() {
  const router = useRouter();

  const pairs: (typeof USER_TYPES)[] = [];
  for (let i = 0; i < USER_TYPES.length; i += 2) {
    pairs.push(USER_TYPES.slice(i, i + 2));
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </Pressable>
        <Text style={styles.headerTitle}>I am a…</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <AppText variant="body" style={styles.subtitle}>
          Choose your role to get started with the right experience.
        </AppText>

        {pairs.map((pair, rowIdx) => (
          <View key={rowIdx} style={styles.row}>
            {pair.map((item) => (
              <Pressable
                key={item.key}
                style={styles.card}
                onPress={() => router.push(item.route as never)}
              >
                <View style={[styles.iconCircle, { backgroundColor: item.iconColor + '20' }]}>
                  <Ionicons name={item.icon} size={52} color={item.iconColor} />
                </View>
                <Text style={styles.cardLabel}>{item.label}</Text>
                <Text style={styles.cardDesc}>{item.description}</Text>
              </Pressable>
            ))}
            {pair.length === 1 && <View style={styles.cardPlaceholder} />}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    backgroundColor: colors.primary.DEFAULT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: { padding: 4, width: 40 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  content: { padding: 16, gap: 12 },
  subtitle: {
    color: colors.neutral.textMuted,
    marginBottom: 4,
    textAlign: 'center',
  },
  row: { flexDirection: 'row', gap: 12 },
  card: {
    flex: 1,
    backgroundColor: colors.neutral.surface,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.neutral.border,
  },
  cardPlaceholder: { flex: 1 },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral.text,
    textAlign: 'center',
  },
  cardDesc: {
    fontSize: 12,
    color: colors.neutral.textMuted,
    textAlign: 'center',
  },
});
