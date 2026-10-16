import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import SegmentedControl from '@/components/SegmentedControl';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { getDevUrl } from '@/lib/devUrl';
import { validateLocalHost } from '@/lib/serverProfile';
import {
  applyServerProfile,
  getRemoteApiBase,
  getServerSwitchState,
  isServerSwitchAvailable,
  previewLocalProfile,
  testConnection,
} from '@/lib/serverProfileStore';

type Choice = 'remote' | 'local';

/**
 * Dev/staging-only Remote / Local server picker. Renders nothing in production
 * builds. A change is applied by reloading the app (see serverProfileStore).
 */
export default function ServerSwitch() {
  if (!isServerSwitchAvailable()) return null;
  return <ServerSwitchInner />;
}

function ServerSwitchInner() {
  const state = getServerSwitchState();
  const [choice, setChoice] = useState<Choice>(state.active);
  const [host, setHost] = useState(state.activeHost ?? state.defaultHost);
  const [busy, setBusy] = useState<'test' | 'apply' | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const hostCheck = validateLocalHost(host);
  const hostError = choice === 'local' && !hostCheck.ok ? hostCheck.reason : undefined;
  const localBlocked = state.localUnavailableReason;
  const title = state.active === 'local' ? `Server: Local (${state.activeHost})` : 'Server: Remote';

  // Probe what the app will really call: consumers wrap their base in getDevUrl.
  const targetUrl = (): string | null => {
    if (choice === 'remote') {
      const remote = getRemoteApiBase();
      return remote ? getDevUrl(remote) : null;
    }
    const p = previewLocalProfile(host);
    return p.available ? getDevUrl(p.apiBase) : null;
  };

  const onTest = async () => {
    const url = targetUrl();
    if (!url) {
      setMessage({ text: 'Nothing to test: fix the host first.', tone: 'error' });
      return;
    }
    setBusy('test');
    setMessage(null);
    const r = await testConnection(url);
    setBusy(null);
    setMessage({
      text: r.reachable ? `Reachable: ${r.url} (${r.detail})` : `Unreachable: ${r.url} (${r.detail})`,
      tone: r.reachable ? 'ok' : 'error',
    });
  };

  const onApply = async () => {
    const unchanged =
      choice === state.active && (choice === 'remote' || host === state.activeHost);
    if (unchanged) {
      setMessage({ text: 'Already using this server.', tone: 'ok' });
      return;
    }
    setBusy('apply');
    setMessage(null);
    const r = await applyServerProfile(choice === 'remote' ? { mode: 'remote' } : { mode: 'local', host });
    setBusy(null);
    // On success the app reloads, so only a failure needs to be shown.
    if (!r.ok) setMessage({ text: r.error, tone: 'error' });
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      <View style={styles.segmentWrap}>
      <SegmentedControl<Choice>
        options={[
          { value: 'remote', label: 'Remote' },
          { value: 'local', label: 'Local' },
        ]}
        value={choice}
        onChange={(v) => {
          if (v === 'local' && localBlocked) {
            setMessage({ text: localBlocked, tone: 'error' });
            return;
          }
          setMessage(null);
          setChoice(v);
        }}
      />
      </View>
      {localBlocked ? <Text style={styles.note}>{localBlocked}</Text> : null}
      {choice === 'local' ? (
        <TextInputField
          label="Local host"
          placeholder="192.168.1.5"
          autoCapitalize="none"
          autoCorrect={false}
          value={host}
          onChangeText={setHost}
          error={hostError}
        />
      ) : null}
      {message ? (
        <Text style={[styles.note, message.tone === 'error' && styles.error]}>{message.text}</Text>
      ) : null}
      <View style={styles.row}>
        <PrimaryButton
          label="Test connection"
          variant="secondary"
          fullWidth={false}
          style={styles.flex}
          onPress={onTest}
          loading={busy === 'test'}
          disabled={busy !== null || !!hostError}
        />
        <PrimaryButton
          label="Apply"
          fullWidth={false}
          style={styles.flex}
          onPress={onApply}
          loading={busy === 'apply'}
          disabled={busy !== null || !!hostError}
        />
      </View>
      <Text style={styles.note}>Applying signs you out and restarts the app.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box:   { gap: Spacing.sm, padding: Spacing.md, marginTop: Spacing.lg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  segmentWrap: { marginHorizontal: -Spacing.containerMargin }, // SegmentedControl adds its own inset
  title: { ...Typography.labelMd, color: Colors.onSurface },
  note:  { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  error: { color: Colors.error },
  row:   { flexDirection: 'row', gap: Spacing.sm },
  flex:  { flex: 1 },
});
