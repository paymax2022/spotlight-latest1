// A doctor's timed price list. One press publishes (or re-prices) a price point;
// the booking picker reads the same rows immediately afterwards. The engine
// upserts on (owner, vertical, mode, duration), so re-publishing the same
// combination is a price edit, never a duplicate.

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Phone, Video } from 'lucide-react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { formatNaira } from '@/utils/money';
import { useAuthStore } from '@/store/authStore';
import { TeleHeader } from '@/features/telemedicine/components';
import { listConsultPackages, publishConsultPackage } from '@/features/consult/api';
import { nairaToKobo, packagePayload, validatePackageDraft, type PackageDraft } from '@/features/consult/packages';
import {
  CONSULT_MODE_LABEL,
  type ConsultMode,
  type ConsultPackageWire,
} from '@/features/consult/types';

const MODES: ConsultMode[] = ['video', 'voice', 'chat'];
const DURATIONS = [15, 20, 30, 45, 60];
const OWNER = { ownerKind: 'doctor' as const, vertical: 'telemedicine' as const };

const MODE_ICON = {
  video: Video,
  voice: Phone,
  chat: MessageCircle,
} as const;

export default function DoctorConsultPackagesScreen() {
  const userId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<PackageDraft>({
    mode: 'video',
    durationMinutes: 30,
    priceNaira: '2000',
  });
  const [error, setError] = useState<string | null>(null);

  const packages = useQuery({
    queryKey: ['consult', 'packages', 'doctor', userId],
    queryFn: () => listConsultPackages({ ...OWNER, ownerId: userId as string }),
    enabled: Boolean(userId),
    staleTime: 0,
  });

  const publish = useMutation({
    mutationFn: () =>
      publishConsultPackage(packagePayload(draft, { ...OWNER, ownerId: userId as string })),
    onSuccess: (saved) => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['consult', 'packages', 'doctor', userId] });
      // Keep the form on what was just saved, so a price edit loops naturally.
      setDraft((d) => ({ ...d, mode: saved.mode, durationMinutes: saved.duration_minutes, priceNaira: String(saved.price_kobo / 100) }));
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save this package.'),
  });

  const save = () => {
    const problem = validatePackageDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    publish.mutate();
  };

  const rows = packages.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Consultation prices" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Set what a timed {`video, voice or chat`} consultation costs. Patients pick one of these
          before booking, and the timer follows the duration you set here.
        </Text>

        <Text style={styles.label}>Published</Text>
        {packages.isLoading ? (
          <ActivityIndicator color={Colors.primary} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>
            No packages yet. Until you publish one, patients book at your legacy consultation fee.
          </Text>
        ) : (
          <View style={styles.list}>
            {rows.map((pkg) => (
              <PackageRow key={pkg.id} pkg={pkg} onEdit={() => {
                setDraft({ mode: pkg.mode, durationMinutes: pkg.duration_minutes, priceNaira: String(pkg.price_kobo / 100) });
              }} />
            ))}
          </View>
        )}

        <Text style={[styles.label, { marginTop: Spacing.lg }]}>Add or update a price</Text>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Mode</Text>
          <View style={styles.chips}>
            {MODES.map((mode) => {
              const selected = draft.mode === mode;
              const Icon = MODE_ICON[mode];
              return (
                <Pressable
                  key={mode}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setDraft((d) => ({ ...d, mode }))}
                >
                  <Icon size={14} color={selected ? Colors.onPrimary : Colors.onSurface} />
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                    {CONSULT_MODE_LABEL[mode]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>Duration</Text>
          <View style={styles.chips}>
            {DURATIONS.map((minutes) => {
              const selected = draft.durationMinutes === minutes;
              return (
                <Pressable
                  key={minutes}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setDraft((d) => ({ ...d, durationMinutes: minutes }))}
                >
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                    {minutes} min
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            style={styles.input}
            value={String(draft.durationMinutes)}
            onChangeText={(text) =>
              setDraft((d) => ({ ...d, durationMinutes: Number(text.replace(/[^0-9]/g, '')) }))
            }
            keyboardType="number-pad"
            placeholder="Custom minutes (5–480)"
            placeholderTextColor={Colors.outline}
          />

          <Text style={styles.fieldLabel}>Price (₦)</Text>
          <TextInput
            style={styles.input}
            value={draft.priceNaira}
            onChangeText={(priceNaira) => setDraft((d) => ({ ...d, priceNaira }))}
            keyboardType="decimal-pad"
            placeholder="2000"
            placeholderTextColor={Colors.outline}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.publishButton, publish.isPending && styles.disabled]}
            disabled={publish.isPending || !userId}
            onPress={save}
          >
            {publish.isPending ? (
              <ActivityIndicator size="small" color={Colors.onPrimary} />
            ) : (
              <Text style={styles.publishLabel}>Publish {formatNaira(nairaToKobo(draft.priceNaira), { decimals: false })}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PackageRow({ pkg, onEdit }: { pkg: ConsultPackageWire; onEdit: () => void }) {
  const Icon = MODE_ICON[pkg.mode];
  return (
    <Pressable style={styles.row} onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${pkg.mode} ${pkg.duration_minutes} minute package`}>
      <View style={styles.rowIcon}>
        <Icon size={18} color={Colors.primary} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>
          {CONSULT_MODE_LABEL[pkg.mode]} · {pkg.duration_minutes} min
        </Text>
        <Text style={styles.rowSub}>{formatNaira(pkg.price_kobo, { decimals: false })}</Text>
      </View>
      <Text style={styles.edit}>Edit</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  intro: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  label: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  list: { gap: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  edit: { ...Typography.labelMd, color: Colors.secondary },
  card: {
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    gap: Spacing.sm,
  },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  chipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipLabel: { ...Typography.labelMd, color: Colors.onSurface },
  chipLabelSelected: { color: Colors.onPrimary },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.bodyMd,
    color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerLow,
  },
  publishButton: {
    marginTop: Spacing.sm,
    borderRadius: Radius.full,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: Colors.primary,
  },
  publishLabel: { ...Typography.labelLg, color: Colors.onPrimary },
  disabled: { opacity: 0.5 },
  error: { ...Typography.bodySm, color: Colors.error },
});
