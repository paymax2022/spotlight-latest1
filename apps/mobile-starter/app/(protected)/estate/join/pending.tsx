// @ts-nocheck
// Access request pending screen — polls for status change
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getMyJoinRequest } from '@/api/estate.api';
import { colors } from '@/theme';

export default function AccessPendingScreen() {
  const router = useRouter();
  const { estateId, estateName } = useLocalSearchParams<{ estateId: string; estateName: string }>();

  const request = useQuery({
    queryKey: ['join-request', estateId],
    queryFn: () => getMyJoinRequest(estateId),
    refetchInterval: 15000, // poll every 15 s
    retry: false,
  });

  useEffect(() => {
    if (request.data?.status === 'approved') {
      router.replace({ pathname: '/estate/join/approved', params: { estateId, estateName } } as never);
    } else if (request.data?.status === 'rejected') {
      router.replace({ pathname: '/estate/join/rejected', params: { estateId, estateName } } as never);
    }
  }, [estateId, estateName, request.data?.status, router]);

  return (
    <SafeAreaView style={[styles.safe, styles.center]}>
      <View style={styles.iconWrap}>
        <Ionicons name="time" size={56} color={colors.gold?.DEFAULT ?? '#C5A059'} />
      </View>
      <Text style={styles.title}>Request Pending</Text>
      <Text style={styles.sub}>
        Your request to join{'\n'}
        <Text style={styles.estateName}>{estateName}</Text>
        {'\n'}is under review.
      </Text>
      <Text style={styles.hint}>You will be notified when the admin makes a decision.</Text>

      <Pressable style={styles.refreshBtn} onPress={() => request.refetch()}>
        <Ionicons name="refresh-outline" size={16} color={colors.secondary.DEFAULT} />
        <Text style={styles.refreshText}>Check Status</Text>
      </Pressable>

      <Pressable style={styles.backHome} onPress={() => router.replace('/(tabs)/index' as never)}>
        <Text style={styles.backHomeText}>Back to Home</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  iconWrap: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: '#FEF9C3',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 16, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 26 },
  estateName: { fontWeight: '700', color: colors.neutral.text },
  hint: { fontSize: 13, color: colors.neutral.placeholder, textAlign: 'center', marginTop: -8 },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20, backgroundColor: colors.secondary.DEFAULT + '15' },
  refreshText: { fontSize: 14, fontWeight: '600', color: colors.secondary.DEFAULT },
  backHome: { paddingVertical: 12 },
  backHomeText: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '600' },
});
