import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Colors } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { getProviderBrand, providerLogoSources } from '@/constants/providerBrands';
import { getLocalProviderLogo } from '@/constants/providerLogoAssets';

/**
 * Renders a utility/bill provider's real brand logo (electricity DISCO, telco,
 * cable, education), fetched from the brand's domain with a graceful fallback
 * chain: real logo -> high-res favicon -> branded colour badge with the
 * provider's short code. Always renders something — never a broken image.
 */
export default function ProviderLogo({
  code,
  name,
  size = 34,
  logoUri,
  fill = false,
}: {
  code: string;
  name: string;
  size?: number;
  /** Authoritative logo URL (e.g. the VTPass service `image`). Tried first. */
  logoUri?: string | null;
  /** Stretch over the whole parent tile instead of a fixed square. */
  fill?: boolean;
}) {
  // Hooks first (unconditional, per the Rules of Hooks) — before any early return.
  const [idx, setIdx] = useState(0);

  const brand = getProviderBrand(code, name);
  const box = fill ? styles.fillBox : { width: size, height: size, borderRadius: Radius.md };
  // In fill mode the tile already draws the frame, so the logo keeps only the
  // white plate that makes a dark brand mark readable on any card colour.
  const wrap = fill ? styles.fillWrap : styles.logoWrap;
  const art = fill ? styles.fillImage : { width: size - 6, height: size - 6, borderRadius: 4 };

  // Priority 0: a BUNDLED local logo (instant, offline, no network). If present
  // it wins outright — no fallback chain needed.
  const localLogo = getLocalProviderLogo(brand.key);
  if (localLogo) {
    return (
      <View style={[styles.box, wrap, box]}>
        <Image
          source={localLogo}
          style={art}
          resizeMode="contain"
          accessibilityLabel={`${name} logo`}
        />
      </View>
    );
  }

  // Priority: VTPass image → remote favicon → branded badge.
  const sources = [logoUri, ...providerLogoSources(brand.domain)].filter(Boolean) as string[];
  const uri = sources[idx];

  if (uri) {
    return (
      <View style={[styles.box, wrap, box]}>
        <Image
          source={{ uri }}
          style={art}
          resizeMode="contain"
          onError={() => setIdx((i) => i + 1)} // real logo -> favicon -> badge
          accessibilityLabel={`${name} logo`}
        />
      </View>
    );
  }

  return (
    <View style={[styles.box, box, { backgroundColor: `${brand.color}1A` }]}>
      <Text style={[fill ? styles.abbrFill : styles.abbr, { color: brand.color }]}>{brand.abbr}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  logoWrap: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fillBox: { width: '100%', height: '100%', padding: Spacing.xs },
  fillWrap: { backgroundColor: '#FFFFFF' },
  fillImage: { width: '100%', height: '100%' },
  abbr: { ...Typography.labelMd, fontWeight: '800' },
  abbrFill: { ...Typography.labelMd, fontWeight: '800', fontSize: 20 },
});
