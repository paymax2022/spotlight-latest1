import React from 'react';
import { View, Text, Pressable, StyleSheet, ImageBackground } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';

interface Props {
  title:       string;
  subtitle:    string;
  cta:         string;
  badge?:      string;
  imageUri?:   string;
  onPress:     () => void;
}

export default function PromoBanner({ title, subtitle, cta, badge, imageUri, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.wrapper, pressed && { opacity: 0.9 }]}>
      <ImageBackground
        source={{ uri: imageUri }}
        style={styles.card}
        imageStyle={styles.cardImage}
        defaultSource={{ uri: imageUri }}
      >
        <LinearGradient
          colors={['rgba(0,0,0,0.3)', 'rgba(0,0,0,0.4)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.overlay}
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
        </LinearGradient>
      </ImageBackground>
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
  cardImage: {
    borderRadius: Radius.xl,
  },
  overlay: {
    flex: 1,
    padding: Spacing.cardPadding,
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
});
