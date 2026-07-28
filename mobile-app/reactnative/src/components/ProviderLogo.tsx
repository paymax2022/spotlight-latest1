import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Typography } from '@/constants/typography';
import { getProviderBrand, providerLogoSources } from '@/constants/providerBrands';

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
}: {
  code: string;
  name: string;
  size?: number;
  /** Authoritative logo URL (e.g. the VTPass service `image`). Tried first. */
  logoUri?: string | null;
}) {
  const brand = getProviderBrand(code, name);
  // Priority: VTPass image → brand logo (Clearbit) → favicon → badge.
  const sources = [logoUri, ...providerLogoSources(brand.domain)].filter(Boolean) as string[];
  const [idx, setIdx] = useState(0);
  const uri = sources[idx];

  const box = { width: size, height: size, borderRadius: Radius.md };

  if (uri) {
    return (
      <View style={[styles.box, styles.logoWrap, box]}>
        <Image
          source={{ uri }}
          style={{ width: size - 6, height: size - 6, borderRadius: 4 }}
          resizeMode="contain"
          onError={() => setIdx((i) => i + 1)} // real logo -> favicon -> badge
          accessibilityLabel={`${name} logo`}
        />
      </View>
    );
  }

  return (
    <View style={[styles.box, box, { backgroundColor: `${brand.color}1A` }]}>
      <Text style={[styles.abbr, { color: brand.color }]}>{brand.abbr}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  logoWrap: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  abbr: { ...Typography.labelMd, fontWeight: '800' },
});
