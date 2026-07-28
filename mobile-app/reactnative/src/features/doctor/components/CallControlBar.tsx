import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Mic, MicOff, Video as VideoIcon, VideoOff, SwitchCamera, Volume2, VolumeX, Minimize2, Maximize2, PhoneOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { CallControls } from '@/types/doctor.batch2';

interface Props {
  controls:       CallControls;
  isVideo:        boolean;
  disabled?:      boolean;        // controls disabled while not live
  onToggleMute:   () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
  onToggleSpeaker: () => void;
  onToggleMinimize: () => void;
  onEnd:          () => void;
}

// New component: the in-call control bar driving the full CallControls shape
// (mute, camera, switch camera, speaker, minimize/fullscreen, end). The base
// call.tsx inlined a small ControlBtn set; this consolidates the richer Batch 2
// control surface in one reusable bar. Sits on the call gradient, so the
// translucent control backgrounds use rgba overlays (accepted exception).
export default function CallControlBar({
  controls, isVideo, disabled = false,
  onToggleMute, onToggleCamera, onSwitchCamera, onToggleSpeaker, onToggleMinimize, onEnd,
}: Props) {
  return (
    <View style={styles.bar}>
      <Ctrl active={!controls.muted} disabled={disabled} onPress={onToggleMute} On={Mic} Off={MicOff} label="Toggle microphone" />
      {isVideo && (
        <>
          <Ctrl active={controls.cameraOn} disabled={disabled} onPress={onToggleCamera} On={VideoIcon} Off={VideoOff} label="Toggle camera" />
          <Ctrl active={controls.frontCamera} disabled={disabled} onPress={onSwitchCamera} On={SwitchCamera} Off={SwitchCamera} label="Switch camera" />
        </>
      )}
      <Ctrl active={controls.speakerOn} disabled={disabled} onPress={onToggleSpeaker} On={Volume2} Off={VolumeX} label="Toggle speaker" />
      <Ctrl active onPress={onToggleMinimize} disabled={disabled} On={controls.minimized ? Maximize2 : Minimize2} Off={Minimize2} label={controls.minimized ? 'Expand call' : 'Minimize call'} />
      <Pressable
        style={styles.endBtn}
        onPress={onEnd}
        accessibilityRole="button"
        accessibilityLabel="End call"
      >
        <PhoneOff size={24} color={Colors.white} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

function Ctrl({ active, disabled, onPress, On, Off, label }: { active: boolean; disabled?: boolean; onPress: () => void; On: typeof Mic; Off: typeof Mic; label: string }) {
  const Icon = active ? On : Off;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.ctrl, !active && styles.ctrlOff, disabled && styles.ctrlDisabled]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon size={22} color={active ? Colors.white : Colors.onSurface} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar:           { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.md, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  ctrl:          { width: 56, height: 56, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ctrlOff:       { backgroundColor: Colors.white },
  ctrlDisabled:  { opacity: 0.4 },
  endBtn:        { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
});
