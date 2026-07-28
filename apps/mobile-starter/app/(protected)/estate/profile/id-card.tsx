// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getResidentCard } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const BADGE_COLORS: Record<string, string> = {
  resident: '#6C63FF',
  tenant: '#3B82F6',
  homeowner: '#10B981',
  landlord: '#F59E0B',
};

export default function IDCardScreen() {
  const params = useLocalSearchParams<{ estateId?: string }>();

  const { data: ctx } = useQuery({
    queryKey: ['estate-context'],
    queryFn: getActiveEstateContext,
  });

  const estateId = params.estateId ?? ctx?.estateId;

  const { data: card, isLoading, isError } = useQuery({
    queryKey: ['estate-resident-card', estateId],
    queryFn: () => getResidentCard(estateId!),
    enabled: !!estateId,
  });

  const badgeColor = BADGE_COLORS[card?.occupancy_type ?? 'resident'] ?? '#6C63FF';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.heading}>Resident ID Card</Text>
        <Text style={styles.sub}>Present this card at the gate for quick identification.</Text>

        {isLoading ? (
          <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 60 }} />
        ) : isError || !card ? (
          <View style={styles.errorBox}>
            <Ionicons name="warning-outline" size={40} color={colors.error ?? '#EF4444'} />
            <Text style={styles.errorText}>Could not load your resident card.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {/* Card header */}
            <View style={styles.cardHeader}>
              <View style={styles.logoBox}>
                <Ionicons name="home" size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.estateName} numberOfLines={1}>{card.estate_name}</Text>
                <Text style={styles.cardTypeLabel}>Resident Identification Card</Text>
              </View>
            </View>

            {/* Photo */}
            <View style={styles.avatarWrap}>
              {card.profile_photo_url ? (
                <Image source={{ uri: card.profile_photo_url }} style={styles.avatar} />
              ) : (
                <Ionicons name="person" size={52} color={colors.primary.DEFAULT} />
              )}
            </View>

            {/* Name + role badge */}
            <Text style={styles.fullName}>{card.full_name}</Text>
            <View style={[styles.typeBadge, { backgroundColor: badgeColor + '20' }]}>
              <Text style={[styles.typeText, { color: badgeColor }]}>
                {card.occupancy_type.toUpperCase()}
              </Text>
            </View>

            {/* Unit */}
            {card.unit ? (
              <View style={styles.metaRow}>
                <Ionicons name="location-outline" size={14} color={colors.neutral.textMuted} />
                <Text style={styles.metaText}>{card.unit}</Text>
              </View>
            ) : null}

            {/* Role */}
            <View style={styles.metaRow}>
              <Ionicons name="shield-checkmark-outline" size={14} color={colors.neutral.textMuted} />
              <Text style={styles.metaText}>{card.role.replace('_', ' ')}</Text>
            </View>

            {/* QR code — encodes "<estate_id>:<resident_id>" */}
            <View style={styles.qrWrap}>
              <QRCode
                value={card.qr_value}
                size={150}
                backgroundColor="#fff"
                color="#000"
              />
              <Text style={styles.qrHint}>Scan at gate entry</Text>
            </View>

            {/* Resident ID */}
            <Text style={styles.residentId}>
              Resident ID: {card.resident_id.slice(0, 12).toUpperCase()}
            </Text>
            <Text style={styles.issuedAt}>Issued: {new Date(card.issued_at).toLocaleDateString()}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  scroll: { alignItems: 'center', padding: 24, gap: 12, paddingBottom: 60 },
  heading: { fontSize: 22, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 13, color: colors.neutral.textMuted, textAlign: 'center', maxWidth: 280 },
  errorBox: { alignItems: 'center', gap: 12, marginTop: 60 },
  errorText: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
  card: {
    width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 24,
    padding: 24, alignItems: 'center', gap: 10,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20, shadowOffset: { width: 0, height: 4 }, elevation: 8,
    marginTop: 8,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    alignSelf: 'stretch', borderBottomWidth: 1, borderBottomColor: '#F1F5F9', paddingBottom: 12,
  },
  logoBox: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center',
  },
  estateName: { fontSize: 13, fontWeight: '800', color: colors.neutral.text },
  cardTypeLabel: { fontSize: 10, color: colors.neutral.textMuted, fontWeight: '600', marginTop: 1 },
  avatarWrap: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: colors.primary.DEFAULT + '15', alignItems: 'center', justifyContent: 'center', marginTop: 8,
    overflow: 'hidden',
  },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  fullName: { fontSize: 18, fontWeight: '800', color: colors.neutral.text, textAlign: 'center' },
  typeBadge: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 12 },
  typeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 13, color: colors.neutral.textMuted },
  qrWrap: { alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 4 },
  qrHint: { fontSize: 11, color: colors.neutral.placeholder },
  residentId: { fontSize: 11, color: colors.neutral.placeholder, fontFamily: 'monospace' },
  issuedAt: { fontSize: 11, color: colors.neutral.placeholder },
});
