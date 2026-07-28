import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { PawPrint, AlertTriangle, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import StatusBadge from './StatusBadge';
import type { StatusTone } from './StatusBadge';
import { PET_OWNER_REQUEST_STATUS_LABELS, VET_CONSULT_TYPE_LABELS, PET_SPECIES_LABELS } from '@/features/doctor/constants';
import type { PetOwnerRequest, PetOwnerRequestStatus } from '@/types/doctor.batch5';

interface Props {
  request: PetOwnerRequest;
  onPress: () => void;
}

// New component: a pet-owner consult-request row (pet + owner + reason + urgency
// + request status). No existing row renders a pending owner request shape, so a
// dedicated row keeps the request inbox readable.
const STATUS_TONE: Record<PetOwnerRequestStatus, StatusTone> = {
  pending: 'warning', accepted: 'success', declined: 'danger', expired: 'neutral',
};

export default function PetRequestRow({ request, onPress }: Props) {
  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open ${request.petName} request`}>
      <View style={[styles.icon, { backgroundColor: request.owner.avatarColor }]}>
        <PawPrint size={18} color={Colors.white} strokeWidth={2.2} />
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.name} numberOfLines={1}>{request.petName}</Text>
          {request.isUrgent && (
            <View style={styles.urgent}>
              <AlertTriangle size={10} color={Colors.error} strokeWidth={2.4} />
              <Text style={styles.urgentText}>Urgent</Text>
            </View>
          )}
        </View>
        <Text style={styles.meta} numberOfLines={1}>{PET_SPECIES_LABELS[request.petSpecies]} - {request.breed} - {request.owner.name}</Text>
        <Text style={styles.reason} numberOfLines={1}>{request.reason} - {VET_CONSULT_TYPE_LABELS[request.preferredType]}</Text>
      </View>
      <View style={styles.right}>
        <StatusBadge label={PET_OWNER_REQUEST_STATUS_LABELS[request.status]} tone={STATUS_TONE[request.status]} />
        <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  icon:       { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  body:       { flex: 1, gap: 2 },
  top:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  name:       { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  urgent:     { flexDirection: 'row', alignItems: 'center', gap: 3, height: 20, paddingHorizontal: 6, borderRadius: Radius.full, backgroundColor: Colors.errorContainer },
  urgentText: { ...Typography.caption, color: Colors.error, fontWeight: '700' },
  meta:       { ...Typography.caption, color: Colors.onSurfaceVariant },
  reason:     { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  right:      { alignItems: 'flex-end', gap: 4 },
});
