import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollText, ChevronRight, ShieldCheck, Pill, CircleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import PharmacyStatusPill from '@/features/health/components/PharmacyStatusPill';
import { useProviderRxQueue, usePrescription, useDecideRx } from '@/features/health/pharmacy/hooks';
import { formatDate, relativeTime } from '@/features/health/constants/health.constants';
import type { ProviderRxQueueItem } from '@/features/health/pharmacy/types';

const HL3_BANNER =
  'Verify the prescriber, patient and dosage before approving. Approved prescriptions are dispense-once.';

function RxBanner() {
  return (
    <View style={styles.banner}>
      <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
      <Text style={styles.bannerText}>{HL3_BANNER}</Text>
    </View>
  );
}

function QueueView() {
  const { data, isLoading, isError, refetch, isRefetching } = useProviderRxQueue();

  if (isLoading) return <StateView kind="loading" message="Loading queue…" />;
  if (isError) return <StateView kind="error" title="Couldn't load queue" message="Please try again." actionLabel="Retry" onAction={refetch} />;

  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(r) => r.rxId}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      onRefresh={refetch}
      refreshing={isRefetching}
      ListHeaderComponent={<RxBanner />}
      renderItem={({ item }: { item: ProviderRxQueueItem }) => (
        <Pressable
          style={[styles.card, shadow1]}
          onPress={() => router.push({ pathname: '/health/pharmacy/provider/rx-verify', params: { id: item.rxId } })}
        >
          <View style={styles.head}>
            <View style={[styles.icon, { backgroundColor: Colors.iconBgBlue }]}>
              <ScrollText size={18} color={Colors.secondary} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{item.patientName}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {item.prescriberName ? `Dr ${item.prescriberName} · ` : ''}
                {item.itemCount} item{item.itemCount === 1 ? '' : 's'} · {relativeTime(item.uploadedAt)}
              </Text>
            </View>
            <PharmacyStatusPill rx={item.status} />
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </View>
        </Pressable>
      )}
      ListEmptyComponent={
        <StateView kind="empty" icon="ScrollText" title="Queue is clear" message="No prescriptions awaiting verification." />
      }
    />
  );
}

function DetailView({ id }: { id: string }) {
  const { data, isLoading, isError, refetch } = usePrescription(id);
  const decide = useDecideRx();
  const [mode, setMode] = useState<'idle' | 'clarify' | 'reject'>('idle');
  const [note, setNote] = useState('');

  if (isLoading) return <StateView kind="loading" message="Loading prescription…" />;
  if (isError || !data) {
    return (
      <StateView
        kind="error"
        title="Couldn't load prescription"
        message="Please try again."
        actionLabel="Back to queue"
        onAction={() => router.replace('/health/pharmacy/provider/rx-verify')}
      />
    );
  }

  const submit = async (decision: 'approve' | 'clarify' | 'reject') => {
    await decide.mutateAsync({ rxId: data.id, decision, note: note.trim() || undefined });
    router.replace('/health/pharmacy/provider/rx-verify');
  };

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <RxBanner />

      {/* Document card */}
      <View style={[styles.docCard, shadow1]}>
        <View style={[styles.docThumb, { backgroundColor: data.docColor }]}>
          <ScrollText size={28} color={Colors.white} strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.docPatient}>{data.patientName}</Text>
          <Text style={styles.docSub}>
            {data.prescriberName ? `Prescriber: Dr ${data.prescriberName}` : 'Prescriber not stated'}
          </Text>
          <Text style={styles.docSub}>Uploaded {formatDate(data.uploadedAt)}</Text>
          <View style={{ marginTop: Spacing.xs }}>
            <PharmacyStatusPill rx={data.status} />
          </View>
        </View>
      </View>

      {/* Items */}
      <Text style={styles.sectionTitle}>Prescribed items</Text>
      <View style={[styles.itemsCard, shadow1]}>
        {data.items.map((it, i) => (
          <View key={`${it.name}-${i}`} style={[styles.itemRow, i > 0 && styles.itemRowBordered]}>
            <View style={[styles.itemIcon, { backgroundColor: Colors.iconBgBlue }]}>
              <Pill size={16} color={Colors.secondary} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{it.name}</Text>
              <Text style={styles.itemMeta}>{it.dosage} · {it.quantity}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Clarify / reject note */}
      {mode !== 'idle' ? (
        <View style={styles.noteWrap}>
          {mode === 'reject' ? (
            <View style={styles.warnRow}>
              <CircleAlert size={14} color={Colors.error} strokeWidth={2} />
              <Text style={styles.warnText}>A reason is required to reject this prescription.</Text>
            </View>
          ) : null}
          <TextInputField
            label={mode === 'clarify' ? 'What clarification is needed?' : 'Reason for rejection'}
            placeholder={mode === 'clarify' ? 'e.g. Dosage unclear, please confirm…' : 'e.g. Prescriber could not be verified'}
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
          />
        </View>
      ) : null}

      {/* Actions */}
      <View style={styles.actions}>
        {mode === 'idle' ? (
          <>
            <PrimaryButton label="Approve prescription" onPress={() => submit('approve')} loading={decide.isPending} />
            <PrimaryButton label="Request clarification" variant="secondary" onPress={() => setMode('clarify')} />
            <PrimaryButton label="Reject" variant="danger" onPress={() => setMode('reject')} />
          </>
        ) : mode === 'clarify' ? (
          <>
            <PrimaryButton label="Send clarification request" onPress={() => submit('clarify')} loading={decide.isPending} disabled={!note.trim()} />
            <PrimaryButton label="Cancel" variant="ghost" onPress={() => { setMode('idle'); setNote(''); }} />
          </>
        ) : (
          <>
            <PrimaryButton label="Confirm rejection" variant="danger" onPress={() => submit('reject')} loading={decide.isPending} disabled={!note.trim()} />
            <PrimaryButton label="Cancel" variant="ghost" onPress={() => { setMode('idle'); setNote(''); }} />
          </>
        )}
      </View>
    </ScrollView>
  );
}

export default function ProviderRxVerifyScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : undefined;
  const hasId = Boolean(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={hasId ? 'Verify prescription' : 'Rx verification'}
        subtitle={hasId ? 'Approve, clarify or reject' : 'Pending prescriptions'}
        onBack={hasId ? () => router.replace('/health/pharmacy/provider/rx-verify') : undefined}
      />
      {hasId && id ? <DetailView id={id} /> : <QueueView />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 100, flexGrow: 1 },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  bannerText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  docCard: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  docThumb: { width: 64, height: 80, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  docPatient: { ...Typography.titleMd, color: Colors.onSurface },
  docSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  itemsCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  itemRowBordered: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  itemIcon: { width: 32, height: 32, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  itemName: { ...Typography.labelLg, color: Colors.onSurface },
  itemMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  noteWrap: { gap: Spacing.xs },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  warnText: { ...Typography.labelSm, color: Colors.error },
  actions: { gap: Spacing.sm },
});
