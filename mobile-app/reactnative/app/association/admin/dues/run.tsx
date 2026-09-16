// ── Association — Raise dues for a roster (money path) ────────────────────────
//
// This screen bills every matching ACTIVE member at once, so two things matter
// more than the layout:
//
//  1. The Idempotency-Key is minted ONCE, when the admin commits to the run,
//     and reused by every retry of that run. A key minted per attempt is what
//     turns a client-side timeout on a run the server actually committed into a
//     second billing of the whole roster.
//  2. A replayed key comes back with `alreadyRaised: true` and the ORIGINAL
//     run's counts. Those counts must be labelled as a replay — reading them as
//     fresh invoices would tell an admin they had just double-billed.

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { CheckCircle2, History } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import { useIdempotencyKey } from '@/utils/idempotency';
import AdminFormScreen from '@/features/association/components/AdminFormScreen';
import { DUES_CAPABILITY } from '@/features/association/utils/authoringAccess';
import {
  FormCard, ChoiceRow, OptionSelect, NotifyToggle, DateTimeField, FormNotice,
} from '@/features/association/components/AdminFormControls';
import { useRunDues, useOrgPickerLists } from '@/features/association/hooks/useAuthoring';
import { useAdminAccess } from '@/features/association/hooks/useAdminMembers';
import { formatNaira } from '@/features/association/utils/associationFormatters';
import { INVOICE_SCOPE_OPTIONS, type DuesRunResult, type InvoiceScope } from '@/features/association/types/authoring.types';

export default function RunDuesScreen() {
  const access = useAdminAccess();
  const orgId = access.data?.organisationId ?? null;
  const lists = useOrgPickerLists(orgId);
  const run = useRunDues(orgId);

  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<InvoiceScope>('NATIONAL');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [notify, setNotify] = useState(false);
  const [result, setResult] = useState<DuesRunResult | null>(null);

  // One key per intended run. `reset()` is called only when the admin starts a
  // NEW run — never between retries of the same one.
  const { key, reset } = useIdempotencyKey();

  const categoryOptions = useMemo(
    () => (lists.data?.categories ?? []).map((c) => ({
      value: c.id,
      label: `${c.label} · ${formatNaira(c.duesKobo)}`,
    })),
    [lists.data],
  );
  const chapterOptions = useMemo(
    () => (lists.data?.chapters ?? []).map((c) => ({ value: c.id, label: c.name })),
    [lists.data],
  );

  const titleInvalid = title.trim() === '';

  const doRun = () => {
    run.mutate(
      {
        input: {
          title: title.trim(),
          scope,
          dueDate,
          categoryId,
          chapterId,
          notify,
        },
        idempotencyKey: key,
      },
      {
        onSuccess: (res) => setResult(res),
        onError: (e) => alertAsync({
          title: 'Dues run failed',
          message: `${(e as Error)?.message ?? 'Please try again.'}\n\nRetrying is safe — the same key is reused, so a run that did commit will not be billed twice.`,
        }),
      },
    );
  };

  const onSave = async () => {
    if (titleInvalid) return;
    const scopeLabel = INVOICE_SCOPE_OPTIONS.find((s) => s.value === scope)?.label ?? scope;
    const narrowing = [
      categoryId ? categoryOptions.find((c) => c.value === categoryId)?.label : null,
      chapterId ? chapterOptions.find((c) => c.value === chapterId)?.label : null,
    ].filter(Boolean);

    const ok = await confirmAsync({
      title: 'Raise dues?',
      message: [
        `“${title.trim()}” (${scopeLabel}) will raise one invoice for every active member`,
        narrowing.length ? `in ${narrowing.join(' · ')}` : 'with a priced membership category',
        '.',
        notify ? '\n\nEvery invoiced member will be notified.' : '',
      ].join(''),
      confirmLabel: 'Raise dues',
    });
    if (!ok) return;
    doRun();
  };

  const startAnother = () => {
    reset();
    setResult(null);
    setTitle('');
    setCategoryId(null);
    setChapterId(null);
    setDueDate(null);
  };

  return (
    <AdminFormScreen
      title="Raise dues"
      capability={DUES_CAPABILITY}
      saveLabel={result ? 'Start another run' : 'Raise dues'}
      saving={run.isPending}
      saveDisabled={!result && titleInvalid}
      onSave={() => (result ? startAnother() : onSave())}
    >
      {() => (
        <>
          {result ? <RunResultCard result={result} /> : null}

          {result ? null : (
            <>
              <FormCard>
                <TextInputField
                  label="Run title"
                  placeholder="e.g. 2026 annual dues"
                  value={title}
                  onChangeText={setTitle}
                  error={titleInvalid ? 'A title is required — members see it on the invoice.' : undefined}
                />
                <ChoiceRow label="Scope" options={INVOICE_SCOPE_OPTIONS} value={scope} onChange={setScope} />
                <DateTimeField label="Due date" value={dueDate} onChange={setDueDate} optional timeRequired={false} />
                <Text style={styles.hint}>
                  Leave the due date blank for an open-ended invoice; members then see “No due date” rather than a deadline.
                </Text>
              </FormCard>

              <FormCard title="Who gets billed">
                <OptionSelect
                  label="Membership category"
                  clearLabel="Every category"
                  options={categoryOptions}
                  value={categoryId}
                  onChange={setCategoryId}
                  disabled={lists.isLoading}
                />
                <OptionSelect
                  label="Chapter"
                  clearLabel="Every chapter"
                  options={chapterOptions}
                  value={chapterId}
                  onChange={setChapterId}
                  disabled={lists.isLoading}
                />
                <FormNotice
                  tone="info"
                  text="Each member is priced from their own membership category. Members with no category, or a category priced at ₦0, are skipped rather than billed nothing."
                />
                <NotifyToggle value={notify} onChange={setNotify} audience="every member this run invoices" />
              </FormCard>
            </>
          )}

          <PrimaryButton
            label="View previous runs"
            variant="ghost"
            onPress={() => router.push('/association/admin/dues')}
          />
        </>
      )}
    </AdminFormScreen>
  );
}

function RunResultCard({ result }: { result: DuesRunResult }) {
  const replay = result.alreadyRaised;
  return (
    <View style={[styles.resultCard, shadow1, replay && styles.resultCardReplay]}>
      <View style={styles.resultHeader}>
        {replay
          ? <History size={20} color={Colors.onWarning} strokeWidth={2.2} />
          : <CheckCircle2 size={20} color={Colors.teal} strokeWidth={2.2} />}
        <Text style={[styles.resultTitle, replay && { color: Colors.onWarning }]}>
          {replay ? 'Nothing new was raised' : 'Dues raised'}
        </Text>
      </View>

      {replay ? (
        <Text style={styles.replayBody}>
          This run had already been submitted, so the server replayed it: <Text style={styles.replayStrong}>no new
          invoices were created and no member was billed again.</Text> The figures below are the original run&apos;s.
        </Text>
      ) : null}

      <View style={styles.statRow}>
        <Stat label="Invoiced" value={result.invoiced.toLocaleString('en-NG')} tone="teal" />
        <Stat label="Skipped" value={result.skipped.toLocaleString('en-NG')} />
        <Stat label="Total raised" value={formatNaira(result.totalKobo)} />
      </View>

      <Text style={styles.runId}>Run {result.runId}</Text>
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'teal' }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone === 'teal' && { color: Colors.teal }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant },
  resultCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm,
  },
  resultCardReplay: { backgroundColor: Colors.iconBgGold, borderColor: Colors.gold },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  resultTitle: { ...Typography.titleMd, color: Colors.onSurface },
  replayBody: { ...Typography.bodySm, color: Colors.onWarning },
  replayStrong: { fontWeight: '700' as const },
  statRow: { flexDirection: 'row', gap: Spacing.sm },
  stat: {
    flex: 1, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md,
    padding: Spacing.sm, gap: 2,
  },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  runId: { ...Typography.caption, color: Colors.outline },
});
