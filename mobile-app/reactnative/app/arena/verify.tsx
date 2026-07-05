import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useVerifyCredential } from '@/features/arena/hooks';

/**
 * Public credential verification (C9 / S3). No auth needed. Accepts a hash from
 * the QR deep-link (?hash=…) or a manually-typed hash, and calls
 * GET /credentials/{hash}/verify. Real QR scanning plugs into the input here.
 */
export default function VerifyScreen() {
  const params = useLocalSearchParams<{ hash?: string }>();
  const [hash, setHash] = useState(params.hash ?? '');
  const [query, setQuery] = useState(params.hash ?? '');
  const res = useVerifyCredential(query || null);

  const check = () => setQuery(hash.trim());

  const v = res.data;
  const valid = !!v?.valid && v?.status !== 'REVOKED' && v?.status !== 'EXPIRED';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Verify credential" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={styles.intro}>Scan a credential’s QR or paste its hash to check that it’s genuine and active.</Text>

        <TextInputField label="Credential hash" placeholder="e.g. CSD-… or ND-…" value={hash} onChangeText={setHash} autoCapitalize="characters" autoCorrect={false} />
        <PrimaryButton label={res.isFetching ? 'Verifying…' : 'Verify'} onPress={check} loading={res.isFetching} disabled={!hash.trim() || res.isFetching} />

        {query ? (
          res.isLoading ? (
            <StateView kind="loading" message="Checking…" />
          ) : res.isError ? (
            <StateView kind="error" title="Couldn’t verify" message="Check your connection and try again." actionLabel="Retry" onAction={() => res.refetch()} />
          ) : v ? (
            <View style={[styles.resultCard, shadow1, valid ? styles.ok : styles.bad]}>
              <View style={[styles.resIcon, { backgroundColor: valid ? Colors.iconBgTeal : Colors.errorContainer }]}>
                {valid ? <ShieldCheck size={30} color={Colors.teal} /> : v.status === 'REVOKED' ? <ShieldX size={30} color={Colors.error} /> : <ShieldAlert size={30} color={Colors.error} />}
              </View>
              <Text style={styles.resTitle}>{valid ? 'Genuine & active' : v.valid ? `Credential ${v.status?.toLowerCase() ?? 'invalid'}` : 'Not a valid credential'}</Text>
              {v.type ? <Row label="Type" value={v.type === 'NAIJA_DRIVER' ? 'Naija Driver' : 'Certified Safe Driver'} /> : null}
              {v.holderName ? <Row label="Holder" value={v.holderName} /> : null}
              {v.homeState ? <Row label="Home state" value={v.homeState} /> : null}
              {v.issuedAt ? <Row label="Issued" value={new Date(v.issuedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })} /> : null}
              {v.status ? <Row label="Status" value={v.status} /> : null}
              {v.reason ? <Text style={styles.reason}>{v.reason}</Text> : null}
            </View>
          ) : null
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  resultCard: { borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1.5, gap: Spacing.xs, alignItems: 'stretch', marginTop: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest },
  ok: { borderColor: Colors.teal },
  bad: { borderColor: Colors.error },
  resIcon: { width: 60, height: 60, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: Spacing.sm },
  resTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center', marginBottom: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
  rowLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface },
  reason: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.sm },
});
