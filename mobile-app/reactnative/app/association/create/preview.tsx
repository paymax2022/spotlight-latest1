import React, { useState } from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CheckSquare, Square, Pencil } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import WizardProgress from '@/features/association/components/WizardProgress';
import { useOrgDraft } from '@/features/association/store/orgDraftStore';
import { useCreateOrganisation } from '@/features/association/hooks/useCreateOrganisation';
import { initials, formatNaira } from '@/features/association/utils/associationFormatters';
import { CADENCE_LABEL } from '@/features/association/constants/association.constants';
import { GROUP_TYPE_OPTIONS, APPROVAL_RULE_OPTIONS } from '@/features/association/constants/orgWizard.constants';

export default function WizardPreview() {
  const { draft, patch, reset } = useOrgDraft();
  const create = useCreateOrganisation();
  const [touched, setTouched] = useState(false);

  const groupTypeLabel = GROUP_TYPE_OPTIONS.find((o) => o.value === draft.groupType)?.label ?? '—';
  const approvalLabel = APPROVAL_RULE_OPTIONS.find((o) => o.value === draft.approvalRule)?.label ?? '—';

  const onPublish = () => {
    setTouched(true);
    if (!draft.acceptedTerms) return;
    create.mutate(draft, {
      onSuccess: (res) => { reset(); router.replace(`/association/create/success?name=${encodeURIComponent(res.name)}&id=${res.organisationId}`); },
      onError: () => Alert.alert('Could not publish', 'Please try again.'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review & publish" />
      <WizardProgress step={5} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Identity */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.identity}>
            <View style={styles.logo}>
              {draft.logoUri ? <Image source={{ uri: draft.logoUri }} style={styles.logoImg} /> : <Text style={styles.logoText}>{draft.acronym || initials(draft.name || 'NA')}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{draft.name || 'Untitled organisation'}</Text>
              <Text style={styles.category}>{draft.category || '—'}</Text>
            </View>
            <Pressable onPress={() => router.push('/association/create/basics')} hitSlop={8} accessibilityLabel="Edit basics">
              <Pencil size={16} color={Colors.secondary} strokeWidth={2} />
            </Pressable>
          </View>
          {draft.description ? <Text style={styles.description}>{draft.description}</Text> : null}
        </View>

        <SummaryRow label="Founded" value={draft.foundedYear || '—'} onEdit={() => router.push('/association/create/basics')} />
        <SummaryRow label="Location" value={draft.location || 'Not set'} onEdit={() => router.push('/association/create/basics')} />
        <SummaryRow label="Website" value={draft.website || 'Not set'} onEdit={() => router.push('/association/create/basics')} />
        <SummaryRow label="Group type" value={groupTypeLabel} onEdit={() => router.push('/association/create/branding')} />
        <SummaryRow label="Approval rule" value={approvalLabel} onEdit={() => router.push('/association/create/structure')} />
        <SummaryRow
          label="Structure"
          value={draft.structureType === 'STATEWIDE' ? `State chapters · ${draft.stateLeaders.length} state${draft.stateLeaders.length === 1 ? '' : 's'}` : 'Single structure'}
          onEdit={() => router.push('/association/create/structure')}
        />
        <SummaryRow label="Registration fee" value={draft.registrationFeeKobo ? formatNaira(draft.registrationFeeKobo) : 'Free'} onEdit={() => router.push('/association/create/access')} />

        {/* State leaders (only when statewide) */}
        {draft.structureType === 'STATEWIDE' ? (
          <Section title={`State leaders (${draft.stateLeaders.length})`} onEdit={() => router.push('/association/create/structure')}>
            {draft.stateLeaders.length === 0 ? <Text style={styles.empty}>No states selected</Text> :
              draft.stateLeaders.map((l) => (
                <Text key={l.id} style={styles.listItem}>
                  • {l.state}{l.leaderName ? ` — ${l.leaderName}` : ''}{l.canApproveMembers ? ' (can approve)' : ''}
                </Text>
              ))}
          </Section>
        ) : null}

        {/* Committees */}

        {/* Committees */}
        {draft.committees.length > 0 ? (
          <Section title={`Committees (${draft.committees.length})`} onEdit={() => router.push('/association/create/structure')}>
            {draft.committees.map((c) => <Text key={c.id} style={styles.listItem}>• {c.name}</Text>)}
          </Section>
        ) : null}

        {/* Categories */}
        <Section title={`Membership categories (${draft.categories.length})`} onEdit={() => router.push('/association/create/membership')}>
          {draft.categories.length === 0 ? <Text style={styles.empty}>None added</Text> :
            draft.categories.map((c) => (
              <View key={c.id} style={styles.catRow}>
                <Text style={styles.listItem}>• {c.label}</Text>
                <Text style={styles.catDues}>{c.duesKobo === 0 ? 'Free' : `${formatNaira(c.duesKobo)} ${CADENCE_LABEL[c.cadence]}`}</Text>
              </View>
            ))}
        </Section>

        {/* Terms */}
        <Pressable onPress={() => patch({ acceptedTerms: !draft.acceptedTerms })} style={styles.consentRow} accessibilityRole="checkbox" accessibilityState={{ checked: draft.acceptedTerms }}>
          {draft.acceptedTerms ? <CheckSquare size={22} color={Colors.primary} strokeWidth={2} /> : <Square size={22} color={Colors.outline} strokeWidth={2} />}
          <Text style={styles.consentText}>I confirm the details are accurate and accept the platform terms for organisations.</Text>
        </Pressable>
        {touched && !draft.acceptedTerms ? <Text style={styles.error}>You must accept the terms to publish.</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Publish organisation" onPress={onPublish} loading={create.isPending} disabled={touched && !draft.acceptedTerms} />
      </View>
    </SafeAreaView>
  );
}

function SummaryRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <View style={[styles.sumRow, shadow1]}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={styles.sumValue} numberOfLines={1}>{value}</Text>
      <Pressable onPress={onEdit} hitSlop={8} accessibilityLabel={`Edit ${label}`}><Pencil size={15} color={Colors.secondary} strokeWidth={2} /></Pressable>
    </View>
  );
}

function Section({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <View style={[styles.section, shadow1]}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Pressable onPress={onEdit} hitSlop={8} accessibilityLabel={`Edit ${title}`}><Pencil size={15} color={Colors.secondary} strokeWidth={2} /></Pressable>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.sm, paddingTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  logo: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoImg: { width: '100%', height: '100%' },
  logoText: { ...Typography.labelLg, color: Colors.primary, fontWeight: '800' as const },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  category: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  description: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  sumRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  sumLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, width: 120 },
  sumValue: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  section: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...Typography.labelLg, color: Colors.onSurface },
  sectionBody: { gap: 2 },
  listItem: { ...Typography.bodyMd, color: Colors.onSurface },
  catRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  catDues: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  consentText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  error: { ...Typography.labelSm, color: Colors.error },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
