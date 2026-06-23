// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useEffect, useRef } from 'react';

export default function ProcessingScreen() {
  const router = useRouter();
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true })
    ).start();
    const t = setTimeout(() => router.replace('/estate/dues/success' as never), 3000);
    return () => clearTimeout(t);
  }, []);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="reload-outline" size={64} color={colors.primary.DEFAULT} />
        </Animated.View>
        <Text style={styles.title}>Processing your payment…</Text>
        <Text style={styles.sub}>Do not close this screen.</Text>
        <View style={styles.dotRow}>
          {[0, 1, 2].map((i) => <View key={i} style={[styles.dot, { opacity: 0.3 + i * 0.3 }]} />)}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 20 },
  title: { fontSize: 22, fontWeight: '700', color: colors.neutral.text, textAlign: 'center' },
  sub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
  dotRow: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary.DEFAULT },
});
