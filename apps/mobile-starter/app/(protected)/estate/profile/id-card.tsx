// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getProfile } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function IDCardScreen() {
  const { data: ctx } = useQuery({
    queryKey: ['estate-context'],
    queryFn: getActiveEstateContext,
  });

  const { data: profile, isLoading } = useQuery({
    queryKey: ['estate-profile'],
    queryFn: async () => {
      const c = await getActiveEstateContext();
      if (!c.estateId) throw new Error('No active estate');
      return getProfile(c.estateId);
    },
    enabled: !!ctx?.estateId,
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Text style={styles.heading}>Resident ID Card</Text>
        <Text style={styles.sub}>Present this card at the estate gate for quick identification.</Text>

        {isLoading ? (
          <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
        ) : (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.logo}>
                <Ionicons name="home" size={20} color="#fff" />
              </View>
              <View>
                <Text style={styles.estateName}>{ctx?.estateName ?? 'Estate'}</Text>
                <Text style={styles.cardType}>Resident Card</Text>
              </View>
            </View>

            <View style={styles.avatarWrap}>
              <Ionicons name="person" size={50} color={colors.primary.DEFAULT} />
            </View>

            <Text style={styles.phone}>{profile?.phone || '—'}</Text>
            <View style={[styles.typeBadge, { backgroundColor: BADGE_COLORS[profile?.occupancy_type ?? 'resident'] + '20' }]}>
              <Text style={[styles.typeText, { color: BADGE_COLORS[profile?.occupancy_type ?? 'resident'] }]}>
                {(profile?.occupancy_type ?? 'resident').toUpperCase()}
              </Text>
            </View>

            {ctx?.propertyLabel && (
              <View style={styles.propertyRow}>
                <Ionicons name="location-outline" size={14} color={colors.neutral.textMuted} />
                <Text style={styles.propertyText}>{ctx.propertyLabel}</Text>
              </View>
            )}

            <View style={styles.qrPlaceholder}>
              <Ionicons name="qr-code-outline" size={72} color={colors.neutral.placeholder} />
              <Text style={styles.qrHint}>QR scanning coming soon</Text>
            </View>

            <Text style={styles.residentId}>ID: {profile?.resident_id?.slice(0, 12) ?? '—'}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const BADGE_COLORS = {
  resident: '#6C63FF',
  tenant: '#3B82F6',
  homeowner: '#10B981',
  landlord: '#F59E0B',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  center: { flex: 1, alignItems: 'center', padding: 24, gap: 12 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
  card: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, elevation: 6, marginTop: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', width: '100%', borderBottomWidth: 1, borderBottomColor: '#F1F5F9', paddingBottom: 12 },
  logo: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  estateName: { fontSize: 14, fontWeight: '800', color: colors.neutral.text },
  cardType: { fontSize: 11, color: colors.neutral.textMuted, fontWeight: '600' },
  avatarWrap: { width: 90, height: 90, borderRadius: 45, backgroundColor: colors.primary.DEFAULT + '15', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  phone: { fontSize: 18, fontWeight: '700', color: colors.neutral.text },
  typeBadge: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 12 },
  typeText: { fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  propertyRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  propertyText: { fontSize: 13, color: colors.neutral.textMuted },
  qrPlaceholder: { alignItems: 'center', gap: 4, marginTop: 8 },
  qrHint: { fontSize: 11, color: colors.neutral.placeholder },
  residentId: { fontSize: 11, color: colors.neutral.placeholder, fontFamily: 'monospace' },
});
