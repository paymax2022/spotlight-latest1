import React from 'react';
import { View, Text, Modal, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import type { CommitteeInput } from '@/features/association/api/authoring.api';

interface Props {
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
export default function CommitteeFormModal({ visible, initial, busy, onCancel, onSubmit }: Props) {
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
    // Name is `binding:"required"` server-side; catching it here turns a 400
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
        style={styles.backdrop}
      >
        <View style={styles.sheet}>
          <Text style={styles.title}>{editing ? 'Edit committee' : 'New committee'}</Text>
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
          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
            >
              <Text style={styles.cancelText}>Cancel</Text>
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: Spacing.containerMargin },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  title: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  cancel: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  cancelText: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  pressed: { opacity: 0.7 },
});
