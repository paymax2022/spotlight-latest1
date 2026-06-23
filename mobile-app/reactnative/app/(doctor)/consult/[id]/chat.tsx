import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView, Modal, TextInput, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  NotebookPen, MessageSquare, ShieldCheck, Phone, Video as VideoIcon, FileText,
  Mic, Image as ImageIcon, ClipboardList, FlaskConical, FileBarChart, ScrollText, X, Check, CheckCheck,
  Clock, AlertTriangle, MapPin,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { TeleHeader } from '@/features/telemedicine/components';
import { MessageBubble, ChatComposer, StateView, StatusBadge, VoiceNoteBubble, AttachmentBubble } from '@/features/doctor/components';
import {
  useAppointment, useChatThreads, useSendChatMessage,
  useRichMessages, useThreadState, useChatTranscript,
  useSendVoiceNote, useSendAttachment, useShareInChat, useEscalateToCall, useReportMessage, useEndChat, useAnnotateImage,
} from '@/features/doctor/hooks';
import { MESSAGE_KIND_LABELS, DELIVERY_STATUS_LABELS, CHAT_PRESENCE_LABELS, REPORT_REASONS, SECURE_CHAT_NOTICE } from '@/features/doctor/constants';
import type { ChatMessageRich, ChatDeliveryStatus, SharedEntityKind } from '@/types/doctor.batch2';

type SheetKind = 'voice' | 'image' | 'document' | 'share' | 'report' | 'transcript' | 'attachment' | null;

export default function ConsultChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appointmentId = String(id);

  const { data: appointment } = useAppointment(appointmentId);
  const { data: threads = [] } = useChatThreads();
  const thread = useMemo(() => threads.find((t) => t.appointmentId === appointmentId), [threads, appointmentId]);
  const threadId = thread?.id ?? '';

  const { data: messages = [], isLoading, isError, refetch } = useRichMessages(threadId);
  const { data: threadState } = useThreadState(threadId);
  const transcriptQuery = useChatTranscript(threadId);

  const sendMessage    = useSendChatMessage();
  const sendVoice      = useSendVoiceNote();
  const sendAttachment = useSendAttachment();
  const shareInChat    = useShareInChat();
  const escalate       = useEscalateToCall();
  const reportMessage  = useReportMessage();
  const endChat        = useEndChat();
  const annotateImage  = useAnnotateImage();

  const [sheet, setSheet]             = useState<SheetKind>(null);
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [shareKind, setShareKind]     = useState<SharedEntityKind>('prescription');
  const [attachTarget, setAttachTarget] = useState<ChatMessageRich | null>(null);
  const [annotationNote, setAnnotationNote] = useState('');

  const patientName = appointment?.patient.name ?? thread?.patient.name ?? 'Patient';
  const ended = threadState?.lifecycle === 'ended';
  const patientPresence = threadState?.patientPresence.status;
  const doctorPresence  = threadState?.doctorPresence.status;

  const presenceLabel = patientPresence ? CHAT_PRESENCE_LABELS[patientPresence] : undefined;

  const handleSend = (body: string) => {
    if (!threadId || ended) return;
    sendMessage.mutate({ threadId, body });
  };

  const closeSheet = () => setSheet(null);

  const doSendVoice = async () => {
    try {
      await sendVoice.mutateAsync({ threadId, uri: 'file://demo/voice-note.m4a', durationSecs: 12 });
      closeSheet();
    } catch { Alert.alert('Failed', 'Could not send the voice note.'); }
  };

  const doSendAttachment = async (kind: 'image' | 'document') => {
    try {
      await sendAttachment.mutateAsync({
        threadId, kind,
        uri: kind === 'image' ? 'https://placehold.co/600x400/png' : 'file://demo/report.pdf',
        fileName: kind === 'image' ? 'photo.jpg' : 'lab-report.pdf',
        mimeType: kind === 'image' ? 'image/jpeg' : 'application/pdf',
      });
      closeSheet();
    } catch { Alert.alert('Failed', 'Could not upload the attachment.'); }
  };

  const doShare = async () => {
    try {
      await shareInChat.mutateAsync({ threadId, kind: shareKind, entityId: `${shareKind}-demo` });
      closeSheet();
    } catch { Alert.alert('Failed', 'Could not share into the chat.'); }
  };

  const doEscalate = async (mode: 'audio' | 'video') => {
    try {
      await escalate.mutateAsync({ threadId, mode });
      router.push(`/(doctor)/consult/${appointmentId}/call?mode=${mode}`);
    } catch { Alert.alert('Failed', 'Could not start the call.'); }
  };

  const doReport = async () => {
    if (!reportTarget || !reportReason) { Alert.alert('Select a reason', 'Choose why you are reporting this message.'); return; }
    try {
      await reportMessage.mutateAsync({ messageId: reportTarget, reason: reportReason });
      Alert.alert('Reported', 'This message has been flagged for moderation.');
      setReportTarget(null); setReportReason('');
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };

  const doEndChat = () => {
    Alert.alert('End chat', 'End this chat consultation? The patient can no longer send messages.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End chat', style: 'destructive', onPress: async () => {
        try { await endChat.mutateAsync({ threadId }); } catch { Alert.alert('Failed', 'Please try again.'); }
      } },
    ]);
  };

  const doAnnotate = async () => {
    if (!attachTarget) return;
    try {
      await annotateImage.mutateAsync({
        messageId: attachTarget.base.id,
        annotations: [...(attachTarget.annotations ?? []), { id: `ann-${Date.now()}`, x: 0.5, y: 0.5, note: annotationNote || 'Marked area' }],
      });
      setAttachTarget(null); setAnnotationNote('');
    } catch { Alert.alert('Failed', 'Could not save the annotation.'); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TeleHeader
        title={presenceLabel ? `${patientName} · ${presenceLabel}` : patientName}
        right={
          <View style={styles.headerActions}>
            <Pressable onPress={() => doEscalate('audio')} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Escalate to audio call">
              <Phone size={18} color={Colors.secondary} strokeWidth={2} />
            </Pressable>
            <Pressable onPress={() => doEscalate('video')} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Escalate to video call">
              <VideoIcon size={18} color={Colors.primary} strokeWidth={2} />
            </Pressable>
            <Pressable onPress={() => router.push(`/(doctor)/consult/${appointmentId}/notes`)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Open consultation notes">
              <NotebookPen size={18} color={Colors.primary} strokeWidth={2} />
            </Pressable>
          </View>
        }
      />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        {isLoading && messages.length === 0 ? (
          <StateView variant="loading" label="Loading messages" />
        ) : isError ? (
          <StateView variant="error" message="We could not load this conversation." onRetry={() => refetch()} />
        ) : (
          <ScrollView style={styles.flex} showsVerticalScrollIndicator={false} contentContainerStyle={styles.messages}>
            {/* Secure-chat notice (H2/H23) */}
            <View style={styles.secureBanner}>
              <ShieldCheck size={14} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.secureText}>{threadState?.secureNotice ?? SECURE_CHAT_NOTICE}</Text>
            </View>

            {/* Offline warnings (H18/H19) */}
            {patientPresence === 'offline' && <PresenceNote tone="warning" text={`${patientName} is offline${threadState?.patientPresence.lastSeenAt ? ` · last seen ${new Date(threadState.patientPresence.lastSeenAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}` : ''}. Messages will be delivered when they reconnect.`} />}
            {doctorPresence === 'offline' && <PresenceNote tone="critical" text="You appear offline. Reconnect to deliver messages in real time." />}

            {messages.length === 0 ? (
              <StateView variant="empty" icon={MessageSquare} title="No messages yet" message="Send the first message to start the consultation." />
            ) : (
              messages.map((m) => (
                <RichMessage
                  key={m.base.id}
                  message={m}
                  onOpenAttachment={() => { setAttachTarget(m); setSheet('attachment'); }}
                  onReport={() => setReportTarget(m.base.id)}
                />
              ))
            )}

            {/* Typing indicator (H5) */}
            {patientPresence === 'typing' && (
              <View style={styles.typingRow}>
                <View style={styles.typingBubble}>
                  <Text style={styles.typingText}>{patientName} is typing…</Text>
                </View>
              </View>
            )}
          </ScrollView>
        )}

        {/* Chat-ended state (H20) vs composer */}
        {ended ? (
          <View style={styles.endedBar}>
            <Text style={styles.endedText}>This chat has ended{threadState?.endedAt ? ` · ${new Date(threadState.endedAt).toLocaleString('en-NG')}` : ''}.</Text>
            <Pressable onPress={() => setSheet('transcript')} accessibilityRole="button" accessibilityLabel="View transcript">
              <Text style={styles.endedLink}>View transcript</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.toolbar}>
              <ToolBtn icon={Mic} label="Voice" onPress={() => setSheet('voice')} />
              <ToolBtn icon={ImageIcon} label="Image" onPress={() => setSheet('image')} />
              <ToolBtn icon={FileText} label="Document" onPress={() => setSheet('document')} />
              <ToolBtn icon={FileBarChart} label="Share" onPress={() => setSheet('share')} />
              <ToolBtn icon={ScrollText} label="Transcript" onPress={() => setSheet('transcript')} />
              <ToolBtn icon={X} label="End" onPress={doEndChat} tint={Colors.error} />
            </View>
            <ChatComposer onSend={handleSend} sending={sendMessage.isPending} placeholder="Message your patient" />
          </>
        )}
      </KeyboardAvoidingView>

      {/* Voice note sheet (H8) */}
      <BottomSheet visible={sheet === 'voice'} title="Send voice note" onClose={closeSheet}>
        <Text style={styles.sheetBody}>Record and send a voice note to your patient. (Demo: a 12-second clip will be sent.)</Text>
        <View style={styles.voicePreview}><VoiceNoteBubble durationSecs={12} mine onPlay={() => {}} /></View>
        <PrimaryButton label="Send voice note" onPress={doSendVoice} loading={sendVoice.isPending} style={styles.sheetBtn} />
      </BottomSheet>

      {/* Upload image sheet (H9) */}
      <BottomSheet visible={sheet === 'image'} title="Upload image" onClose={closeSheet}>
        <Text style={styles.sheetBody}>Share an image with your patient (e.g. an annotated diagram or instruction).</Text>
        <PrimaryButton label="Send image" onPress={() => doSendAttachment('image')} loading={sendAttachment.isPending} style={styles.sheetBtn} />
      </BottomSheet>

      {/* Upload document sheet (H10) */}
      <BottomSheet visible={sheet === 'document'} title="Upload medical document" onClose={closeSheet}>
        <Text style={styles.sheetBody}>Share a medical document (PDF) with your patient.</Text>
        <PrimaryButton label="Send document" onPress={() => doSendAttachment('document')} loading={sendAttachment.isPending} style={styles.sheetBtn} />
      </BottomSheet>

      {/* Share rx/lab/summary sheet (H13/H14/H15) */}
      <BottomSheet visible={sheet === 'share'} title="Share into chat" onClose={closeSheet}>
        <View style={styles.shareRow}>
          <ShareChip icon={ClipboardList} label="Prescription" active={shareKind === 'prescription'} onPress={() => setShareKind('prescription')} />
          <ShareChip icon={FlaskConical} label="Lab order" active={shareKind === 'lab'} onPress={() => setShareKind('lab')} />
          <ShareChip icon={FileBarChart} label="Summary" active={shareKind === 'summary'} onPress={() => setShareKind('summary')} />
        </View>
        <PrimaryButton label={`Share ${MESSAGE_KIND_LABELS[shareKind === 'prescription' ? 'shared_prescription' : shareKind === 'lab' ? 'shared_lab' : 'shared_summary']}`} onPress={doShare} loading={shareInChat.isPending} style={styles.sheetBtn} />
      </BottomSheet>

      {/* View / annotate attachment sheet (H11/H12) */}
      <Modal visible={sheet === 'attachment' && !!attachTarget} transparent animationType="slide" onRequestClose={() => { setSheet(null); setAttachTarget(null); }}>
        <Pressable style={styles.backdrop} onPress={() => { setSheet(null); setAttachTarget(null); }} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{attachTarget?.kind === 'image' ? 'Annotate image' : 'Attachment'}</Text>
            <Pressable onPress={() => { setSheet(null); setAttachTarget(null); }} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          {attachTarget?.attachment && attachTarget.kind === 'image' ? (
            <>
              <Image source={{ uri: attachTarget.attachment.url }} style={styles.annotateImage} resizeMode="contain" />
              {(attachTarget.annotations ?? []).map((a) => (
                <View key={a.id} style={styles.annotationRow}><MapPin size={14} color={Colors.primary} strokeWidth={2} /><Text style={styles.annotationText}>{a.note}</Text></View>
              ))}
              <TextInput style={styles.annotateInput} placeholder="Add an annotation note" placeholderTextColor={Colors.outline} value={annotationNote} onChangeText={setAnnotationNote} />
              <PrimaryButton label="Save annotation" onPress={doAnnotate} loading={annotateImage.isPending} style={styles.sheetBtn} />
            </>
          ) : (
            <View style={styles.docPreview}>
              <FileText size={32} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.listTitle}>{attachTarget?.attachment?.name}</Text>
              <Text style={styles.listMeta}>{attachTarget?.attachment?.mimeType}</Text>
            </View>
          )}
        </View>
      </Modal>

      {/* Report message sheet (H22) */}
      <Modal visible={!!reportTarget} transparent animationType="slide" onRequestClose={() => setReportTarget(null)}>
        <Pressable style={styles.backdrop} onPress={() => setReportTarget(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Report message</Text>
            <Pressable onPress={() => setReportTarget(null)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close report dialog"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          <SelectField label="Reason" placeholder="Select a reason" value={reportReason} options={REPORT_REASONS} onChange={setReportReason} searchable={false} />
          <PrimaryButton label="Submit report" onPress={doReport} loading={reportMessage.isPending} style={styles.sheetBtn} />
        </View>
      </Modal>

      {/* Transcript sheet (H21) */}
      <BottomSheet visible={sheet === 'transcript'} title="Chat transcript" onClose={closeSheet}>
        {transcriptQuery.isLoading ? (
          <StateView variant="loading" label="Loading transcript" />
        ) : transcriptQuery.isError ? (
          <StateView variant="error" message="Could not load the transcript." onRetry={() => transcriptQuery.refetch()} />
        ) : !transcriptQuery.data || transcriptQuery.data.messages.length === 0 ? (
          <StateView variant="empty" icon={ScrollText} title="No transcript" message="There are no messages to transcribe yet." />
        ) : (
          <View style={styles.transcript}>
            {transcriptQuery.data.messages.map((m) => (
              <View key={m.base.id} style={styles.transcriptRow}>
                <Text style={styles.transcriptAuthor}>{m.base.author === 'doctor' ? 'You' : patientName} · {new Date(m.base.createdAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}</Text>
                <Text style={styles.transcriptBody}>{m.base.body || `[${MESSAGE_KIND_LABELS[m.kind]}]`}</Text>
              </View>
            ))}
          </View>
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}

function RichMessage({ message, onOpenAttachment, onReport }: { message: ChatMessageRich; onOpenAttachment: () => void; onReport: () => void }) {
  const mine = message.base.author === 'doctor';
  const time = new Date(message.base.createdAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });

  // System line (H: escalation / chat ended / secure)
  if (message.kind === 'system') {
    return <View style={styles.systemRow}><Text style={styles.systemText}>{message.base.body}</Text></View>;
  }

  // Plain text REUSES the Phase 1 MessageBubble verbatim.
  if (message.kind === 'text') {
    return (
      <Pressable onLongPress={mine ? undefined : onReport} delayLongPress={350}>
        <MessageBubble message={message.base} />
        {mine && <DeliveryTicks status={message.deliveryStatus} />}
      </Pressable>
    );
  }

  // Rich kinds rendered in a directional bubble shell.
  return (
    <Pressable style={[styles.richRow, mine ? styles.rowMine : styles.rowTheirs]} onLongPress={mine ? undefined : onReport} delayLongPress={350}>
      <View style={[styles.richBubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {message.kind === 'voice' && <VoiceNoteBubble durationSecs={message.voiceDurationSecs ?? 0} mine={mine} onPlay={() => {}} />}
        {(message.kind === 'image' || message.kind === 'document') && message.attachment && (
          <AttachmentBubble
            kind={message.kind}
            uri={message.attachment.url}
            name={message.attachment.name}
            caption={message.base.body || undefined}
            mimeType={message.attachment.mimeType}
            annotationCount={message.annotations?.length ?? 0}
            mine={mine}
            onPress={onOpenAttachment}
          />
        )}
        {(message.kind === 'shared_prescription' || message.kind === 'shared_lab' || message.kind === 'shared_summary') && (
          <View style={styles.sharedCard}>
            <View style={[styles.sharedIcon, mine ? styles.sharedIconMine : styles.sharedIconTheirs]}>
              <FileBarChart size={16} color={mine ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.listBody}>
              <Text style={[styles.listTitle, mine && styles.textMine]}>{MESSAGE_KIND_LABELS[message.kind]}</Text>
              <Text style={[styles.listMeta, mine && styles.metaMine]}>{message.shared?.ref ?? ''} {message.shared?.label ?? ''}</Text>
            </View>
          </View>
        )}
        <Text style={[styles.richTime, mine ? styles.timeMine : styles.timeTheirs]}>{time}</Text>
      </View>
      {mine && <DeliveryTicks status={message.deliveryStatus} />}
    </Pressable>
  );
}

function DeliveryTicks({ status }: { status: ChatDeliveryStatus }) {
  const cfg: Record<ChatDeliveryStatus, { Icon: LucideIcon; color: string }> = {
    sending:   { Icon: Clock,         color: Colors.onSurfaceVariant },
    sent:      { Icon: Check,         color: Colors.onSurfaceVariant },
    delivered: { Icon: CheckCheck,    color: Colors.onSurfaceVariant },
    read:      { Icon: CheckCheck,    color: Colors.secondary },
    failed:    { Icon: AlertTriangle, color: Colors.error },
  };
  const { Icon, color } = cfg[status];
  return (
    <View style={styles.ticks}>
      <Icon size={12} color={color} strokeWidth={2} />
      <Text style={[styles.tickLabel, { color }]}>{DELIVERY_STATUS_LABELS[status]}</Text>
    </View>
  );
}

function PresenceNote({ tone, text }: { tone: 'warning' | 'critical'; text: string }) {
  return (
    <View style={[styles.presenceNote, tone === 'critical' && styles.presenceCritical]}>
      <AlertTriangle size={14} color={tone === 'critical' ? Colors.error : Colors.primary} strokeWidth={2} />
      <Text style={styles.presenceText}>{text}</Text>
    </View>
  );
}

function ToolBtn({ icon: Icon, label, onPress, tint = Colors.onSurfaceVariant }: { icon: LucideIcon; label: string; onPress: () => void; tint?: string }) {
  return (
    <Pressable style={styles.toolBtn} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Icon size={18} color={tint} strokeWidth={2} />
      <Text style={[styles.toolLabel, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

function ShareChip({ icon: Icon, label, active, onPress }: { icon: LucideIcon; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.shareChip, active && styles.shareChipOn]} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={label}>
      <Icon size={18} color={active ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
      <Text style={[styles.shareChipText, active && styles.shareChipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function BottomSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
        </View>
        <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: Colors.background },
  flex:           { flex: 1 },
  headerActions:  { flexDirection: 'row', gap: Spacing.xs },
  iconBtn:        { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  messages:       { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, gap: Spacing.sm, flexGrow: 1 },
  secureBanner:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal },
  secureText:     { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
  presenceNote:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple },
  presenceCritical:{ backgroundColor: Colors.errorContainer },
  presenceText:   { ...Typography.caption, color: Colors.onSurface, flex: 1 },
  systemRow:      { alignItems: 'center', paddingVertical: Spacing.xs },
  systemText:     { ...Typography.caption, color: Colors.onSurfaceVariant, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full, textAlign: 'center', overflow: 'hidden' },
  richRow:        { width: '100%', flexDirection: 'column' },
  rowMine:        { alignItems: 'flex-end' },
  rowTheirs:      { alignItems: 'flex-start' },
  richBubble:     { maxWidth: '82%', paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm, borderRadius: Radius.lg, gap: 6 },
  bubbleMine:     { backgroundColor: Colors.primary, borderBottomRightRadius: Radius.sm },
  bubbleTheirs:   { backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, borderBottomLeftRadius: Radius.sm },
  richTime:       { ...Typography.caption, alignSelf: 'flex-end' },
  timeMine:       { color: 'rgba(255,255,255,0.75)' },
  timeTheirs:     { color: Colors.onSurfaceVariant },
  textMine:       { color: Colors.onPrimary },
  metaMine:       { color: 'rgba(255,255,255,0.75)' },
  sharedCard:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minWidth: 200 },
  sharedIcon:     { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  sharedIconMine: { backgroundColor: 'rgba(255,255,255,0.2)' },
  sharedIconTheirs:{ backgroundColor: Colors.iconBgPurple },
  listBody:       { flex: 1, gap: 2 },
  listTitle:      { ...Typography.labelMd, color: Colors.onSurface },
  listMeta:       { ...Typography.caption, color: Colors.onSurfaceVariant },
  ticks:          { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginTop: 2, marginRight: Spacing.xs },
  tickLabel:      { ...Typography.caption },
  typingRow:      { alignItems: 'flex-start' },
  typingBubble:   { backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.lg },
  typingText:     { ...Typography.caption, color: Colors.onSurfaceVariant, fontStyle: 'italic' },
  endedBar:       { padding: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.background },
  endedText:      { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  endedLink:      { ...Typography.labelMd, color: Colors.primary },
  toolbar:        { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: Spacing.sm, paddingHorizontal: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, backgroundColor: Colors.background },
  toolBtn:        { alignItems: 'center', gap: 2 },
  toolLabel:      { ...Typography.caption },
  // sheet
  backdrop:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:          { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '85%' },
  sheetScroll:    { marginTop: Spacing.xs },
  sheetHandle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:     { ...Typography.titleMd, color: Colors.onSurface },
  sheetBody:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  sheetBtn:       { marginTop: Spacing.sm },
  voicePreview:   { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.primary, marginBottom: Spacing.sm },
  shareRow:       { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  shareChip:      { flex: 1, alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  shareChipOn:    { backgroundColor: Colors.primary, borderColor: Colors.primary },
  shareChipText:  { ...Typography.labelSm, color: Colors.onSurface },
  shareChipTextOn:{ color: Colors.onPrimary, fontWeight: '700' },
  annotateImage:  { width: '100%', height: 220, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  annotationRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  annotationText: { ...Typography.bodySm, color: Colors.onSurface },
  annotateInput:  { height: 48, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, backgroundColor: Colors.surfaceContainerLow, ...Typography.bodyMd, color: Colors.onSurface, marginTop: Spacing.sm },
  docPreview:     { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg },
  transcript:     { gap: Spacing.md },
  transcriptRow:  { gap: 2 },
  transcriptAuthor:{ ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  transcriptBody: { ...Typography.bodyMd, color: Colors.onSurface },
});
