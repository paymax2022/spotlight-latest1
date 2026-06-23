// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function AccessRejectedScreen() {
  const router = useRouter();
  const { estateId, estateName } = useLocalSearchParams<{ estateId?: string; estateName?: string }>();

  return (
    <SafeAreaView style={[styles.safe, styles.center]}>
      <View style={styles.iconWrap}>
        <Ionicons name="close-circle" size={72} color="#dc2626" />
      </View>
      <Text style={styles.title}>Request Rejected</Text>
      <Text style={styles.sub}>
        Your request to join{'\n'}
        <Text style={styles.estateName}>{estateName ?? 'this estate'}</Text>
        {'\n'}was not approved.
      </Text>
      <Text style={styles.hint}>
        Contact the estate admin directly or try requesting access again with more information.
      </Text>

      <Pressable
        style={styles.retryBtn}
        onPress={() =>
          estateId
            ? router.replace({ pathname: '/estate/join/request', params: { estateId, estateName } } as never)
            : router.replace('/estate/join' as never)
        }
      >
        <Text style={styles.retryBtnText}>Request Again</Text>
      </Pressable>
      <Pressable style={styles.homeLink} onPress={() => router.replace('/(tabs)/index' as never)}>
        <Text style={styles.homeLinkText}>Back to Home</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  iconWrap: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 16, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 26 },
  estateName: { fontWeight: '800', color: colors.neutral.text },
  hint: { fontSize: 13, color: colors.neutral.placeholder, textAlign: 'center', maxWidth: 280 },
  retryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14, marginTop: 8 },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  homeLink: { paddingVertical: 12 },
  homeLinkText: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '600' },
});
