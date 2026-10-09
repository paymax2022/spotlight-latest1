import { CADENCE_LABEL, CHAT_SCOPE_ICON, GROUP_TYPE_LABEL, INVOICE_STATUS_STYLE, MEMBER_STATUS_STYLE, PAYMENT_STANDING_STYLE, WIZARD_STEPS } from '../constants';
import { useAdminAccess, useValidateCode } from '../hooks';
import { ContentKind, useAdminContent, useAdminContentRow } from '../hooks/useAuthoring';
import type { ChatMessage, ChatThreadSummary, CodeKind, CodeValidation } from '../types';
import type { DuesInvoice, InvoiceStatus, MemberProfileSummary, MemberStatus, MembershipCard, OrganisationSummary, PaymentStanding } from '../types/association.types';
import type { AdminContentRow } from '../types/authoring.types';
import { AuthoringCapability, dueLabel, formatCount, formatDate, formatDateTime, formatNaira, hasAuthoringCapability, initials, relativeTime } from '../utils';
import PrimaryButton from '@/components/PrimaryButton';
import QrCodeView from '@/components/QrCodeView';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import { Colors, Radius, Spacing, Typography, shadow1, shadow3 } from '@/constants/tokens';
import type { CommitteeInput } from '@/features/association/api/authoring.api';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { BadgeCheck, BellOff, Building2, CalendarDays, CheckCircle2, ChevronRight, Clock, CreditCard, FileText, GitBranch, IdCard, KeyRound, ListTodo, MessageCircle, Pin, Plus, ShieldAlert, ShieldCheck, Sparkles, Ticket, Users, Vote, XCircle } from 'lucide-react-native';
import React, { useState } from 'react';
import { FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';


// There is no per-item admin GET: the org-scoped listings already carry every
// field the edit forms need inside `meta`, so the row is looked up in that
// listing rather than inventing an endpoint the server does not serve.

interface AdminContentEditorProps {
  kind:   ContentKind;
  id?:    string;
  title:  string;
  /** Rendered once the row is resolved. */
  render: (row: AdminContentRow) => React.ReactNode;
  /** Where "Back to list" goes when the row cannot be found. */
  listRoute: string;
}

export function AdminContentEditor({ kind, id, title, render, listRoute }: AdminContentEditorProps) {
  const access = useAdminAccess();
  const orgId = access.data?.organisationId ?? null;
  const { row, isLoading, isError, error, refetch } = useAdminContentRow(kind, orgId, id);

  if (access.isLoading || isLoading) {
    return (
      <SafeAreaView style={adminContentEditorStyles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={adminContentEditorStyles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView
          kind="error"
          title="Couldn't load"
          message={(error as Error)?.message ?? 'Please try again.'}
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </SafeAreaView>
    );
  }

  if (!row) {
    return (
      <SafeAreaView style={adminContentEditorStyles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView
          kind="empty"
          icon="SearchX"
          title="Not found"
          message="This item is no longer in the list — it may have been deleted."
          actionLabel="Back to list"
          onAction={() => router.replace(listRoute)}
        />
      </SafeAreaView>
    );
  }

  return <>{render(row)}</>;
}

const adminContentEditorStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
});

// they render through one list instead of six near-identical screens.

interface AdminContentListProps {
  kind:      ContentKind;
  title:     string;
  /** Which capability gates authoring here. */
  capability: AuthoringCapability;
  newLabel:  string;
  emptyTitle: string;
  emptyMessage: string;
  emptyIcon?: string;
  onNew:     (orgId: string) => void;
  onOpen?:   (row: AdminContentRow) => void;
  /** Extra line under the title, e.g. "Paid · ₦5,000". */
  describe?: (row: AdminContentRow) => string | null;
}

export function AdminContentList({
  kind, title, capability, newLabel, emptyTitle, emptyMessage, emptyIcon,
  onNew, onOpen, describe,
}: AdminContentListProps) {
  const access = useAdminAccess();
  const orgId = access.data?.organisationId ?? null;
  const rows = useAdminContent(kind, orgId);

  const canManage = hasAuthoringCapability(access.data, capability);

  if (access.isLoading) {
    return (
      <SafeAreaView style={adminContentListStyles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView kind="loading" message="Checking your access…" />
      </SafeAreaView>
    );
  }

  // RBAC gate — mirrors the console dashboard rather than letting the screen
  // render and fail at the first write with a 403.
  if (!canManage) {
    return (
      <SafeAreaView style={adminContentListStyles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView
          kind="empty"
          icon="Lock"
          title="Not available for your role"
          message={`Your role (${access.data?.roleLabel ?? 'member'}) cannot manage ${title.toLowerCase()} for this organisation.`}
        />
      </SafeAreaView>
    );
  }

  // An admin with no organisation on their access DTO has nothing to scope the
  // calls with; say so instead of firing requests at `/organisations/undefined`.
  if (!orgId) {
    return (
      <SafeAreaView style={adminContentListStyles.safe} edges={['top']}>
        <ScreenHeader title={title} subtitle={access.data?.organisationName ?? undefined} />
        <StateView
          kind="empty"
          icon="Building2"
          title="No organisation linked"
          message="Your admin role isn't attached to an organisation yet, so there is nothing to author against."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={adminContentListStyles.safe} edges={['top']}>
      <ScreenHeader title={title} subtitle={access.data?.organisationName ?? undefined} />

      {rows.isLoading ? (
        <StateView kind="loading" message={`Loading ${title.toLowerCase()}…`} />
      ) : rows.isError ? (
        <StateView
          kind="error"
          title="Couldn't load"
          message={(rows.error as Error)?.message ?? 'Please try again.'}
          actionLabel="Retry"
          onAction={() => rows.refetch()}
        />
      ) : (rows.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon={emptyIcon} title={emptyTitle} message={emptyMessage} />
      ) : (
        <FlatList
          data={rows.data ?? []}
          keyExtractor={(r) => r.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={adminContentListStyles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          refreshing={rows.isRefetching}
          onRefresh={() => rows.refetch()}
          renderItem={({ item }) => (
            <Pressable
              style={[adminContentListStyles.row, shadow1]}
              onPress={() => onOpen?.(item)}
              disabled={!onOpen}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.title}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={adminContentListStyles.rowTitle} numberOfLines={1}>{item.title}</Text>
                {item.subtitle ? <Text style={adminContentListStyles.rowSub} numberOfLines={1}>{item.subtitle}</Text> : null}
                <Text style={adminContentListStyles.rowMeta} numberOfLines={1}>
                  {formatDateTime(item.at, 'No date set')}
                  {describe?.(item) ? ` · ${describe(item)}` : ''}
                </Text>
              </View>
              {item.status ? (
                <View style={adminContentListStyles.statusChip}><Text style={adminContentListStyles.statusText}>{item.status}</Text></View>
              ) : null}
              {onOpen ? <ChevronRight size={18} color={Colors.outline} strokeWidth={2} /> : null}
            </Pressable>
          )}
        />
      )}

      <View style={adminContentListStyles.footer}>
        <PrimaryButton label={newLabel} onPress={() => onNew(orgId)} />
      </View>
    </SafeAreaView>
  );
}

/** Small "+ New" affordance for screens that want it in the header slot. */
export function NewContentButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={adminContentListStyles.headerBtn}>
      <Plus size={20} color={Colors.primary} strokeWidth={2.4} />
    </Pressable>
  );
}

const adminContentListStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 140 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
  },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  rowMeta: { ...Typography.caption, color: Colors.outline, marginTop: 2 },
  statusChip: {
    backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
  },
  statusText: { ...Typography.caption, color: Colors.onSurfaceVariant, fontWeight: '700' as const },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
  headerBtn: {
    width: 40, height: 40, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple,
  },
});

// Every authoring form needs the same three things before it can render a
// single field: the caller's admin access, the capability gate for this content
// type, and the organisation id to scope the write with. Doing that once here
// keeps a missing gate from being a per-screen oversight.

interface AdminFormScreenProps {
  title:      string;
  capability: AuthoringCapability;
  /** Rendered once the org id is known. */
  children:   (orgId: string) => React.ReactNode;
  saveLabel:  string;
  onSave:     (orgId: string) => void;
  saving?:    boolean;
  saveDisabled?: boolean;
  /** Optional destructive action rendered under the primary button. */
  onDelete?:  () => void;
  deleteLabel?: string;
  deleting?:  boolean;
}

export function AdminFormScreen({
  title, capability, children, saveLabel, onSave, saving, saveDisabled,
  onDelete, deleteLabel = 'Delete', deleting,
}: AdminFormScreenProps) {
  const access = useAdminAccess();
  const orgId = access.data?.organisationId ?? null;
  const allowed = hasAuthoringCapability(access.data, capability);

  if (access.isLoading) {
    return (
      <SafeAreaView style={adminFormScreenStyles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView kind="loading" message="Checking your access…" />
      </SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={adminFormScreenStyles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView
          kind="empty"
          icon="Lock"
          title="Not available for your role"
          message={`Your role (${access.data?.roleLabel ?? 'member'}) cannot do this for this organisation.`}
        />
      </SafeAreaView>
    );
  }

  if (!orgId) {
    return (
      <SafeAreaView style={adminFormScreenStyles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView
          kind="empty"
          icon="Building2"
          title="No organisation linked"
          message="Your admin role isn't attached to an organisation yet, so there is nothing to author against."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={adminFormScreenStyles.safe} edges={['top']}>
      <ScreenHeader title={title} subtitle={access.data?.organisationName ?? undefined} />
      <KeyboardAvoidingView
        style={adminFormScreenStyles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={adminFormScreenStyles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {children(orgId)}
        </ScrollView>
        <View style={adminFormScreenStyles.footer}>
          <PrimaryButton
            label={saveLabel}
            onPress={() => onSave(orgId)}
            loading={saving}
            disabled={saveDisabled}
          />
          {onDelete ? (
            <PrimaryButton label={deleteLabel} variant="danger" onPress={onDelete} loading={deleting} />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const adminFormScreenStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 40, gap: Spacing.md },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
    gap: Spacing.sm,
  },
});

interface ChatThreadRowProps {
  thread: ChatThreadSummary;
  onPress: () => void;
}

export function ChatThreadRow({ thread: t, onPress }: ChatThreadRowProps) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[CHAT_SCOPE_ICON[t.scope]] ?? Icons.MessageCircle;
  const hasUnread = t.unreadCount > 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t.title}${hasUnread ? `, ${t.unreadCount} unread` : ''}`}
      style={({ pressed }) => [chatThreadRowStyles.row, pressed && chatThreadRowStyles.pressed]}
    >
      <View style={chatThreadRowStyles.avatar}>
        <Icon size={20} color={Colors.primary} strokeWidth={2} />
      </View>
      <View style={chatThreadRowStyles.body}>
        <View style={chatThreadRowStyles.topRow}>
          <Text style={chatThreadRowStyles.title} numberOfLines={1}>{t.title}</Text>
          <Text style={chatThreadRowStyles.time}>{relativeTime(t.lastAt)}</Text>
        </View>
        <View style={chatThreadRowStyles.bottomRow}>
          <Text style={[chatThreadRowStyles.preview, hasUnread && chatThreadRowStyles.previewUnread]} numberOfLines={1}>{t.lastMessage}</Text>
          {t.muted ? <BellOff size={13} color={Colors.outline} strokeWidth={2} /> : null}
          {hasUnread ? (
            <View style={chatThreadRowStyles.badge}><Text style={chatThreadRowStyles.badgeText}>{t.unreadCount}</Text></View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const chatThreadRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  pressed: { opacity: 0.7 },
  avatar: { width: 48, height: 48, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  time: { ...Typography.caption, color: Colors.outline },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  preview: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  previewUnread: { color: Colors.onSurface, fontWeight: '600' as const },
  badge: { minWidth: 20, height: 20, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' as const },
});

interface CodeEntryViewProps {
  kind:        CodeKind;
  title:       string;
  heading:     string;
  helper:      string;
  placeholder: string;
}

export function CodeEntryView({ kind, title, heading, helper, placeholder }: CodeEntryViewProps) {
  const validate = useValidateCode(kind);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<CodeValidation | null>(null);

  const onCheck = () => {
    if (!code.trim()) return;
    validate.mutate(code, { onSuccess: setResult });
  };

  const onContinue = () => {
    if (result?.valid && result.organisationId) {
      router.push(`/association/organisation/${result.organisationId}`);
    }
  };

  return (
    <SafeAreaView style={codeEntryViewStyles.safe} edges={['top']}>
      <ScreenHeader title={title} />
      <View style={codeEntryViewStyles.body}>
        <View style={codeEntryViewStyles.iconBox}><KeyRound size={26} color={Colors.primary} strokeWidth={2} /></View>
        <Text style={codeEntryViewStyles.heading}>{heading}</Text>
        <Text style={codeEntryViewStyles.helper}>{helper}</Text>

        <TextInputField
          placeholder={placeholder}
          value={code}
          onChangeText={(t) => { setCode(t); if (result) setResult(null); }}
          autoCapitalize="characters"
          autoCorrect={false}
          style={codeEntryViewStyles.input}
        />

        {result ? (
          <View style={[codeEntryViewStyles.resultCard, shadow1, result.valid ? codeEntryViewStyles.resultOk : codeEntryViewStyles.resultBad]}>
            {result.valid ? <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
              : result.expired ? <Clock size={18} color={Colors.gold} strokeWidth={2} />
              : <XCircle size={18} color={Colors.error} strokeWidth={2} />}
            <Text style={codeEntryViewStyles.resultText}>{result.message}</Text>
          </View>
        ) : null}
      </View>

      <View style={codeEntryViewStyles.footer}>
        {result?.valid ? (
          <PrimaryButton label="Continue" onPress={onContinue} />
        ) : (
          <PrimaryButton label="Verify code" onPress={onCheck} loading={validate.isPending} disabled={!code.trim()} />
        )}
      </View>
    </SafeAreaView>
  );
}

const codeEntryViewStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xl, gap: Spacing.md, alignItems: 'center' },
  iconBox: { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  heading: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  helper: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  input: { letterSpacing: 2, textAlign: 'center', fontWeight: '700' },
  resultCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, alignSelf: 'stretch', borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.md },
  resultOk: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.teal },
  resultBad: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.outlineVariant },
  resultText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});

interface CommitteeFormModalProps {
  visible: boolean;
  /** Present for an edit, absent for a create. */
  initial?: { name: string; description?: string | null } | null;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (input: CommitteeInput) => void;
}

/**
 * Create / rename a committee. Shared by the list screen (create) and the
 * detail screen (edit) so the two cannot drift apart.
 *
 * Only rendered for owners — the server refuses everyone else on the
 * manageCommittees capability, which is the gate that actually matters.
 */
export function CommitteeFormModal({ visible, initial, busy, onCancel, onSubmit }: CommitteeFormModalProps) {
  const editing = Boolean(initial);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [error, setError] = React.useState('');

  // Re-seed each time it opens. Without this, opening the form for a second
  // committee would show the previous one's values.
  React.useEffect(() => {
    if (!visible) return;
    setName(initial?.name ?? '');
    setDescription(initial?.description ?? '');
    setError('');
  }, [visible, initial]);

  const submit = () => {
    const trimmed = name.trim();
    // into an inline message next to the field.
    if (!trimmed) {
      setError('Give the committee a name.');
      return;
    }
    const purpose = description.trim();
    onSubmit({ name: trimmed, description: purpose ? purpose : null });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={committeeFormModalStyles.backdrop}
      >
        <View style={committeeFormModalStyles.sheet}>
          <Text style={committeeFormModalStyles.title}>{editing ? 'Edit committee' : 'New committee'}</Text>
          <TextInputField
            label="Name"
            value={name}
            onChangeText={(t) => { setName(t); if (error) setError(''); }}
            placeholder="e.g. Welfare Committee"
            error={error}
            autoFocus
            returnKeyType="next"
          />
          <TextInputField
            label="Purpose (optional)"
            value={description}
            onChangeText={setDescription}
            placeholder="What this committee is responsible for"
            multiline
            numberOfLines={3}
          />
          <View style={committeeFormModalStyles.actions}>
            <Pressable
              onPress={onCancel}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => [committeeFormModalStyles.cancel, pressed && committeeFormModalStyles.pressed]}
            >
              <Text style={committeeFormModalStyles.cancelText}>Cancel</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                label={editing ? 'Save changes' : 'Create committee'}
                onPress={submit}
                loading={busy}
                disabled={busy}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const committeeFormModalStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: Spacing.containerMargin },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  title: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  cancel: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  cancelText: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  pressed: { opacity: 0.7 },
});

interface DuesInvoiceRowProps {
  invoice: DuesInvoice;
  onPress: () => void;
}

const SCOPE_LABEL: Record<DuesInvoice['scope'], string> = {
  NATIONAL: 'National', STATE: 'State chapter', LOCAL: 'Local chapter', COMMITTEE: 'Committee',
};

export function DuesInvoiceRow({ invoice: inv, onPress }: DuesInvoiceRowProps) {
  const payable = inv.status === 'DUE' || inv.status === 'OVERDUE';
  const cadence = CADENCE_LABEL[inv.cadence];

  return (
    <View style={[duesInvoiceRowStyles.card, shadow1]}>
      <View style={duesInvoiceRowStyles.topRow}>
        <View style={duesInvoiceRowStyles.titleWrap}>
          <Text style={duesInvoiceRowStyles.title} numberOfLines={1}>{inv.title}</Text>
          <Text style={duesInvoiceRowStyles.scope}>{SCOPE_LABEL[inv.scope]}</Text>
        </View>
        <InvoiceStatusBadge status={inv.status} size="sm" />
      </View>

      <View style={duesInvoiceRowStyles.amountRow}>
        <Text style={duesInvoiceRowStyles.amount}>
          {formatNaira(inv.amountKobo)}
          {inv.cadence !== 'ONE_OFF' && inv.cadence !== 'LIFETIME' ? (
            <Text style={duesInvoiceRowStyles.cadence}> {cadence}</Text>
          ) : null}
        </Text>
        {/*
          `dueDate` is nullable — an event-registration invoice has none — so
          both branches tolerate it rather than printing the epoch.
        */}
        <Text style={[duesInvoiceRowStyles.due, inv.status === 'OVERDUE' && duesInvoiceRowStyles.dueOverdue]}>
          {inv.status === 'PAID'
            ? (inv.dueDate ? `Paid · ${formatDate(inv.dueDate)}` : 'Paid')
            : dueLabel(inv.dueDate)}
        </Text>
      </View>

      {payable ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Pay ${inv.title}, ${formatNaira(inv.amountKobo)}`}
          style={({ pressed }) => [duesInvoiceRowStyles.payBtn, pressed && duesInvoiceRowStyles.pressed]}
        >
          <Text style={duesInvoiceRowStyles.payLabel}>Pay now</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const duesInvoiceRowStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.sm },
  titleWrap: { flex: 1, gap: 2 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  scope: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.sm },
  amount: { ...Typography.titleMd, color: Colors.onSurface },
  cadence: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  due: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  dueOverdue: { color: Colors.error, fontWeight: '600' as const },
  payBtn: {
    height: 44, borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  payLabel: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
});

interface MemberRowProps {
  member: MemberProfileSummary;
  onPress: () => void;
}

export function MemberRow({ member: m, onPress }: MemberRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${m.fullName}, ${m.categoryLabel}`}
      style={({ pressed }) => [memberRowStyles.row, pressed && memberRowStyles.pressed]}
    >
      <View style={memberRowStyles.avatar}>
        {m.photoUrl ? (
          <Image source={{ uri: m.photoUrl }} style={memberRowStyles.avatarImg} />
        ) : (
          <Text style={memberRowStyles.avatarText}>{initials(m.fullName)}</Text>
        )}
      </View>

      <View style={memberRowStyles.body}>
        <Text style={memberRowStyles.name} numberOfLines={1}>{m.fullName}</Text>
        <Text style={memberRowStyles.sub} numberOfLines={1}>
          {m.memberId}{m.profession ? ` · ${m.profession}` : ''}
        </Text>
        <View style={memberRowStyles.metaRow}>
          <MembershipStatusBadge status={m.status} size="sm" />
          <Text style={memberRowStyles.category} numberOfLines={1}>{m.categoryLabel}</Text>
        </View>
      </View>

      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const memberRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  pressed: { opacity: 0.7 },
  avatar: {
    width: 48, height: 48, borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerHigh,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' as const },
  body: { flex: 1, gap: 3 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  category: { ...Typography.caption, color: Colors.outline, flexShrink: 1 },
});

interface MembershipCardViewProps {
  card: MembershipCard;
  showQr?: boolean;
}

/**
 * Digital membership ID card — the showpiece "glass on gradient" surface
 * (DESIGN-Mobile.md → Elevation L2/L3). Reuses the shared QrCodeView primitive.
 */
export function MembershipCardView({ card, showQr = true }: MembershipCardViewProps) {
  const dimmed = card.status === 'SUSPENDED' || card.status === 'EXPIRED';
  const statusStyle = MEMBER_STATUS_STYLE[card.status];
  const payStyle = PAYMENT_STANDING_STYLE[card.paymentStanding];

  return (
    <LinearGradient
      colors={(dimmed ? Colors.gradientMuted : Colors.gradientPurple) as [string, string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[membershipCardViewStyles.card, shadow3]}
    >
      {/* Header: org + verification */}
      <View style={membershipCardViewStyles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={membershipCardViewStyles.org} numberOfLines={1}>
            {card.organisationAcronym ?? card.organisationName}
          </Text>
          <Text style={membershipCardViewStyles.orgSub} numberOfLines={1}>{card.organisationName}</Text>
        </View>
        {card.verified ? (
          <View style={membershipCardViewStyles.verifyPill}>
            <BadgeCheck size={13} color={Colors.tertiaryFixed} strokeWidth={2.4} />
            <Text style={membershipCardViewStyles.verifyText}>Verified</Text>
          </View>
        ) : null}
      </View>

      {/* Identity */}
      <View style={membershipCardViewStyles.idRow}>
        <View style={membershipCardViewStyles.photo}>
          {card.photoUrl ? (
            <Image source={{ uri: card.photoUrl }} style={membershipCardViewStyles.photoImg} />
          ) : (
            <Text style={membershipCardViewStyles.photoText}>{initials(card.fullName)}</Text>
          )}
        </View>
        <View style={membershipCardViewStyles.idBody}>
          <Text style={membershipCardViewStyles.name} numberOfLines={1}>{card.fullName}</Text>
          <Text style={membershipCardViewStyles.memberId}>{card.memberId}</Text>
          <Text style={membershipCardViewStyles.meta} numberOfLines={1}>
            {card.categoryLabel}{card.chapterName ? ` · ${card.chapterName}` : ''}
          </Text>
        </View>
      </View>

      {/* Status row */}
      <View style={membershipCardViewStyles.statusRow}>
        <View style={[membershipCardViewStyles.chip, { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
          <View style={[membershipCardViewStyles.chipDot, { backgroundColor: statusStyle.color }]} />
          <Text style={membershipCardViewStyles.chipText}>{statusStyle.label}</Text>
        </View>
        <View style={[membershipCardViewStyles.chip, { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
          <View style={[membershipCardViewStyles.chipDot, { backgroundColor: payStyle.color }]} />
          <Text style={membershipCardViewStyles.chipText}>{payStyle.label}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {/*
          Rendered only when the card actually carries an expiry.
          `validThrough` is nullable on the live DTO, and formatting a missing
          one is how this line came to read "Valid thru 1 Jan 1970" — a
          real-looking date that made a perfectly valid card look long expired.
        */}
        {card.validThrough ? (
          <Text style={membershipCardViewStyles.valid}>Valid thru {formatDate(card.validThrough)}</Text>
        ) : null}
      </View>

      {/* QR */}
      {showQr ? (
        <View style={membershipCardViewStyles.qrWrap}>
          <QrCodeView payload={card.qrPayload} size={148} />
          <Text style={membershipCardViewStyles.qrHint}>Show this code for verification</Text>
        </View>
      ) : null}

      {dimmed ? (
        <View style={membershipCardViewStyles.dimNotice}>
          <ShieldAlert size={14} color={Colors.errorContainer} strokeWidth={2} />
          <Text style={membershipCardViewStyles.dimText}>
            This card is {statusStyle.label.toLowerCase()} and cannot be used for verification.
          </Text>
        </View>
      ) : null}
    </LinearGradient>
  );
}

const membershipCardViewStyles = StyleSheet.create({
  card: { borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  org: { ...Typography.titleLg, color: Colors.white, fontWeight: '800' as const },
  orgSub: { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)' },
  verifyPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(72,184,172,0.22)',
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  verifyText: { ...Typography.caption, color: Colors.tertiaryFixed, fontWeight: '700' as const },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  photo: {
    width: 64, height: 64, borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  photoImg: { width: '100%', height: '100%' },
  photoText: { ...Typography.headlineMd, color: Colors.white },
  idBody: { flex: 1, gap: 2 },
  name: { ...Typography.titleMd, color: Colors.white },
  memberId: { ...Typography.labelMd, color: Colors.inversePrimary, letterSpacing: 0.5 },
  meta: { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  chipDot: { width: 6, height: 6, borderRadius: Radius.full },
  chipText: { ...Typography.caption, color: Colors.white, fontWeight: '600' as const },
  valid: { ...Typography.caption, color: 'rgba(255,255,255,0.7)' },
  qrWrap: { alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  qrHint: { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)' },
  dimNotice: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: 'rgba(186,26,26,0.25)',
    borderRadius: Radius.md, padding: Spacing.sm,
  },
  dimText: { ...Typography.labelSm, color: Colors.errorContainer, flex: 1 },
});

interface BaseProps {
  size?: 'sm' | 'md';
}

// Pill-shaped status chips: high-contrast text on a 10% tint (per DESIGN-Mobile.md).
function Pill({ label, fg, bg, size = 'md' }: { label: string; fg: string; bg: string } & BaseProps) {
  return (
    <View style={[membershipStatusBadgeStyles.pill, size === 'sm' && membershipStatusBadgeStyles.pillSm, { backgroundColor: bg }]}>
      <View style={[membershipStatusBadgeStyles.dot, { backgroundColor: fg }]} />
      <Text style={[membershipStatusBadgeStyles.label, size === 'sm' && membershipStatusBadgeStyles.labelSm, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function MembershipStatusBadge({ status, size }: { status: MemberStatus } & BaseProps) {
  const s = MEMBER_STATUS_STYLE[status];
  return <Pill label={s.label} fg={s.color} bg={s.bg} size={size} />;
}

export function PaymentStandingBadge({ standing, size }: { standing: PaymentStanding } & BaseProps) {
  const s = PAYMENT_STANDING_STYLE[standing];
  return <Pill label={s.label} fg={s.color} bg={s.bg} size={size} />;
}

export function InvoiceStatusBadge({ status, size }: { status: InvoiceStatus } & BaseProps) {
  const s = INVOICE_STATUS_STYLE[status];
  return <Pill label={s.label} fg={s.color} bg={s.bg} size={size} />;
}

const membershipStatusBadgeStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  pillSm: { paddingVertical: 3, paddingHorizontal: 7 },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  label: { ...Typography.labelSm, fontWeight: '600' as const },
  labelSm: { ...Typography.caption, fontWeight: '600' as const },
});

interface MessageBubbleProps {
  message: ChatMessage;
  showAuthor: boolean;          // show author name (group chats, first in a run)
  onReact?: (emoji: string) => void;
}

const QUICK = ['👍', '❤️'];

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
}

export function MessageBubble({ message: m, showAuthor, onReact }: MessageBubbleProps) {
  // The live DTO omits `reactions` entirely when a message has none.
  const reactions = m.reactions ?? [];

  if (m.system) {
    return (
      <View style={messageBubbleStyles.systemWrap}>
        <Text style={messageBubbleStyles.systemText}>{m.body}</Text>
      </View>
    );
  }

  return (
    <View style={[messageBubbleStyles.wrap, m.mine ? messageBubbleStyles.wrapMine : messageBubbleStyles.wrapOther]}>
      {m.pinned ? (
        <View style={messageBubbleStyles.pinRow}>
          <Pin size={11} color={Colors.gold} strokeWidth={2.2} />
          <Text style={messageBubbleStyles.pinText}>Pinned</Text>
        </View>
      ) : null}
      <View style={[messageBubbleStyles.bubble, m.mine ? messageBubbleStyles.bubbleMine : messageBubbleStyles.bubbleOther]}>
        {showAuthor && !m.mine ? (
          <Text style={messageBubbleStyles.author}>
            {m.authorName}{m.authorRole ? ` · ${m.authorRole}` : ''}
          </Text>
        ) : null}
        {m.imageUrl ? <Image source={{ uri: m.imageUrl }} style={messageBubbleStyles.image} /> : null}
        {m.body ? <Text style={[messageBubbleStyles.body, m.mine && messageBubbleStyles.bodyMine]}>{m.body}</Text> : null}
        <Text style={[messageBubbleStyles.time, m.mine && messageBubbleStyles.timeMine]}>{timeLabel(m.createdAt)}</Text>
      </View>

      {/* Reactions + quick-react */}
      <View style={[messageBubbleStyles.reactRow, m.mine ? messageBubbleStyles.reactRowMine : messageBubbleStyles.reactRowOther]}>
        {reactions.map((r) => (
          <Pressable
            key={r.emoji}
            onPress={() => onReact?.(r.emoji)}
            style={[messageBubbleStyles.reactChip, r.mine && messageBubbleStyles.reactChipMine]}
            accessibilityRole="button"
            accessibilityLabel={`${r.emoji} ${r.count}`}
          >
            <Text style={messageBubbleStyles.reactEmoji}>{r.emoji}</Text>
            <Text style={[messageBubbleStyles.reactCount, r.mine && messageBubbleStyles.reactCountMine]}>{r.count}</Text>
          </Pressable>
        ))}
        {onReact ? (
          QUICK.filter((e) => !reactions.some((r) => r.emoji === e)).map((e) => (
            <Pressable key={e} onPress={() => onReact(e)} style={messageBubbleStyles.quickReact} hitSlop={4} accessibilityRole="button" accessibilityLabel={`React ${e}`}>
              <Text style={messageBubbleStyles.quickEmoji}>{e}</Text>
            </Pressable>
          ))
        ) : null}
      </View>
    </View>
  );
}

const messageBubbleStyles = StyleSheet.create({
  wrap: { maxWidth: '82%', marginVertical: 3 },
  wrapMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  wrapOther: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 2, marginHorizontal: 4 },
  pinText: { ...Typography.caption, color: Colors.onWarning, fontWeight: '700' as const },
  bubble: { borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 2 },
  bubbleMine: { backgroundColor: Colors.primary, borderTopRightRadius: Radius.sm },
  bubbleOther: { backgroundColor: Colors.surfaceContainerHigh, borderTopLeftRadius: Radius.sm },
  author: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const },
  image: { width: 200, height: 150, borderRadius: Radius.md, marginVertical: 2, backgroundColor: Colors.surfaceContainerHigh },
  body: { ...Typography.bodyMd, color: Colors.onSurface },
  bodyMine: { color: Colors.onPrimary },
  time: { ...Typography.caption, color: Colors.outline, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(255,255,255,0.7)' },
  reactRow: { flexDirection: 'row', gap: 4, marginTop: 3 },
  reactRowMine: { justifyContent: 'flex-end' },
  reactRowOther: { justifyContent: 'flex-start' },
  reactChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  reactChipMine: { backgroundColor: Colors.iconBgPurple },
  reactEmoji: { fontSize: 12 },
  reactCount: { ...Typography.caption, color: Colors.onSurfaceVariant },
  reactCountMine: { color: Colors.primary, fontWeight: '700' as const },
  quickReact: { opacity: 0.45, paddingHorizontal: 2 },
  quickEmoji: { fontSize: 13 },
  systemWrap: { alignSelf: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 5, marginVertical: Spacing.sm },
  systemText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});

interface OrganisationCardProps {
  organisation: OrganisationSummary;
  onPress: () => void;
  variant?: 'full' | 'compact';
}

export function OrganisationCard({ organisation: o, onPress, variant = 'full' }: OrganisationCardProps) {
  const compact = variant === 'compact';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${o.name}, ${formatCount(o.memberCount, 'members')}`}
      style={({ pressed }) => [organisationCardStyles.card, compact && organisationCardStyles.cardCompact, shadow1, pressed && organisationCardStyles.pressed]}
    >
      <View style={organisationCardStyles.logoRow}>
        <View style={organisationCardStyles.logo}>
          {o.logoUrl ? (
            <Image source={{ uri: o.logoUrl }} style={organisationCardStyles.logoImg} />
          ) : (
            <Text style={organisationCardStyles.logoText}>{o.acronym ?? initials(o.name)}</Text>
          )}
        </View>
        <View style={organisationCardStyles.titleWrap}>
          <View style={organisationCardStyles.nameRow}>
            <Text style={organisationCardStyles.name} numberOfLines={1}>{o.name}</Text>
            {o.verified && <BadgeCheck size={15} color={Colors.secondary} strokeWidth={2.2} />}
          </View>
          <Text style={organisationCardStyles.category} numberOfLines={1}>{o.category}</Text>
        </View>
      </View>

      {!compact && o.tagline ? (
        <Text style={organisationCardStyles.tagline} numberOfLines={2}>{o.tagline}</Text>
      ) : null}

      <View style={organisationCardStyles.metaRow}>
        <View style={organisationCardStyles.metaItem}>
          <Users size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={organisationCardStyles.metaText}>{formatCount(o.memberCount, 'members')}</Text>
        </View>
        <View style={organisationCardStyles.metaItem}>
          <GitBranch size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={organisationCardStyles.metaText}>{formatCount(o.chapterCount, 'chapters')}</Text>
        </View>
      </View>

      <View style={organisationCardStyles.typePill}>
        <ShieldCheck size={12} color={Colors.primary} strokeWidth={2} />
        <Text style={organisationCardStyles.typeText} numberOfLines={1}>{GROUP_TYPE_LABEL[o.groupType]}</Text>
      </View>
    </Pressable>
  );
}

const organisationCardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardCompact: { width: 260 },
  pressed: { opacity: 0.9 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  logo: {
    width: 48, height: 48, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  logoImg: { width: '100%', height: '100%' },
  logoText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '800' as const },
  titleWrap: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  category: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  tagline: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', gap: Spacing.md },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  typePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: Colors.iconBgPurple,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  typeText: { ...Typography.caption, color: Colors.primary, fontWeight: '600' as const },
});

/**
 * The association module's navigation.
 *
 * Lives here rather than inside a screen because TWO screens need it and they
 * must not drift: the member hub (/association/home) and the discovery landing
 * (/association). Discovery previously offered no way into the module at all
 * beyond a single unlabelled ID-card icon in the header — every section below
 * was reachable only by already knowing the URL.
 */
export const ASSOCIATION_QUICK_ACTIONS = [
  { id: 'card', label: 'My card', icon: IdCard, to: '/association/card' },
  { id: 'dues', label: 'Dues', icon: CreditCard, to: '/association/dues' },
  { id: 'chat', label: 'Chat', icon: MessageCircle, to: '/association/chat' },
  { id: 'meetings', label: 'Meetings', icon: CalendarDays, to: '/association/meetings' },
  { id: 'events', label: 'Events', icon: Ticket, to: '/association/events' },
  { id: 'tasks', label: 'Tasks', icon: ListTodo, to: '/association/tasks' },
  { id: 'committees', label: 'Committees', icon: Building2, to: '/association/committees' },
  { id: 'documents', label: 'Documents', icon: FileText, to: '/association/documents' },
  { id: 'ai-notes', label: 'AI notes', icon: Sparkles, to: '/association/ai-notes' },
  { id: 'voting', label: 'Voting', icon: Vote, to: '/association/governance' },
  { id: 'directory', label: 'Directory', icon: Users, to: '/association/directory' },
] as const;

export type AssociationQuickAction = (typeof ASSOCIATION_QUICK_ACTIONS)[number];

interface QuickNavProps {
  /** Render a subset, in this order. Omit for the full menu. */
  only?: readonly AssociationQuickAction['id'][];
}

export function QuickNav({ only }: QuickNavProps) {
  const items = only
    ? only
        .map((id) => ASSOCIATION_QUICK_ACTIONS.find((a) => a.id === id))
        .filter((a): a is AssociationQuickAction => Boolean(a))
    : ASSOCIATION_QUICK_ACTIONS;

  return (
    <View style={quickNavStyles.row}>
      {items.map((a) => {
        const Icon = a.icon;
        return (
          <Pressable
            key={a.id}
            style={quickNavStyles.action}
            onPress={() => router.push(a.to as never)}
            accessibilityRole="button"
            accessibilityLabel={a.label}
          >
            <View style={quickNavStyles.actionIcon}>
              <Icon size={20} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={quickNavStyles.actionLabel}>{a.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const quickNavStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  action: {
    flexBasis: '31%', flexGrow: 1, alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, paddingVertical: Spacing.md,
  },
  actionIcon: {
    width: 40, height: 40, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { ...Typography.labelSm, color: Colors.onSurface },
});

interface WizardProgressProps {
  /** Zero-based index of the current step. */
  step: number;
}

/** Slim step indicator for the org-creation wizard (dots + current label). */
export function WizardProgress({ step }: WizardProgressProps) {
  return (
    <View style={wizardProgressStyles.wrap}>
      <View style={wizardProgressStyles.dots}>
        {WIZARD_STEPS.map((_, i) => (
          <View key={i} style={[wizardProgressStyles.dot, i <= step ? wizardProgressStyles.dotOn : wizardProgressStyles.dotOff, i === step && wizardProgressStyles.dotCurrent]} />
        ))}
      </View>
      <Text style={wizardProgressStyles.label}>Step {step + 1} of {WIZARD_STEPS.length} · {WIZARD_STEPS[step]}</Text>
    </View>
  );
}

const wizardProgressStyles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm, gap: 6 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { height: 4, borderRadius: Radius.full, flex: 1 },
  dotOff: { backgroundColor: Colors.surfaceContainerHigh },
  dotOn: { backgroundColor: Colors.primary },
  dotCurrent: { backgroundColor: Colors.primary },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
