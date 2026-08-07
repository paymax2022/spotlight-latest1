// Shared "View / Download Certificate" action for the Business Registry surfaces
// (register wizard status step + business hub). For a registered/verified business
// with a `certificateUrl` we open it directly; otherwise we fetch it on demand via
// GET /:id/certificate and handle the "not available yet" 404 gracefully.
//
// The URL is a CAC certificate link our own backend supplied — safe to open as an
// external web link via Linking.openURL.

import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, Linking, Alert } from 'react-native';
import { FileDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { getCertificate } from '@/api/business.api';
import { getErrorMessage } from '@/utils/errorMapper';
import type { BusinessProfile } from '@/types/business';

async function openUrl(url: string) {
  if (!url) return;
  try {
    await Linking.openURL(url); // external CAC certificate URL supplied by our backend
  } catch {
    Alert.alert('Could not open certificate', 'Please try again in a moment.');
  }
}

export function CertificateAction({ business, style }: { business: BusinessProfile; style?: object }) {
  const [loading, setLoading] = React.useState(false);
  const hasUrl = !!business.certificateUrl;

  const onGet = async () => {
    setLoading(true);
    try {
      const { certificateUrl } = await getCertificate(business.id);
      if (certificateUrl) {
        await openUrl(certificateUrl);
      } else {
        Alert.alert('Certificate not ready', 'Your CAC certificate is not available yet. Please check back shortly.');
      }
    } catch (err) {
      Alert.alert('Certificate not ready', getErrorMessage(err) || 'Your CAC certificate is not available yet.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Pressable
      onPress={() => (hasUrl ? openUrl(business.certificateUrl!) : onGet())}
      disabled={loading}
      style={({ pressed }) => [styles.certBtn, style, pressed && { opacity: 0.9 }]}
      accessibilityRole="button"
      accessibilityLabel={hasUrl ? 'View or download certificate' : 'Get certificate'}
    >
      {loading ? (
        <ActivityIndicator size="small" color={Colors.primary} />
      ) : (
        <FileDown size={18} color={Colors.primary} strokeWidth={2} />
      )}
      <Text style={styles.certBtnText}>
        {hasUrl ? 'View / Download Certificate' : loading ? 'Fetching…' : 'Get certificate'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  certBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.md, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.primary, width: '100%',
  },
  certBtnText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' },
});
