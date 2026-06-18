// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function EmergencyAnnouncement() {
  const router = useRouter();
  const { title, body } = useLocalSearchParams<{ title?: string; body?: string }>();
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Animated.View style={[styles.iconContainer, { opacity: pulseAnim }]}>
          <Ionicons name="warning" size={80} color="#fff" />
        </Animated.View>

        <Text style={styles.emergencyLabel}>EMERGENCY ALERT</Text>
        <Text style={styles.title}>{title ?? 'Emergency Notice'}</Text>
        <Text style={styles.body}>{body ?? 'Please follow estate emergency procedures immediately. Remain calm and listen for further instructions from management.'}</Text>

        <View style={styles.instructionCard}>
          <Text style={styles.instructionTitle}>What to do:</Text>
          {['Stay calm and do not panic', 'Follow instructions from security', 'Contact estate management if needed', 'Alert your neighbours'].map((item, i) => (
            <View key={i} style={styles.instructionItem}>
              <View style={styles.bullet} />
              <Text style={styles.instructionText}>{item}</Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.gotItBtn} onPress={() => router.back()}>
          <Text style={styles.gotItText}>Got It</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.secondary.red },
  content: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 20 },
  iconContainer: { width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  emergencyLabel: { fontSize: 13, fontWeight: '800', color: 'rgba(255,255,255,0.8)', letterSpacing: 3, textTransform: 'uppercase' },
  title: { fontSize: 26, fontWeight: '900', color: '#fff', textAlign: 'center', lineHeight: 34 },
  body: { fontSize: 16, color: 'rgba(255,255,255,0.9)', textAlign: 'center', lineHeight: 26 },
  instructionCard: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16, padding: 16, width: '100%', gap: 10 },
  instructionTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 4 },
  instructionItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff', marginTop: 7 },
  instructionText: { flex: 1, fontSize: 14, color: 'rgba(255,255,255,0.9)', lineHeight: 22 },
  gotItBtn: { backgroundColor: '#fff', borderRadius: 14, height: 54, alignItems: 'center', justifyContent: 'center', width: '100%' },
  gotItText: { fontSize: 17, fontWeight: '800', color: colors.secondary.red },
});
