// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PanicScreen() {
  const router = useRouter();
  const [count, setCount] = useState(5);
  const interval = useRef(null);

  useEffect(() => {
    interval.current = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          clearInterval(interval.current);
          Alert.alert('SOS Sent', 'Emergency services have been notified. Help is on the way.', [
            { text: 'OK', onPress: () => router.replace('/emergency/tracking' as never) },
          ]);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval.current);
  }, []);

  const handleCancel = () => {
    clearInterval(interval.current);
    Alert.alert('Cancelled', 'SOS alert has been cancelled.', [{ text: 'OK', onPress: () => router.back() }]);
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <Ionicons name="warning" size={80} color="#fff" />
        <Text style={s.title}>SOS ACTIVATED</Text>
        <Text style={s.subtitle}>Alerting security in</Text>
        <Text style={s.countdown}>{count}</Text>
        <Text style={s.subtitle}>seconds</Text>

        <Pressable style={s.cancelBtn} onPress={handleCancel}>
          <Text style={s.cancelBtnTxt}>CANCEL</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#7f1d1d' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 },
  title: { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: 3 },
  subtitle: { fontSize: 16, color: 'rgba(255,255,255,0.8)', fontWeight: '500' },
  countdown: { fontSize: 80, fontWeight: '900', color: '#fff', lineHeight: 88 },
  cancelBtn: { marginTop: 40, width: '100%', height: 60, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  cancelBtnTxt: { fontSize: 18, fontWeight: '900', color: '#7f1d1d', letterSpacing: 2 },
});
