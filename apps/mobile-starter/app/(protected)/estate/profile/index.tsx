// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getProfile } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const SECTIONS = [
  { label: 'Edit Profile', icon: 'person-outline', route: '/estate/profile/edit', color: '#6C63FF' },
  { label: 'Emergency Contacts', icon: 'call-outline', route: '/estate/profile/contacts', color: '#EF4444' },
  { label: 'Family Members', icon: 'people-outline', route: '/estate/profile/family', color: '#3B82F6' },
  { label: 'Domestic Staff', icon: 'briefcase-outline', route: '/estate/profile/staff', color: '#F59E0B' },
  { label: 'Vehicles', icon: 'car-outline', route: '/estate/profile/vehicles', color: '#10B981' },
  { label: 'Resident ID Card', icon: 'card-outline', route: '/estate/profile/id-card', color: '#8B5CF6' },
  { label: 'Occupancy Details', icon: 'home-outline', route: '/estate/profile/occupancy', color: '#06B6D4' },
  { label: 'Privacy Settings', icon: 'shield-outline', route: '/estate/profile/privacy', color: '#64748B' },
];

export default function ProfileIndexScreen() {
  const router = useRouter();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['estate-profile'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return getProfile(ctx.estateId);
    },
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.heading}>My Profile</Text>

        {isLoading ? (
          <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={40} color={colors.primary.DEFAULT} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{profile?.phone || 'Complete your profile'}</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{profile?.occupancy_type ?? 'resident'}</Text>
                </View>
              </View>
            </View>

            <View style={styles.grid}>
              {SECTIONS.map((s) => (
                <Pressable
                  key={s.route}
                  style={styles.tile}
                  onPress={() => router.push(s.route as never)}
                >
                  <View style={[styles.tileIcon, { backgroundColor: s.color + '20' }]}>
                    <Ionicons name={s.icon as any} size={26} color={s.color} />
                  </View>
                  <Text style={styles.tileLabel}>{s.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.neutral.textMuted} />
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  scroll: { padding: 20, gap: 12 },
  heading: { fontSize: 26, fontWeight: '800', color: colors.neutral.text, marginBottom: 4 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 14, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary.DEFAULT + '15', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  badge: { marginTop: 4, backgroundColor: colors.primary.DEFAULT + '18', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, color: colors.primary.DEFAULT, fontWeight: '600', textTransform: 'capitalize' },
  grid: { gap: 8 },
  tile: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  tileIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.neutral.text },
});
