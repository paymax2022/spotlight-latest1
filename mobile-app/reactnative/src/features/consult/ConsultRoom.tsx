// One room for every vertical. Module screens supply only the session id and
// what "end" means to their own appointment; the timer, media, chat and
// extension flow are identical everywhere.
//
// The countdown follows the server clock: every session read carries
// `server_now`, and the offset is re-derived on each poll, so a device with a
// wrong clock still sees the same 0:00 the engine enforces.

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ChevronLeft,
  Clock,
  MessageCircle,
  Mic,
  MicOff,
  Phone,
  Send,
  ShieldAlert,
  Video as VideoIcon,
  VideoOff,
  X,
} from 'lucide-react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { formatNaira } from '@/utils/money';
import { confirmAsync } from '@/lib/confirm';
import { useAuthStore } from '@/store/authStore';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';
import { completeConsultSession } from './api';
import { consultTimer, serverOffsetMs } from './sessionTimer';
import {
  useConsultExtensions,
  useConsultJoin,
  useConsultMessages,
  useConsultSession,
  useDecideConsultExtension,
  usePayConsultExtension,
  useRequestConsultExtension,
  useSendConsultMessage,
} from './hooks';
import {
  canJoinNow,
  extensionAction,
  openExtension,
  viewerOf,
  type ConsultViewer,
} from './roomView';
import { useConsultMedia } from './useConsultMedia';
import ConsultVideo from './ConsultVideo';
import ExtensionSheet from './ExtensionSheet';
import { CONSULT_MODE_LABEL, type ConsultExtension, type ConsultSession } from './types';

export interface ConsultRoomProps {
  sessionId: string;
  role: 'patient' | 'provider';
  /** Module completion. Defaults to the engine's own Complete endpoint. */
  onEnd?: () => Promise<unknown>;
  onBack?: () => void;
}

export default function ConsultRoom({ sessionId, role, onEnd, onBack }: ConsultRoomProps) {
  const userId = useAuthStore((s) => s.user?.id);
  const { data: session, dataUpdatedAt, error: sessionError, refetch } = useConsultSession(sessionId);
  // The fetch always runs so a terminal session still shows its transcript;
  // only the interval stops once the session is ended or cancelled.
  const pollsOpen = Boolean(session) && session?.state !== 'ended' && session?.state !== 'cancelled';
  const extensions = useConsultExtensions(sessionId, true, pollsOpen);
  const messages = useConsultMessages(sessionId, true, pollsOpen);
  const join = useConsultJoin(sessionId);
  const sendMessage = useSendConsultMessage(sessionId);
  const requestExtension = useRequestConsultExtension(sessionId);
  const decideExtension = useDecideConsultExtension(sessionId);
  const payExtension = usePayConsultExtension(sessionId);
  const checkout = usePurchasePayment<{ extension: ConsultExtension; session: ConsultSession }>();

  const [tick, setTick] = useState(() => Date.now());
  const [draft, setDraft] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [extensionOpen, setExtensionOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  // One automatic join per room mount. A failed join must not retry every
  // render; the room shows a Reconnect button instead.
  const joinAttempted = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    joinAttempted.current = false;
  }, [sessionId]);

  const offsetMs = session ? serverOffsetMs(session.server_now, dataUpdatedAt) : 0;
  const projectedNow = tick + offsetMs;

  const viewer: ConsultViewer = session
    ? userId
      ? viewerOf(session, userId)
      : role
    : role;

  const timer = session
    ? consultTimer(
        {
          endsAt: session.ends_at,
          warnAt: session.warn_at,
          state: session.state,
          extendable: session.extendable,
        },
        tick,
        offsetMs,
      )
    : null;

  const expired = timer?.phase === 'expired';
  const canAct = viewer !== 'observer';
  const joinable = Boolean(
    session && canAct && session.mode !== 'chat' && !expired && canJoinNow(session, projectedNow),
  );

  useEffect(() => {
    if (!joinable || joinAttempted.current) return;
    joinAttempted.current = true;
    join.mutate();
  }, [joinable, join]);

  const joined = Boolean(join.data);
  const joinFailed = !joined && join.isError;
  const joinErrorText =
    join.error instanceof Error ? join.error.message : 'Could not join the session.';
  const media = useConsultMedia(join.data ?? null, session?.mode ?? 'chat', joined && !expired);

  useEffect(() => {
    if (session?.mode === 'chat') setChatOpen(true);
  }, [session?.mode]);

  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [messages.data?.length, chatOpen]);

  const ext = openExtension(extensions.data);
  const action = extensionAction(ext, viewer, projectedNow);
  const canExtend = canAct && Boolean(session?.extendable) && !expired;
  const showChatPanel = session?.mode === 'chat' || chatOpen;
  const readOnly = expired || !canAct;

  const startExtensionPayment = (extension: ConsultExtension) => {
    // PayExtension debits the wallet, so the wallet rail is the only one that
    // fits: the card rail would top up the wallet and then debit it.
    checkout.start({
      amountKobo: extension.price_kobo,
      title: `Extend by ${extension.added_minutes} min`,
      domain: 'consult_extension',
      method: 'wallet',
      charge: () => payExtension.mutateAsync(extension.id),
      onPaid: () => setExtensionOpen(false),
    });
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || readOnly) return;
    setDraft('');
    try {
      await sendMessage.mutateAsync(body);
    } catch {
      setDraft(body);
    }
  };

  const end = async () => {
    const ok = await confirmAsync({
      title: 'End this session?',
      message: 'The timer stops for both sides and media is cut immediately.',
      confirmLabel: 'End session',
      cancelLabel: 'Keep going',
      destructive: true,
    });
    if (!ok) return;
    setEnding(true);
    setEndError(null);
    try {
      await (onEnd ? onEnd() : completeConsultSession(sessionId));
      await refetch();
    } catch (e) {
      setEndError(e instanceof Error ? e.message : 'Could not end the session.');
    } finally {
      setEnding(false);
    }
  };

  const back = () => {
    if (onBack) onBack();
    else router.back();
  };

  if (!session) {
    return (
      <SafeAreaView style={styles.gate}>
        {sessionError ? (
          <>
            <ShieldAlert size={34} color={Colors.error} />
            <Text style={styles.gateText}>
              {sessionError instanceof Error ? sessionError.message : 'This session is unavailable.'}
            </Text>
            <Pressable style={styles.secondaryButton} onPress={() => void refetch()}>
              <Text style={styles.secondaryLabel}>Try again</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={Colors.primary} />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={back} hitSlop={10} style={styles.headerButton}>
          <ChevronLeft size={22} color={Colors.onSurface} />
        </Pressable>
        <View style={styles.headerTitle}>
          <Text style={styles.headerTitleText}>
            {CONSULT_MODE_LABEL[session.mode]} consult
          </Text>
          <Text style={styles.headerSub}>
            {formatNaira(session.price_kobo, { decimals: false })} · {session.duration_minutes} min
          </Text>
        </View>
        <View style={[styles.timerChip, timer?.warning && styles.timerChipWarn, expired && styles.timerChipEnd]}>
          <Clock
            size={14}
            color={expired ? Colors.onError : timer?.warning ? Colors.onWarning : Colors.onSurface}
          />
          <Text
            style={[
              styles.timerText,
              timer?.warning && styles.timerTextWarn,
              expired && styles.timerTextEnd,
            ]}
          >
            {expired ? 'Ended' : timer?.label ?? '--:--'}
          </Text>
        </View>
      </View>

      {timer?.phase === 'warning' && (canExtend || !canAct) && (
        <View style={styles.warnBar}>
          <Clock size={16} color={Colors.onWarning} />
          <Text style={styles.warnText}>Session ends in {timer.label}.</Text>
          {canAct && (
            <Pressable onPress={() => setExtensionOpen(true)} hitSlop={8}>
              <Text style={styles.warnAction}>Extend</Text>
            </Pressable>
          )}
        </View>
      )}

      {expired && (
        <View style={styles.endBar}>
          <Text style={styles.endBarText}>
            {session.state === 'ended' || session.state === 'cancelled'
              ? 'This session has ended. You are still signed in.'
              : 'Session time is up. Media has ended — you are still signed in.'}
          </Text>
        </View>
      )}

      {action.kind === 'approve' && (
        <Pressable style={styles.requestBar} onPress={() => setExtensionOpen(true)}>
          <Text style={styles.requestBarText}>
            The patient asked for {ext?.added_minutes} more minutes · Review
          </Text>
        </Pressable>
      )}

      {action.kind === 'pay' && viewer === 'patient' && (
        <Pressable style={styles.requestBar} onPress={() => setExtensionOpen(true)}>
          <Text style={styles.requestBarText}>
            Extension approved · Pay {formatNaira(ext?.price_kobo ?? 0, { decimals: false })}
          </Text>
        </Pressable>
      )}

      {session.mode === 'chat' ? (
        <ChatPanel
          messages={messages.data ?? []}
          userId={userId}
          draft={draft}
          setDraft={setDraft}
          onSend={() => void send()}
          readOnly={readOnly}
          sending={sendMessage.isPending}
          scrollRef={scrollRef}
        />
      ) : (
        <View style={styles.stageWrap}>
          <View style={styles.stage}>
            {session.mode === 'video' ? (
              media.status === 'failed' ? (
                <View style={styles.stageEmpty}>
                  <VideoIcon size={34} color={Colors.inverseOnSurface} />
                  <Text style={styles.stageEmptyText}>
                    {expired ? 'The session has ended.' : media.error ?? 'Could not connect to the room.'}
                  </Text>
                  {(media.status === 'failed' || joinFailed) && !expired && (
                    <Pressable style={styles.retryButton} onPress={() => join.mutate()}>
                      <Text style={styles.retryLabel}>Reconnect</Text>
                    </Pressable>
                  )}
                </View>
              ) : media.remoteVideo ? (
                <ConsultVideo publication={media.remoteVideo} label="Remote video" />
              ) : (
                <View style={styles.stageEmpty}>
                  {join.isPending || media.status === 'connecting' ? (
                    <ActivityIndicator color={Colors.inverseOnSurface} />
                  ) : (
                    <VideoIcon size={34} color={Colors.inverseOnSurface} />
                  )}
                  <Text style={styles.stageEmptyText}>
                    {expired
                      ? 'The session has ended.'
                      : joinFailed
                        ? joinErrorText
                        : joined
                          ? 'Waiting for the other person to join…'
                          : 'Connecting to your session…'}
                  </Text>
                  {joinFailed && !expired && (
                    <Pressable style={styles.retryButton} onPress={() => join.mutate()}>
                      <Text style={styles.retryLabel}>Reconnect</Text>
                    </Pressable>
                  )}
                </View>
              )
            ) : (
              <View style={styles.stageEmpty}>
                <View style={styles.audioAvatar}>
                  <Phone size={34} color={Colors.onPrimary} />
                </View>
                <Text style={styles.audioMeta}>
                  {expired
                    ? 'The session has ended.'
                    : media.status === 'failed'
                      ? media.error ?? 'Could not connect to the room.'
                      : joinFailed
                        ? joinErrorText
                        : joined
                          ? 'Voice session in progress'
                          : 'Connecting to your session…'}
                </Text>
                {(media.status === 'failed' || joinFailed) && !expired && (
                  <Pressable style={styles.retryButton} onPress={() => join.mutate()}>
                    <Text style={styles.retryLabel}>Reconnect</Text>
                  </Pressable>
                )}
              </View>
            )}

            {session.mode === 'video' && media.localVideo && (
              <View style={styles.pip}>
                <ConsultVideo publication={media.localVideo} label="You" muted mirrored />
              </View>
            )}
          </View>

          {showChatPanel && (
            <View style={styles.drawer}>
              <View style={styles.drawerHeader}>
                <Text style={styles.drawerTitle}>Session chat</Text>
                <Pressable onPress={() => setChatOpen(false)} hitSlop={10}>
                  <X size={20} color={Colors.onSurfaceVariant} />
                </Pressable>
              </View>
              <ChatPanel
                messages={messages.data ?? []}
                userId={userId}
                draft={draft}
                setDraft={setDraft}
                onSend={() => void send()}
                readOnly={readOnly}
                sending={sendMessage.isPending}
                scrollRef={scrollRef}
              />
            </View>
          )}

          {canAct && (
            <View style={styles.controls}>
              <ControlButton
                active={media.micOn}
                label={media.micOn ? 'Mute' : 'Unmute'}
                onPress={() => void media.setMic(!media.micOn)}
                disabled={expired || !joined}
              >
                {media.micOn ? <Mic size={20} color={Colors.onSurface} /> : <MicOff size={20} color={Colors.error} />}
              </ControlButton>

              {session.mode === 'video' && (
                <ControlButton
                  active={media.camOn}
                  label={media.camOn ? 'Camera off' : 'Camera on'}
                  onPress={() => void media.setCam(!media.camOn)}
                  disabled={expired || !joined}
                >
                  {media.camOn ? <VideoIcon size={20} color={Colors.onSurface} /> : <VideoOff size={20} color={Colors.error} />}
                </ControlButton>
              )}

              <ControlButton
                active={showChatPanel}
                label="Chat"
                onPress={() => setChatOpen((open) => !open)}
              >
                <MessageCircle size={20} color={Colors.onSurface} />
              </ControlButton>

              <ControlButton
                active={false}
                label="Extend"
                onPress={() => setExtensionOpen(true)}
                disabled={!canExtend}
              >
                <Clock size={20} color={canExtend ? Colors.onSurface : Colors.outline} />
              </ControlButton>

              <ControlButton active={false} label="End" onPress={() => void end()} disabled={ending}>
                <PhoneOffIcon />
              </ControlButton>
            </View>
          )}
        </View>
      )}

      {session.mode === 'chat' && canAct && (
        <View style={styles.chatControls}>
          <Pressable
            style={[styles.extendButton, !canExtend && styles.disabled]}
            disabled={!canExtend}
            onPress={() => setExtensionOpen(true)}
          >
            <Clock size={16} color={Colors.primary} />
            <Text style={styles.extendLabel}>
              {canExtend ? `Extend · ${formatNaira(session.price_kobo, { decimals: false })}/${session.duration_minutes}min` : 'No extensions left'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.endButton, ending && styles.disabled]}
            disabled={ending}
            onPress={() => void end()}
          >
            <Text style={styles.endButtonLabel}>{ending ? 'Ending…' : 'End session'}</Text>
          </Pressable>
        </View>
      )}

      {endError ? <Text style={styles.error}>{endError}</Text> : null}
      {media.error && media.status !== 'failed' ? <Text style={styles.error}>{media.error}</Text> : null}

      <ExtensionSheet
        visible={extensionOpen}
        session={session}
        extensions={extensions.data ?? []}
        viewer={viewer}
        nowMs={projectedNow}
        busy={
          requestExtension.isPending || decideExtension.isPending || payExtension.isPending || checkout.visible
        }
        error={extensionError(requestExtension.error, decideExtension.error, payExtension.error)}
        onClose={() => setExtensionOpen(false)}
        onRequest={(minutes) => requestExtension.mutate(minutes)}
        onDecide={(id, approve) => decideExtension.mutate({ extensionId: id, approve })}
        onPay={(extension) => {
          setExtensionOpen(false);
          startExtensionPayment(extension);
        }}
      />

      <PaymentSheet controller={checkout} />
    </SafeAreaView>
  );
}

function extensionError(...errors: unknown[]): string | null {
  for (const e of errors) {
    if (e) return e instanceof Error ? e.message : 'That request could not be completed.';
  }
  return null;
}

function PhoneOffIcon() {
  return (
    <View style={styles.phoneOff}>
      <Phone size={18} color={Colors.onError} style={{ transform: [{ rotate: '135deg' }] }} />
    </View>
  );
}

function ControlButton({
  active,
  label,
  onPress,
  disabled,
  children,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      style={[styles.control, active && styles.controlActive, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
    >
      {children}
      <Text style={styles.controlLabel}>{label}</Text>
    </Pressable>
  );
}

function ChatPanel({
  messages,
  userId,
  draft,
  setDraft,
  onSend,
  readOnly,
  sending,
  scrollRef,
}: {
  messages: { id: string; sender_id: string; body: string; created_at: string }[];
  userId?: string;
  draft: string;
  setDraft: (value: string) => void;
  onSend: () => void;
  readOnly: boolean;
  sending: boolean;
  scrollRef: React.RefObject<ScrollView | null>;
}) {
  return (
    <KeyboardAvoidingView
      style={styles.chatWrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView ref={scrollRef} contentContainerStyle={styles.chatBody} keyboardShouldPersistTaps="handled">
        {messages.length === 0 ? (
          <Text style={styles.chatEmpty}>
            {readOnly ? 'No messages were exchanged.' : 'Messages sent here stay with this timed session.'}
          </Text>
        ) : (
          messages.map((message) => {
            const mine = message.sender_id === userId;
            return (
              <View key={message.id} style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.body}</Text>
                  <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
                    {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {readOnly ? (
        <View style={styles.readOnlyBar}>
          <Text style={styles.readOnlyText}>This session has ended. The transcript is read-only.</Text>
        </View>
      ) : (
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a message"
            placeholderTextColor={Colors.outline}
            multiline
            maxLength={2000}
          />
          <Pressable
            style={[styles.sendButton, (!draft.trim() || sending) && styles.disabled]}
            disabled={!draft.trim() || sending}
            onPress={onSend}
          >
            {sending ? <ActivityIndicator size="small" color={Colors.onPrimary} /> : <Send size={18} color={Colors.onPrimary} />}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  gateText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  headerButton: { padding: Spacing.xs },
  headerTitle: { flex: 1 },
  headerTitleText: { ...Typography.titleMd, color: Colors.onSurface },
  headerSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  timerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainer,
  },
  timerChipWarn: { backgroundColor: Colors.gold },
  timerChipEnd: { backgroundColor: Colors.errorContainer },
  timerText: { ...Typography.labelMd, color: Colors.onSurface, fontVariant: ['tabular-nums'] },
  timerTextWarn: { color: Colors.onWarning },
  timerTextEnd: { color: Colors.error },
  warnBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: '#FFF4CC',
  },
  warnText: { ...Typography.bodySm, color: Colors.onWarning, flex: 1 },
  warnAction: { ...Typography.labelLg, color: Colors.onWarning },
  endBar: {
    marginHorizontal: Spacing.md,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.errorContainer,
  },
  endBarText: { ...Typography.bodySm, color: Colors.error },
  requestBar: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryFixed,
  },
  requestBarText: { ...Typography.labelMd, color: Colors.onPrimaryFixedVariant },
  stageWrap: { flex: 1, padding: Spacing.md, gap: Spacing.md },
  stage: {
    flex: 1,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.backdropDark,
  },
  stageEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.lg },
  stageEmptyText: { ...Typography.bodySm, color: Colors.inverseOnSurface, textAlign: 'center' },
  audioAvatar: {
    width: 96,
    height: 96,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryContainer,
  },
  audioMeta: { ...Typography.labelLg, color: Colors.inverseOnSurface },
  pip: {
    position: 'absolute',
    right: Spacing.md,
    bottom: Spacing.md,
    width: 108,
    height: 150,
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: Colors.surfaceContainerLowest,
  },
  retryButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  retryLabel: { ...Typography.labelMd, color: Colors.onSurface },
  drawer: {
    maxHeight: 280,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    overflow: 'hidden',
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.outlineVariant,
  },
  drawerTitle: { ...Typography.labelLg, color: Colors.onSurface },
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    paddingVertical: Spacing.sm,
  },
  control: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    minWidth: 58,
    backgroundColor: Colors.surfaceContainer,
  },
  controlActive: { backgroundColor: Colors.surfaceContainerHigh },
  controlLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  phoneOff: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.error,
  },
  chatWrap: { flex: 1 },
  chatBody: { padding: Spacing.md, gap: Spacing.sm },
  chatEmpty: { ...Typography.bodySm, color: Colors.outline, textAlign: 'center', marginTop: Spacing.lg },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 2 },
  bubbleTheirs: { backgroundColor: Colors.surfaceContainer },
  bubbleMine: { backgroundColor: Colors.primary },
  bubbleText: { ...Typography.bodyMd, color: Colors.onSurface },
  bubbleTextMine: { color: Colors.onPrimary },
  bubbleTime: { ...Typography.caption, color: Colors.outline },
  bubbleTimeMine: { color: Colors.primaryFixedDim },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 42,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceContainer,
    color: Colors.onSurface,
    ...Typography.bodyMd,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
  },
  readOnlyBar: {
    padding: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
  },
  readOnlyText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  chatControls: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  extendButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: 12,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  extendLabel: { ...Typography.labelMd, color: Colors.primary },
  endButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderRadius: Radius.full,
    backgroundColor: Colors.errorContainer,
  },
  endButtonLabel: { ...Typography.labelMd, color: Colors.error },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.outline,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  secondaryLabel: { ...Typography.labelMd, color: Colors.onSurface },
  disabled: { opacity: 0.45 },
  error: {
    ...Typography.bodySm,
    color: Colors.error,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
});
