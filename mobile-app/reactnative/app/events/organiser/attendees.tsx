import React, { useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, Platform, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Circle, X } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { alertAsync, confirmAsync } from '@/lib/confirm';
import { useAttendees, useEvent, useIssueComp, useAnnounce } from '@/features/events/hooks';
import { fetchAttendeesCsv, idempotencyKey, lifecycleErrorMessage } from '@/features/events/api';
import { EventColors, EVENTS_COMPS_ENABLED } from '@/features/events/constants/events.constants';

// Handles/@cashtags separated by commas, semicolons, whitespace or newlines;
// de-duplicated case-insensitively, empties dropped. The server resolves them.
function parseRecipients(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of raw.split(/[\s,;]+/)) {
    const t = tok.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// Shares a CSV string as a file: browser download on web, cache file + system
// share sheet on native, plain-text Share if file sharing is unavailable.
async function shareCsv(csv: string, fileName: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }
  try {
    // Lazily required so the web bundle never pulls in the native modules.
    const Sharing = require('expo-sharing');
    if (await Sharing.isAvailableAsync()) {
      const { File, Paths } = require('expo-file-system');
      const file = new File(Paths.cache, fileName);
      if (file.exists) file.delete();
      file.create();
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Export attendees' });
      return;
    }
  } catch (err) {
    console.warn('[events] CSV file share failed, falling back to text share', err);
  }
  await Share.share({ message: csv, title: fileName });
}

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'checked-in', label: 'Checked in' },
  { value: 'pending', label: 'Pending' },
] as const;

export default function Attendees() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { data, isLoading, isError, refetch } = useAttendees(eventId ?? '');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'checked-in' | 'pending'>('all');

  // Comps/export/announce — all inert unless EVENTS_COMPS_ENABLED.
  const event = useEvent(EVENTS_COMPS_ENABLED ? eventId ?? '' : '');
  const issueComp = useIssueComp(eventId ?? '');
  const announce = useAnnounce(eventId ?? '');
  const [sheet, setSheet] = useState<'comp' | 'announce' | null>(null);
  const [tierId, setTierId] = useState('');
  const [recipientsRaw, setRecipientsRaw] = useState('');
  const [note, setNote] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [exporting, setExporting] = useState(false);
  // One idempotency key per user intent: minted on first submit, reused when
  // the same payload is retried, cleared on success or when the draft changes.
  const compKey = useRef<string | null>(null);
  const announceKey = useRef<string | null>(null);
  const tiers = event.data?.tiers ?? [];

  const submitComp = async () => {
    const recipients = parseRecipients(recipientsRaw);
    if (!tierId) { await alertAsync({ title: 'Pick a tier', message: 'Choose which tier the comp tickets are for.' }); return; }
    if (recipients.length === 0) { await alertAsync({ title: 'Add recipients', message: 'Enter at least one handle or @cashtag.' }); return; }
    const idemKey = (compKey.current ??= idempotencyKey());
    const trimmedNote = note.trim();
    setSheet(null); // dismiss before any alert (iOS can't present an alert over a Modal)
    try {
      const tickets = await issueComp.mutateAsync({ input: { tier_id: tierId, recipients, note: trimmedNote || undefined }, idemKey });
      compKey.current = null;
      setRecipientsRaw('');
      setNote('');
      await alertAsync({ title: 'Comps issued', message: `Issued ${tickets?.length ?? recipients.length} complimentary ticket(s).` });
    } catch (err) {
      await alertAsync({ title: "Couldn't issue comps", message: lifecycleErrorMessage(err) });
      setSheet('comp');
    }
  };

  const submitAnnounce = async () => {
    const subj = subject.trim();
    const text = body.trim();
    if (!subj || !text) { await alertAsync({ title: 'Subject and message required', message: 'Fill in both before sending.' }); return; }
    setSheet(null);
    const ok = await confirmAsync({ title: 'Send announcement?', message: 'This goes to every ticket holder and cannot be recalled.', confirmLabel: 'Send' });
    if (!ok) { setSheet('announce'); return; }
    const idemKey = (announceKey.current ??= idempotencyKey());
    try {
      const res = await announce.mutateAsync({ input: { subject: subj, body: text }, idemKey });
      announceKey.current = null;
      setSubject('');
      setBody('');
      await alertAsync({ title: 'Announcement sent', message: `Sent to ${res.recipient_count} attendee${res.recipient_count === 1 ? '' : 's'}.` });
    } catch (err) {
      await alertAsync({ title: "Couldn't send announcement", message: lifecycleErrorMessage(err) });
      setSheet('announce');
    }
  };

  const exportCsv = async () => {
    if (exporting || !eventId) return;
    setExporting(true);
    try {
      const csv = await fetchAttendeesCsv(eventId);
      await shareCsv(csv, `attendees-${eventId}.csv`);
    } catch (err) {
      await alertAsync({ title: "Couldn't export attendees", message: lifecycleErrorMessage(err) });
    } finally {
      setExporting(false);
    }
  };

  const list = useMemo(() => {
    let arr = data ?? [];
    if (filter === 'checked-in') arr = arr.filter((a) => a.checked_in);
    if (filter === 'pending') arr = arr.filter((a) => !a.checked_in);
    if (q.trim()) {
      const s = q.toLowerCase();
      arr = arr.filter((a) => a.name.toLowerCase().includes(s) || a.cashtag.toLowerCase().includes(s));
    }
    return arr;
  }, [data, filter, q]);

  const checkedIn = (data ?? []).filter((a) => a.checked_in).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Attendees" subtitle={data ? `${checkedIn}/${data.length} checked in` : undefined} />
      {EVENTS_COMPS_ENABLED ? (
        <View style={styles.actions}>
          <PrimaryButton label="Issue comp" variant="secondary" fullWidth={false} onPress={() => setSheet('comp')} style={styles.actionBtn} />
          <PrimaryButton label="Export CSV" variant="secondary" fullWidth={false} onPress={exportCsv} loading={exporting} style={styles.actionBtn} />
          <PrimaryButton label="Announce" variant="secondary" fullWidth={false} onPress={() => setSheet('announce')} style={styles.actionBtn} />
        </View>
      ) : null}
      <SearchBar placeholder="Search by name or cashtag…" value={q} onChangeText={setQ} />
      <View style={{ marginBottom: Spacing.md }}>
        <SegmentedControl options={FILTERS as any} value={filter} onChange={setFilter} />
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading attendees…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load attendees" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : list.length === 0 ? (
        <StateView kind="empty" title="No attendees" message="No one matches this filter yet." icon="Users" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {list.map((a) => (
            <View key={a.id} style={styles.row}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{a.name.charAt(0)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{a.name}</Text>
                <Text style={styles.sub}>{a.cashtag} · {a.tier_name}</Text>
              </View>
              {a.checked_in ? (
                <View style={styles.statusIn}><CheckCircle2 size={18} color={EventColors.ok} /><Text style={styles.statusInText}>In</Text></View>
              ) : (
                <View style={styles.statusOut}><Circle size={18} color={EventColors.muted} /><Text style={styles.statusOutText}>Pending</Text></View>
              )}
            </View>
          ))}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}

      {EVENTS_COMPS_ENABLED ? (
        <>
          <Modal visible={sheet === 'comp'} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
            <Pressable style={styles.backdrop} onPress={() => setSheet(null)} />
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Issue complimentary tickets</Text>
                <Pressable onPress={() => setSheet(null)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={styles.fieldLabel}>Tier</Text>
                {event.isLoading ? (
                  <Text style={styles.sub}>Loading tiers…</Text>
                ) : tiers.length === 0 ? (
                  <Text style={styles.sub}>This event has no tiers yet.</Text>
                ) : (
                  <View style={styles.chips}>
                    {tiers.map((t) => (
                      <Pressable
                        key={t.id}
                        onPress={() => { setTierId(t.id); compKey.current = null; }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: tierId === t.id }}
                        style={[styles.chip, tierId === t.id && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, tierId === t.id && styles.chipTextActive]}>{t.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                <TextInputField
                  label="Recipients"
                  placeholder="@handle, @cashtag (comma or line separated)"
                  value={recipientsRaw}
                  onChangeText={(v) => { setRecipientsRaw(v); compKey.current = null; }}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TextInputField
                  label="Note (optional)"
                  placeholder="Message shown with the ticket"
                  value={note}
                  onChangeText={(v) => { setNote(v); compKey.current = null; }}
                />
                <PrimaryButton label="Issue comps" onPress={submitComp} loading={issueComp.isPending} style={styles.btn} />
              </ScrollView>
            </View>
          </Modal>

          <Modal visible={sheet === 'announce'} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
            <Pressable style={styles.backdrop} onPress={() => setSheet(null)} />
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Announce to attendees</Text>
                <Pressable onPress={() => setSheet(null)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <TextInputField label="Subject" placeholder="e.g. Doors open at 6pm" value={subject} onChangeText={(v) => { setSubject(v); announceKey.current = null; }} />
                <TextInputField label="Message" placeholder="Write your announcement" value={body} onChangeText={(v) => { setBody(v); announceKey.current = null; }} multiline />
                <PrimaryButton label="Send announcement" onPress={submitAnnounce} loading={announce.isPending} style={styles.btn} />
              </ScrollView>
            </View>
          </Modal>
        </>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  actionBtn: { flexGrow: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '85%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle: { ...Typography.titleMd, color: Colors.onSurface },
  fieldLabel: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: Spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  chipActive: { backgroundColor: EventColors.brand },
  chipText: { ...Typography.labelLg, color: Colors.onSurface },
  chipTextActive: { color: Colors.onPrimary },
  btn: { marginTop: Spacing.md },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  avatar: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleMd, color: EventColors.brand },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: EventColors.muted, marginTop: 2 },
  statusIn: { alignItems: 'center', gap: 2 },
  statusInText: { ...Typography.caption, color: EventColors.ok },
  statusOut: { alignItems: 'center', gap: 2 },
  statusOutText: { ...Typography.caption, color: EventColors.muted },
});
