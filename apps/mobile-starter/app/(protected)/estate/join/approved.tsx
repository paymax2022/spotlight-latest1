// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { setActiveEstate } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function AccessApprovedScreen() {
  const router = useRouter();
  const { estateId, estateName } = useLocalSearchParams<{ estateId?: string; estateName?: string }>();

  useEffect(() => {
    if (estateId) {
      setActiveEstate(estateId, estateName).catch(() => undefined);
    }
  }, [estateId, estateName]);

  return (
    <SafeAreaView style={[styles.safe, styles.center]}>
      <View style={styles.iconWrap}>
        <Ionicons name="checkmark-circle" size={72} color="#00B894" />
      </View>
      <Text style={styles.title}>Access Approved!</Text>
      <Text style={styles.sub}>
        Welcome to{'\n'}
        <Text style={styles.estateName}>{estateName ?? 'the estate'}</Text>
      </Text>
      <Text style={styles.hint}>You can now access all estate features.</Text>

      <Pressable style={styles.primaryBtn} onPress={() => router.replace('/estate' as never)}>
        <Text style={styles.primaryBtnText}>Go to Estate Dashboard</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  iconWrap: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#D1FAE5', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 17, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 28 },
  estateName: { fontWeight: '800', color: colors.neutral.text },
  hint: { fontSize: 13, color: colors.neutral.placeholder, textAlign: 'center' },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14, marginTop: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
