// @ts-nocheck
// Property verification pending — covers both ownership claim and tenancy request
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function PropertyPendingScreen() {
  const router = useRouter();
  const { unitLabel, type } = useLocalSearchParams<{ unitLabel: string; type?: string }>();
  const isTenancy = type === 'tenancy';

  return (
    <SafeAreaView style={[styles.safe, styles.center]}>
      <View style={styles.iconWrap}>
        <Ionicons name="document-text" size={56} color={colors.gold?.DEFAULT ?? '#C5A059'} />
      </View>
      <Text style={styles.title}>
        {isTenancy ? 'Occupancy Request Sent' : 'Ownership Claim Submitted'}
      </Text>
      <Text style={styles.sub}>
        {isTenancy
          ? `Your tenancy request for ${unitLabel} has been sent to the landlord for approval.`
          : `Your ownership claim for ${unitLabel} is under review by the estate admin.`
        }
      </Text>
      <Text style={styles.hint}>You will be notified once a decision is made.</Text>

      <Pressable style={styles.primaryBtn} onPress={() => router.replace('/estate/properties' as never)}>
        <Text style={styles.primaryBtnText}>Back to Properties</Text>
      </Pressable>
      <Pressable style={styles.homeLink} onPress={() => router.replace('/estate' as never)}>
        <Text style={styles.homeLinkText}>Estate Dashboard</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  iconWrap: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#FEF9C3', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: colors.neutral.text, textAlign: 'center' },
  sub: { fontSize: 15, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 24, maxWidth: 300 },
  hint: { fontSize: 13, color: colors.neutral.placeholder, textAlign: 'center' },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14, marginTop: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  homeLink: { paddingVertical: 10 },
  homeLinkText: { fontSize: 14, color: colors.secondary.DEFAULT, fontWeight: '600' },
});
