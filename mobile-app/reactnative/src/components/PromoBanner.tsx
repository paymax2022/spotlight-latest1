import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  title:    string;
  subtitle: string;
  cta:      string;
  badge?:   string;
  onPress:  () => void;
}

export default function PromoBanner({ title, subtitle, cta, badge, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.wrapper, pressed && { opacity: 0.9 }]}>
      <LinearGradient
        colors={['#340075', '#0051D5']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <View style={styles.ctaBtn}>
          <Text style={styles.ctaText}>{cta}</Text>
        </View>
        {/* Decorative circle */}
        <View style={styles.decorCircle} />
        <View style={styles.decorCircle2} />
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg },
  card: {
    borderRadius: Radius.xl,
    padding:      Spacing.cardPadding,
    overflow:     'hidden',
    minHeight:    120,
    justifyContent: 'center',
  },
  badge: {
    alignSelf:       'flex-start',
    backgroundColor: Colors.error,
    borderRadius:    Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    marginBottom:    Spacing.sm,
  },
  badgeText: { ...Typography.caption, color: Colors.onError, fontWeight: '700' },
  title: {
    ...Typography.titleLg,
    color:        Colors.onPrimary,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    ...Typography.labelSm,
    color:        'rgba(255,255,255,0.75)',
    marginBottom: Spacing.md,
  },
  ctaBtn: {
    alignSelf:       'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius:    Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.4)',
  },
  ctaText: { ...Typography.labelSm, color: Colors.onPrimary },
  decorCircle: {
    position:        'absolute',
    right:           -30,
    top:             -30,
    width:           120,
    height:          120,
    borderRadius:    60,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  decorCircle2: {
    position:        'absolute',
    right:           20,
    bottom:          -40,
    width:           100,
    height:          100,
    borderRadius:    50,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
});
