import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Trophy } from 'lucide-react-native';
import { Colors, Radius, shadow3, Spacing, Typography } from '@/constants/tokens';

interface Props {
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
}

export default function RegistrationContestBanner({ title, subtitle, imageUrl }: Props) {
  const image = imageUrl?.trim() || '';

  return (
    <LinearGradient
      colors={Colors.gradientPurple}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.banner, shadow3]}
    >
      {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      {image ? <View style={styles.scrim} pointerEvents="none" /> : null}
      <View style={styles.row}>
        <View style={styles.badge}>
          <Trophy size={18} color={Colors.onPrimary} />
        </View>
        <View style={styles.text}>
          <Text style={styles.kicker}>Contest</Text>
          <Text style={styles.title}>{title}</Text>
          {subtitle?.trim() ? <Text style={styles.subtitle}>{subtitle.trim()}</Text> : null}
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: Radius.xl, padding: Spacing.lg, minHeight: 112, overflow: 'hidden' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(26,0,80,0.55)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  badge: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  kicker: { ...Typography.labelSm, color: 'rgba(255,255,255,0.72)', textTransform: 'uppercase', letterSpacing: 0.8 },
  title: { ...Typography.titleLg, color: Colors.onPrimary },
  subtitle: { ...Typography.bodySm, color: 'rgba(255,255,255,0.85)', lineHeight: 18 },
});
