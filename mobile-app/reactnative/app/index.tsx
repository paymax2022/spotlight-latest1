import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

export default function SplashScreen() {
  useEffect(() => {
    const t = setTimeout(() => router.replace('/onboarding'), 2600);
    return () => clearTimeout(t);
  }, []);

  return (
    <LinearGradient colors={['#340075', '#1A0050', '#0051D5']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={styles.center}>
          {/* Logo mark */}
          <View style={styles.logoWrap}>
            <View style={styles.logoBox}>
              <View style={styles.logoDot} />
            </View>
          </View>
          <Text style={styles.name}>Paymax</Text>
          <Text style={styles.tagline}>Your premium lifestyle super-app</Text>
        </View>

        {/* Bottom tagline */}
        <Text style={styles.footer}>Powered by the Paymax ecosystem</Text>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            Spacing.sm,
  },
  logoWrap: {
    marginBottom: Spacing.md,
  },
  logoBox: {
    width:          80,
    height:         80,
    borderRadius:   Radius.xl,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems:     'center',
    justifyContent: 'center',
    borderWidth:    1,
    borderColor:    'rgba(255,255,255,0.25)',
  },
  logoDot: {
    width:          40,
    height:         40,
    borderRadius:   Radius.lg,
    backgroundColor: Colors.onPrimaryContainer,
    opacity:        0.9,
  },
  name: {
    fontSize:   36,
    fontWeight: '800',
    color:      Colors.onPrimary,
    letterSpacing: -0.5,
  },
  tagline: {
    ...Typography.bodyMd,
    color:   'rgba(255,255,255,0.65)',
    textAlign: 'center',
  },
  footer: {
    ...Typography.caption,
    color:         'rgba(255,255,255,0.4)',
    textAlign:     'center',
    paddingBottom: Spacing.xl,
  },
});
