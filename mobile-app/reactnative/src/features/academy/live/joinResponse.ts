// Maps POST /live/sessions/:id/join to the shape the screens use. The Go handler replies
// {"data": {"session": {...room_ref}, "token": "...", "rtc": {"provider","url"}}} and the app's
// axios client does not unwrap the envelope, so this does it. `rtc` is present only when the
// provider runs a server the client dials (LiveKit).
//
// canPublish is deliberately NOT read from the response: whether this user may speak is decided
// by the permissions inside the LiveKit token, and the room reports them after connecting.

export interface JoinResult {
  sessionId: string;
  roomName: string;
  token: string;
  canPublish: false;
  moderated: true;
  rtc?: { provider: string; url: string };
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function mapJoinResponse(body: unknown): JoinResult {
  const top = obj(body);
  const inner = obj(top?.data) ?? top; // tolerate an already-unwrapped body
  const session = obj(inner?.session);
  const token = inner?.token;
  const id = session?.id;
  if (typeof id !== 'string' || !id || typeof token !== 'string' || !token) {
    throw new Error('The join response had no session or token.');
  }
  const roomRef = session?.room_ref;
  const rtc = obj(inner?.rtc);
  const out: JoinResult = {
    sessionId: id,
    roomName: typeof roomRef === 'string' && roomRef ? roomRef : `academy-live-${id}`,
    token,
    canPublish: false,
    moderated: true,
  };
  if (rtc && typeof rtc.provider === 'string' && typeof rtc.url === 'string') {
    out.rtc = { provider: rtc.provider, url: rtc.url };
  }
  return out;
}
