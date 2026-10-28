import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';

// Two forms. `imageUri` renders a finished banner picture with nothing painted
// over it (the marketplace screens); otherwise the text-and-gradient card that
// the home, arena, featured and association screens use.
type ImageProps = {
  imageUri: string;
  onPress:  () => void;
};

type TextProps = {
  imageUri?: undefined;
  title:     string;
  subtitle:  string;
  cta:       string;
  badge?:    string;
  onPress:   () => void;
};

type Props = ImageProps | TextProps;

export default function PromoBanner(props: Props) {
  const { onPress } = props;

  if (props.imageUri !== undefined) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.wrapper, pressed && { opacity: 0.9 }]}>
        <Image source={{ uri: props.imageUri }} style={styles.image} />
      </Pressable>
    );
  }

  const { title, subtitle, cta, badge } = props;
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
  image: {
    width: '100%',
    height: 180,
    borderRadius: Radius.xl,
  },
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
