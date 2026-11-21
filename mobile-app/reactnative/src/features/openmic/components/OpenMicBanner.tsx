// The Open Mic banner.
//
// An applicant arriving from their status page needs to know which edition they
// are looking at before they read a single instruction, so this band sits at the
// top of the Open Mic surfaces.
//
// The brand gradient IS the banner for this competition. `contests.banner_image_url`
// exists and is offered through the API, but no Open Mic edition has one set —
// not the dev edition, not the catalogue entry — and the marketing banner plane
// the home screen uses is a closed, curated whitelist with no Open Mic slot. So
// the default is the purple the rest of the app uses to say "Spotlight", and an
// organiser who does fill in the column gets their image behind the same words,
// with a scrim so the text stays readable.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MicVocal } from 'lucide-react-native';
import { Colors, Radius, shadow3, Spacing, Typography } from '@/constants/tokens';

interface Props {
  /** The edition's own title, straight from the contest row. */
  title?: string | null;
  /** One line of context — the description, or what the edition is running for. */
  subtitle?: string | null;
  /**
   * `contests.banner_image_url`, when the organiser has set one. Most editions
   * have not, which is why the gradient is the default rather than a fallback.
   */
  imageUrl?: string | null;
}

export default function OpenMicBanner({ title, subtitle, imageUrl }: Props) {
  const heading = title?.trim() || 'One beat, one verse';
  const image = imageUrl?.trim() || '';

  return (
    <LinearGradient
      colors={Colors.gradientPurple}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.band, shadow3, image ? styles.bandImage : null]}
    >
      {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      {image ? <View style={styles.scrim} pointerEvents="none" /> : null}

      <View style={styles.row}>
        <View style={styles.badge}>
          <MicVocal size={18} color={Colors.onPrimary} />
        </View>
        <View style={styles.text}>
          <Text style={styles.kicker}>Spotlight Open Mic</Text>
          <Text style={styles.title}>{heading}</Text>
          {subtitle?.trim() ? <Text style={styles.subtitle}>{subtitle.trim()}</Text> : null}
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  band:      { borderRadius: Radius.xl, padding: Spacing.lg, marginBottom: Spacing.sm, overflow: 'hidden' },
  bandImage: { minHeight: 128, backgroundColor: Colors.primaryContainer },
  scrim:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(26,0,80,0.55)' },
  row:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  badge:     {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text:      { flex: 1, gap: 2 },
  kicker:    { ...Typography.labelSm, color: 'rgba(255,255,255,0.72)', textTransform: 'uppercase', letterSpacing: 0.8 },
  title:     { ...Typography.titleLg, color: Colors.onPrimary },
  subtitle:  { ...Typography.bodySm, color: 'rgba(255,255,255,0.85)', lineHeight: 18 },
});
